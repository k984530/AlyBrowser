import { writeFileSync } from 'fs';
import WebSocket from 'ws';

// 현재 열려있는 Google 로그인 탭 찾기
const res = await fetch('http://localhost:9222/json');
const targets = await res.json();
const target = targets.find(t => t.url.includes('accounts.google'));

if (!target) {
  console.log('Google 로그인 탭을 찾을 수 없음');
  console.log('열린 탭:', targets.map(t => t.url));
  process.exit(1);
}

console.log('타겟:', target.url);
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
