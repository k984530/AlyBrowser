import { AlyBrowser } from './dist/index.js';
import { writeFileSync } from 'fs';
import WebSocket from 'ws';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 1. Chrome 시작
console.log('=== Chrome 시작 ===');
const browser = await AlyBrowser.launch({
  headless: false,
  userDataDir: '/tmp/aly-captcha-profile',
  args: [
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
  ],
});
const page = await browser.newPage();

// wsEndpoint에서 포트 추출
const wsUrl = browser.wsEndpoint;
const port = new URL(wsUrl).port;
console.log('CDP port:', port);

// webdriver 감지 우회
await page.evaluate('Object.defineProperty(navigator, "webdriver", { get: () => undefined })');
await page.evaluate('delete navigator.__proto__.webdriver');

// 2. Google 로그인
console.log('=== Google 로그인 시도 ===');
await page.goto('https://accounts.google.com/signin');
await sleep(4000);

let snap = await page.snapshot();
console.log('URL:', snap.url);

// 이메일 입력
const emailInput = snap.elements.find(el => el.role === 'textbox');
if (emailInput) {
  await page.click(emailInput.ref);
  await sleep(300);
  await page.type(emailInput.ref, 'alyduho984530@gmail.com', { delay: 120 });
  await sleep(800);

  snap = await page.snapshot();
  const nextBtn = snap.elements.find(el => el.role === 'button' && (el.name === '다음' || el.name === 'Next'));
  if (nextBtn) {
    await page.click(nextBtn.ref);
    console.log('이메일 입력 + 다음 클릭 완료');
    await sleep(5000);
  }
}

// 3. 결과 확인
snap = await page.snapshot();
console.log('결과 URL:', snap.url);

// CDP로 스크린샷 찍기 (동적 포트 사용)
const res = await fetch(`http://127.0.0.1:${port}/json`);
const targets = await res.json();

// 현재 페이지의 타겟 찾기 (rejected 또는 accounts.google 포함)
const currentUrl = snap.url;
let target = targets.find(t => t.url.includes('rejected'));
if (!target) target = targets.find(t => t.url.includes('accounts.google'));
if (!target) target = targets[0];

console.log('스크린샷 타겟:', target.url);

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.on('open', resolve));

let msgId = 0;
function cdpSend(method, params = {}) {
  const id = ++msgId;
  return new Promise(resolve => {
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        ws.off('message', handler);
        resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// 전체 페이지 스크린샷
const screenshot = await cdpSend('Page.captureScreenshot', { format: 'png', quality: 100 });
if (screenshot && screenshot.data) {
  writeFileSync('/tmp/captcha-page.png', Buffer.from(screenshot.data, 'base64'));
  console.log('SAVED: /tmp/captcha-page.png');
}

ws.close();

// 페이지 정보 출력
console.log('\n=== 페이지 요소 ===');
snap.elements.forEach(el => console.log(el.ref + ' [' + el.role + '] "' + el.name + '"'));
console.log('\n=== 접근성 트리 (처음 3000자) ===');
console.log(snap.accessibilityText.slice(0, 3000));

// 브라우저는 닫지 않음 (CAPTCHA 입력을 위해)
console.log('\n=== Chrome 유지 중 (port ' + port + ') ===');
console.log('CAPTCHA 해결 후 다음 단계 진행 가능');
