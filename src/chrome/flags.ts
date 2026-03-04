export function getDefaultFlags(options?: { headless?: boolean }): string[] {
  const headless = options?.headless ?? true;

  const flags = [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-features=TranslateUI',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--force-color-profile=srgb',
    '--metrics-recording-only',
    '--no-first-run',
    '--password-store=basic',
    '--use-mock-keychain',
    '--export-tagged-pdf',
    '--disable-blink-features=AutomationControlled',
  ];

  if (!headless) {
    // headful 모드: 화면 밖에 배치하여 사용자에게 보이지 않게
    flags.push(
      '--window-position=-9999,-9999',
      '--window-size=1280,720',
    );
  }

  if (headless) {
    // headless 모드에서만 적용 — 리소스 로딩에 영향 없음
    flags.push(
      '--headless=new',
      '--no-startup-window',
      '--disable-background-networking',
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--enable-features=NetworkService,NetworkServiceInProcess',
    );
  }

  return flags;
}
