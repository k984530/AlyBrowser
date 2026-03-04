import { AlyBrowser } from './dist/index.js';
import { writeFileSync } from 'fs';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await AlyBrowser.connect({ browserURL: 'http://localhost:9222' });
const page = await browser.newPage();

await page.evaluate('Object.defineProperty(navigator, "webdriver", { get: () => undefined })');

// Google 로그인 페이지
await page.goto('https://accounts.google.com/signin');
await sleep(3000);

let snap = await page.snapshot();
const emailInput = snap.elements.find(el => el.role === 'textbox');
if (emailInput) {
  await page.click(emailInput.ref);
  await sleep(300);
  await page.type(emailInput.ref, 'alyduho984530@gmail.com', { delay: 100 });
  await sleep(500);

  snap = await page.snapshot();
  const nextBtn = snap.elements.find(el => el.role === 'button' && (el.name === '다음' || el.name === 'Next'));
  if (nextBtn) {
    await page.click(nextBtn.ref);
    await sleep(4000);
  }
}

snap = await page.snapshot();
console.log('URL:', snap.url);

if (snap.url.includes('rejected')) {
  console.log('CAPTCHA 페이지 감지!');

  // CAPTCHA 이미지를 canvas로 캡처
  const imgData = await page.evaluate(`
    (async () => {
      const imgs = document.querySelectorAll('img');
      for (const img of imgs) {
        const alt = (img.alt || '').toLowerCase();
        if (alt.includes('보안문자') || alt.includes('captcha') || alt.includes('로봇')) {
          await new Promise(r => { if (img.complete) r(); else img.onload = r; });
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          return canvas.toDataURL('image/png');
        }
      }
      // 이미지 없으면 모든 이미지의 alt/src 반환
      return JSON.stringify(Array.from(imgs).map(i => ({ alt: i.alt, src: i.src?.slice(0, 100), w: i.width, h: i.height })));
    })()
  `);

  if (typeof imgData === 'string' && imgData.startsWith('data:image')) {
    const base64 = imgData.replace(/^data:image\/png;base64,/, '');
    writeFileSync('/tmp/captcha.png', Buffer.from(base64, 'base64'));
    console.log('CAPTCHA_SAVED:/tmp/captcha.png');
  } else {
    console.log('이미지 직접 추출 실패. 이미지 목록:', imgData);

    // 전체 페이지를 html2canvas 스타일로 캡처 시도
    // 대안: CAPTCHA 영역의 좌표 기반 스크린샷 (CDP 직접 사용 필요)
    // AlyBrowser의 session에 접근할 수 없으므로 HTTP endpoint 사용
    const res = await fetch('http://localhost:9222/json');
    const targets = await res.json();
    const target = targets.find(t => t.url.includes('accounts.google'));

    if (target) {
      console.log('TARGET:', target.webSocketDebuggerUrl);

      // WebSocket으로 직접 스크린샷 요청
      const { default: WebSocket } = await import('ws');
      const ws = new WebSocket(target.webSocketDebuggerUrl);

      await new Promise(resolve => ws.on('open', resolve));

      // Page.captureScreenshot
      ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));

      const result = await new Promise(resolve => {
        ws.on('message', data => {
          const msg = JSON.parse(data.toString());
          if (msg.id === 1) resolve(msg);
        });
      });

      if (result.result && result.result.data) {
        writeFileSync('/tmp/captcha-full.png', Buffer.from(result.result.data, 'base64'));
        console.log('SCREENSHOT_SAVED:/tmp/captcha-full.png');
      }

      ws.close();
    }
  }
} else {
  console.log('CAPTCHA 없음 - 현재 페이지:', snap.url);
}
