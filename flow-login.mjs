import { AlyBrowser } from './dist/index.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await AlyBrowser.connect({ browserURL: 'http://localhost:9222' });
const page = await browser.newPage();

// 자동화 감지 우회
await page.evaluate('Object.defineProperty(navigator, "webdriver", { get: () => undefined })');

// Step 1: Google 로그인
console.log('=== Step 1: Google 로그인 ===');
await page.goto('https://accounts.google.com/signin');
await sleep(3000);

let snap = await page.snapshot();
console.log('URL:', snap.url);

// 이메일 입력
const emailInput = snap.elements.find(el => el.role === 'textbox');
if (emailInput) {
  console.log('이메일 입력:', emailInput.ref);
  await page.click(emailInput.ref);
  await sleep(500);
  await page.type(emailInput.ref, 'alyduho984530@gmail.com', { delay: 100 });
  await sleep(1000);

  // 다음 버튼
  snap = await page.snapshot();
  const nextBtn = snap.elements.find(el => el.role === 'button' && (el.name === '다음' || el.name === 'Next'));
  if (nextBtn) {
    await page.click(nextBtn.ref);
    console.log('다음 클릭');
    await sleep(4000);
  }
}

// 결과 확인
snap = await page.snapshot();
console.log('\n현재 URL:', snap.url);

if (snap.url.includes('rejected')) {
  console.log('STATUS: REJECTED (CAPTCHA)');
  snap.elements.forEach(el => console.log(el.ref + ' [' + el.role + '] "' + el.name + '"'));

  // CAPTCHA 이미지가 있는지 확인하고, 있으면 텍스트 입력 시도
  const captchaInput = snap.elements.find(el => el.role === 'textbox' && el.name !== '이메일 또는 휴대전화');
  if (captchaInput) {
    console.log('\nCAPTCHA 입력창 발견:', captchaInput.ref);
    // CAPTCHA 이미지 스크린샷으로 확인
    const imgSrc = await page.evaluate(`
      const img = document.querySelector('img[src*="captcha"], img[alt*="보안문자"], img[alt*="captcha"]');
      img ? img.src : 'NO_IMG';
    `);
    console.log('CAPTCHA 이미지:', imgSrc);
  }
  console.log('\nTREE:', snap.accessibilityText.slice(0, 2000));
} else {
  console.log('STATUS: NOT REJECTED');
  // 비밀번호 페이지인지 확인
  const pwInput = snap.elements.find(el => el.role === 'textbox');
  if (pwInput) {
    console.log('비밀번호 입력:', pwInput.ref);
    await page.click(pwInput.ref);
    await sleep(300);
    await page.type(pwInput.ref, 'k71300929!', { delay: 80 });
    await sleep(1000);

    snap = await page.snapshot();
    const loginBtn = snap.elements.find(el => el.role === 'button' && (el.name === '다음' || el.name === 'Next'));
    if (loginBtn) {
      await page.click(loginBtn.ref);
      console.log('로그인 클릭');
      await sleep(6000);
    }

    snap = await page.snapshot();
    console.log('\n로그인 후 URL:', snap.url);
    console.log('Title:', snap.title);
  }

  // 로그인 성공 여부 확인
  snap = await page.snapshot();
  if (snap.url.includes('myaccount') || snap.url.includes('accounts.google.com/Default') || !snap.url.includes('accounts.google.com')) {
    console.log('\n=== 로그인 성공! ===');

    // Flow 접속
    console.log('\n=== Step 2: Flow 접속 ===');
    await page.goto('https://labs.google/fx/tools/flow');
    await sleep(5000);
    snap = await page.snapshot();
    console.log('URL:', snap.url);

    // 쿠키 동의
    const agreeBtn = snap.elements.find(el => el.name === 'Agree' || el.name === '동의함');
    if (agreeBtn) { await page.click(agreeBtn.ref); await sleep(1000); }

    // Create with Flow
    snap = await page.snapshot();
    const createBtn = snap.elements.find(el => el.name && el.name.includes('Create with Flow'));
    if (createBtn) {
      console.log('Create with Flow 클릭:', createBtn.ref);
      await page.click(createBtn.ref);
      await sleep(8000);
    }

    snap = await page.snapshot();
    console.log('\nFlow URL:', snap.url);
    console.log('Title:', snap.title);
    snap.elements.slice(0, 60).forEach(el => console.log(el.ref + ' [' + el.role + '] "' + el.name + '"'));
    console.log('\nTREE:', snap.accessibilityText.slice(0, 5000));
  }
}
