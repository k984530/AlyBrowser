import { AlyBrowser } from './dist/index.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await AlyBrowser.connect({ browserURL: 'http://localhost:9222' });
const page = await browser.newPage();

// Step 1: CAPTCHA 해결 대기 (사용자가 수동으로 CAPTCHA 입력)
console.log('=== CAPTCHA 해결을 기다리는 중... ===');
console.log('Chrome 창에서 CAPTCHA를 풀고 "다음"을 클릭해주세요.');
console.log('비밀번호 페이지가 나타나면 자동으로 이어갑니다.\n');

// 기존 로그인 페이지 탭으로 이동
await page.goto('https://accounts.google.com');
await sleep(2000);

let loggedIn = false;
for (let i = 0; i < 60; i++) {
  await sleep(3000);
  let snap;
  try {
    snap = await page.snapshot();
  } catch {
    continue;
  }
  const url = snap.url;

  // 비밀번호 페이지 감지
  if (url.includes('challenge/pwd') || url.includes('v3/signin/challenge')) {
    console.log('\n=== 비밀번호 페이지 감지! 자동 입력 ===');
    await sleep(1000);
    snap = await page.snapshot();
    const pwInput = snap.elements.find(el => el.role === 'textbox');
    if (pwInput) {
      await page.click(pwInput.ref);
      await sleep(300);
      await page.type(pwInput.ref, 'k71300929!', { delay: 80 });
      await sleep(500);

      snap = await page.snapshot();
      const nextBtn = snap.elements.find(el => el.role === 'button' && (el.name === '다음' || el.name === 'Next'));
      if (nextBtn) {
        await page.click(nextBtn.ref);
        console.log('비밀번호 입력 + 로그인 클릭 완료');
        await sleep(6000);
      }
    }
  }

  // 로그인 성공 확인 (accounts.google.com에서 벗어남)
  snap = await page.snapshot();
  if (snap.url.includes('myaccount.google') || snap.url.includes('google.com/?') || (!snap.url.includes('accounts.google.com/v3/signin'))) {
    if (!snap.url.includes('accounts.google.com/v3/signin')) {
      console.log('\n=== 로그인 성공! ===');
      console.log('URL:', snap.url);
      loggedIn = true;
      break;
    }
  }

  if (i % 5 === 0) console.log('대기 중... (' + (i + 1) * 3 + '초)');
}

if (!loggedIn) {
  console.log('\n로그인 대기 시간 초과 (3분)');
  process.exit(1);
}

// Step 2: Flow 접속
console.log('\n=== Step 2: Google Flow 접속 ===');
await page.goto('https://labs.google/fx/tools/flow');
await sleep(5000);

let snap = await page.snapshot();
console.log('URL:', snap.url);

// 쿠키 동의
const agreeBtn = snap.elements.find(el => el.name === 'Agree' || el.name === '동의함');
if (agreeBtn) {
  await page.click(agreeBtn.ref);
  await sleep(1000);
}

// Create with Flow 클릭
snap = await page.snapshot();
const createBtn = snap.elements.find(el => el.name && el.name.includes('Create with Flow'));
if (createBtn) {
  console.log('Create with Flow 클릭');
  await page.click(createBtn.ref);
  await sleep(8000);
}

// 새 탭 확인
const tabs = await browser.pages();
console.log('\n탭 수:', tabs.length);
tabs.forEach((t, i) => console.log('  탭 ' + i + ':', t.url));

snap = await page.snapshot();
console.log('\nURL:', snap.url);
console.log('Title:', snap.title);

// 프롬프트 입력창 찾기
const promptInput = snap.elements.find(el =>
  el.role === 'textbox' &&
  (el.name?.toLowerCase().includes('prompt') || el.name?.toLowerCase().includes('describe'))
);

if (promptInput) {
  // Step 3: 영상 프롬프트 입력
  console.log('\n=== Step 3: 프롬프트 입력 ===');
  await page.type(promptInput.ref, 'A golden sunset over calm ocean waves with seagulls flying in slow motion, cinematic 4K');
  await sleep(1000);

  // Generate 버튼 찾기
  snap = await page.snapshot();
  const genBtn = snap.elements.find(el =>
    el.role === 'button' &&
    (el.name?.toLowerCase().includes('generate') ||
      el.name?.toLowerCase().includes('create') ||
      el.name?.includes('생성'))
  );

  if (genBtn) {
    console.log('Generate 클릭:', genBtn.ref);
    await page.click(genBtn.ref);
    console.log('\n=== Step 4: 영상 생성 대기 ===');

    // 최대 5분 대기
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      snap = await page.snapshot();

      const dlBtn = snap.elements.find(el =>
        el.name?.toLowerCase().includes('download') || el.name?.includes('다운로드')
      );

      if (dlBtn) {
        console.log('\n=== Step 5: 다운로드! ===');
        // 비디오 URL 추출
        const videoUrl = await page.evaluate(`
          (() => {
            const videos = document.querySelectorAll('video');
            for (const v of videos) {
              if (v.src && !v.src.startsWith('blob:')) return v.src;
              const source = v.querySelector('source');
              if (source && source.src && !source.src.startsWith('blob:')) return source.src;
            }
            return '';
          })()
        `);

        console.log('비디오 URL:', videoUrl);
        await page.click(dlBtn.ref);
        console.log('다운로드 클릭 완료!');
        await sleep(5000);
        break;
      }

      if (i % 6 === 0) {
        const elapsed = (i + 1) * 5;
        console.log('생성 중... (' + elapsed + '초)');
      }
    }
  }
} else {
  console.log('\n프롬프트 입력창을 찾지 못함');
  console.log('현재 요소:');
  snap.elements.slice(0, 60).forEach(el => console.log(el.ref + ' [' + el.role + '] "' + el.name + '"'));
  console.log('\nTREE:');
  console.log(snap.accessibilityText.slice(0, 5000));
}

console.log('\n=== 완료 ===');
