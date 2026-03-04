import { AlyBrowser } from './dist/index.js';
import { writeFileSync } from 'fs';
import WebSocket from 'ws';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Chrome 시작 (non-headless)
const browser = await AlyBrowser.launch({
  headless: false,
  userDataDir: '/tmp/aly-css-test',
  args: ['--window-size=1280,900'],
});
const page = await browser.newPage();

const wsUrl = browser.wsEndpoint;
const port = new URL(wsUrl).port;

// 1) Naver 테스트 (CSS가 잘 적용되는 사이트)
await page.goto('https://www.naver.com');
await sleep(3000);

// CDP 스크린샷
const res = await fetch(`http://127.0.0.1:${port}/json`);
const targets = await res.json();
const target = targets.find(t => t.url.includes('naver.com'));

if (target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.on('open', resolve));

  ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png', quality: 100 } }));
  const result = await new Promise(resolve => {
    ws.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 1) resolve(msg);
    });
  });

  if (result.result?.data) {
    writeFileSync('/tmp/naver-css-test.png', Buffer.from(result.result.data, 'base64'));
    console.log('SAVED: /tmp/naver-css-test.png');
  }
  ws.close();
}

// 2) Google 메인페이지 테스트 (로그인 아닌 메인)
await page.goto('https://www.google.com');
await sleep(3000);

const res2 = await fetch(`http://127.0.0.1:${port}/json`);
const targets2 = await res2.json();
const target2 = targets2.find(t => t.url.includes('google.com'));

if (target2) {
  const ws2 = new WebSocket(target2.webSocketDebuggerUrl);
  await new Promise(resolve => ws2.on('open', resolve));

  ws2.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png', quality: 100 } }));
  const result2 = await new Promise(resolve => {
    ws2.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 1) resolve(msg);
    });
  });

  if (result2.result?.data) {
    writeFileSync('/tmp/google-css-test.png', Buffer.from(result2.result.data, 'base64'));
    console.log('SAVED: /tmp/google-css-test.png');
  }
  ws2.close();
}

// HTML 소스도 덤프 (CSS 참조 확인용)
const html = await page.evaluate('document.documentElement.outerHTML');
writeFileSync('/tmp/google-source.html', html);
console.log('HTML source saved');

await browser.close();
console.log('Done');
