import { CDPTransport } from './cdp/transport';
import { CDPClient } from './cdp/client';
import { CDPSession } from './cdp/session';
import { launchChrome, type ChromeProcess } from './chrome/launcher';
import { CDPConnectionError, ChromeCrashedError } from './cdp/errors';
import { Logger } from './utils/logger';
import { AlyPage } from './page';
import type { LaunchOptions, ConnectOptions, Viewport } from './types';

const log = new Logger('browser');

export class AlyBrowser {
  private readonly client: CDPClient;
  private chromeProcess: ChromeProcess | null;
  private readonly defaultViewport: Viewport | null;
  private closed = false;

  private constructor(
    client: CDPClient,
    chromeProcess: ChromeProcess | null,
    defaultViewport: Viewport | null,
  ) {
    this.client = client;
    this.chromeProcess = chromeProcess;
    this.defaultViewport = defaultViewport;
  }

  /**
   * Launch a new Chrome instance and connect to it.
   */
  static async launch(options?: LaunchOptions): Promise<AlyBrowser> {
    const chrome = await launchChrome(options);
    log.debug('Chrome launched, connecting to', chrome.wsEndpoint);

    const transport = new CDPTransport();
    await transport.connect(chrome.wsEndpoint);
    const client = new CDPClient(transport);

    const browser = new AlyBrowser(
      client,
      chrome,
      options?.defaultViewport ?? { width: 1280, height: 720 },
    );

    chrome.process.on('exit', () => {
      if (!browser.closed) {
        log.warn('Chrome process exited unexpectedly');
      }
    });

    return browser;
  }

  /**
   * Connect to an existing Chrome instance via WebSocket or HTTP endpoint.
   */
  static async connect(options: ConnectOptions): Promise<AlyBrowser> {
    let wsEndpoint = options.browserWSEndpoint;

    if (!wsEndpoint && options.browserURL) {
      wsEndpoint = await AlyBrowser.resolveWSEndpoint(options.browserURL);
    }

    if (!wsEndpoint) {
      throw new CDPConnectionError('', 'Provide browserWSEndpoint or browserURL');
    }

    const transport = new CDPTransport();
    await transport.connect(wsEndpoint);
    const client = new CDPClient(transport);

    return new AlyBrowser(
      client,
      null,
      options.defaultViewport ?? { width: 1280, height: 720 },
    );
  }

  /**
   * Create a new page (tab) and return an AlyPage instance.
   */
  async newPage(): Promise<AlyPage> {
    this.ensureNotClosed();

    const { targetId } = (await this.client.send('Target.createTarget', {
      url: 'about:blank',
    })) as { targetId: string };

    log.debug('Created target', targetId);

    const { sessionId } = (await this.client.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    })) as { sessionId: string };

    log.debug('Attached to target, session', sessionId);

    const session = new CDPSession(this.client, sessionId);

    // Enable required domains (Runtime intentionally omitted — stealth)
    // Runtime.evaluate works without Runtime.enable.
    // Enabling Runtime leaks detectable side-effects to anti-bot systems.
    await Promise.all([
      session.enableDomain('Page'),
      session.enableDomain('DOM'),
    ]);

    // Set viewport if configured
    if (this.defaultViewport) {
      await session.send('Emulation.setDeviceMetricsOverride', {
        width: this.defaultViewport.width,
        height: this.defaultViewport.height,
        deviceScaleFactor: this.defaultViewport.deviceScaleFactor ?? 1,
        mobile: false,
      });
    }

    // Stealth: realistic user-agent & fingerprint patches
    await session.send('Emulation.setUserAgentOverride', {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      acceptLanguage: 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      platform: 'MacIntel',
    });

    await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        Object.defineProperty(navigator,'webdriver',{get:()=>undefined,configurable:true});
        if(!window.chrome)window.chrome={};
        if(!window.chrome.runtime)window.chrome.runtime={connect:function(){},sendMessage:function(){}};
        if(!window.chrome.app)window.chrome.app={isInstalled:false,InstallState:{DISABLED:'disabled',INSTALLED:'installed',NOT_INSTALLED:'not_installed'},RunningState:{CANNOT_RUN:'cannot_run',READY_TO_RUN:'ready_to_run',RUNNING:'running'}};
        if(!window.chrome.csi)window.chrome.csi=function(){return{onloadT:Date.now(),startE:Date.now(),pageT:0,tran:15}};
        if(!window.chrome.loadTimes)window.chrome.loadTimes=function(){return{commitLoadTime:Date.now()/1000,connectionInfo:'h2',finishDocumentLoadTime:Date.now()/1000,finishLoadTime:Date.now()/1000,firstPaintAfterLoadTime:0,firstPaintTime:Date.now()/1000,navigationType:'Other',npnNegotiatedProtocol:'h2',requestTime:Date.now()/1000,startLoadTime:Date.now()/1000,wasAlternateProtocolAvailable:false,wasFetchedViaSpdy:true,wasNpnNegotiated:true}};
        Object.defineProperty(navigator,'plugins',{get:()=>{const p=[{name:'Chrome PDF Plugin',filename:'internal-pdf-viewer',description:'Portable Document Format'},{name:'Chrome PDF Viewer',filename:'mhjfbmdgcfjbbpaeojofohoefgiehjai',description:''},{name:'Native Client',filename:'internal-nacl-plugin',description:''}];p.refresh=()=>{};return p}});
        Object.defineProperty(navigator,'languages',{get:()=>['ko-KR','ko','en-US','en']});
        const oq=window.navigator.permissions.query.bind(window.navigator.permissions);window.navigator.permissions.query=(p)=>p.name==='notifications'?Promise.resolve({state:Notification.permission}):oq(p);
      `,
    });

    return new AlyPage(session, targetId);
  }

  /**
   * List all open targets (pages).
   */
  async pages(): Promise<Array<{ targetId: string; url: string; title: string }>> {
    this.ensureNotClosed();

    const { targetInfos } = (await this.client.send('Target.getTargets')) as {
      targetInfos: Array<{ targetId: string; url: string; title: string; type: string }>;
    };

    return targetInfos
      .filter((t) => t.type === 'page')
      .map(({ targetId, url, title }) => ({ targetId, url, title }));
  }

  /**
   * Close the browser and kill the Chrome process.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    try {
      await this.client.send('Browser.close').catch(() => {});
    } finally {
      this.client.close();
    }

    if (this.chromeProcess) {
      await this.chromeProcess.kill();
      this.chromeProcess = null;
    }

    log.debug('Browser closed');
  }

  /**
   * Get the WebSocket endpoint URL (if available).
   */
  get wsEndpoint(): string | undefined {
    return this.chromeProcess?.wsEndpoint;
  }

  private ensureNotClosed(): void {
    if (this.closed) {
      throw new ChromeCrashedError();
    }
  }

  private static async resolveWSEndpoint(browserURL: string): Promise<string> {
    const url = browserURL.replace(/\/$/, '');
    const res = await fetch(`${url}/json/version`);

    if (!res.ok) {
      throw new CDPConnectionError(url, `HTTP ${res.status}`);
    }

    const data = (await res.json()) as { webSocketDebuggerUrl?: string };
    if (!data.webSocketDebuggerUrl) {
      throw new CDPConnectionError(url, 'No webSocketDebuggerUrl in /json/version');
    }

    return data.webSocketDebuggerUrl;
  }
}
