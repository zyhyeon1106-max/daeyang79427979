// === 7942 학급 독서 미션 Frontend Logic ===

const GOAL_MINUTES = 4782; // 79시간 42분
const GOAL_PAGES = 7942;   // 7,942쪽

// 행사 기간: 2026-10-12 ~ 2026-10-23 (대한민국 표준시 기준)
const EVENT_START = { year: 2026, month: 10, day: 12 };
const EVENT_END = { year: 2026, month: 10, day: 23 };

function kstDateSerial(year, month, day) {
  // 달력 날짜 간 차이만 계산하기 위한 UTC 자정 직렬값
  return Date.UTC(year, month - 1, day);
}

function getTodayInKorea() {
  // 기기 시간대와 관계없이 한국 날짜(UTC+9)를 사용
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  return {
    year: kst.getUTCFullYear(),
    month: kst.getUTCMonth() + 1,
    day: kst.getUTCDate()
  };
}

function updateEventStatusBanner() {
  const banner = document.getElementById('event-status-banner');
  const textEl = document.getElementById('event-status-text');
  if (!banner || !textEl) return;

  const today = getTodayInKorea();
  const todaySerial = kstDateSerial(today.year, today.month, today.day);
  const startSerial = kstDateSerial(EVENT_START.year, EVENT_START.month, EVENT_START.day);
  const endSerial = kstDateSerial(EVENT_END.year, EVENT_END.month, EVENT_END.day);
  const oneDay = 24 * 60 * 60 * 1000;

  banner.classList.remove('before', 'during', 'after');

  if (todaySerial < startSerial) {
    const daysLeft = Math.round((startSerial - todaySerial) / oneDay);
    banner.classList.add('before');
    textEl.textContent = `행사 기간 2026.10.12.(월) ~ 10.23.(금) · 시작까지 D-${daysLeft}`;
    return;
  }

  if (todaySerial <= endSerial) {
    const eventDay = Math.floor((todaySerial - startSerial) / oneDay) + 1;
    const daysToEnd = Math.round((endSerial - todaySerial) / oneDay);
    banner.classList.add('during');
    textEl.textContent = daysToEnd === 0
      ? `행사 기간 2026.10.12.(월) ~ 10.23.(금) · 오늘은 행사 ${eventDay}일째 · 오늘이 마지막 날!`
      : `행사 기간 2026.10.12.(월) ~ 10.23.(금) · 오늘은 행사 ${eventDay}일째 · 종료까지 D-${daysToEnd}`;
    return;
  }

  banner.classList.add('after');
  textEl.textContent = '7942 학급 독서 미션 행사가 종료되었습니다. (2026.10.12.~10.23.)';
}

const state = {
  token: localStorage.getItem('token_7942') || null,
  currentClass: null,
  recentRecords: [],
  selectedGradeLogin: 3,
  selectedGradeReg: 3,
  isAdmin: sessionStorage.getItem('is_admin_7942') === 'true',
  adminKey: sessionStorage.getItem('admin_key_7942') || '',
  timer: {
    intervalId: null,
    seconds: 0,
    isRunning: false,
    isPaused: false,
    currentBook: '',
    currentStudent: ''
  }
};

// Colors for the stacked books
const BOOK_COLORS = [
  '#FF6B6B', '#4ECDC4', '#FFE66D', '#FF8E53', '#9B51E0',
  '#2ED573', '#1E90FF', '#FD79A8', '#00B894', '#6C5CE7'
];

const BOOK_TITLES = [
  '동화나라', '지혜의 숲', '우리 반 이야기', '상상 여행', '꿈꾸는 교실',
  '마법의 책', '위대한 모험', '행복한 독서', '7942 완주!'
];

// Helper: API fetch wrapper
async function api(endpoint, options = {}) {
  const headers = options.headers || {};
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  if (options.body && typeof options.body === 'object') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  options.headers = headers;

  const res = await fetch(endpoint, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || '요청 처리 중 오류가 발생했습니다.');
  }
  return data;
}

// Helper: Show toast notification
function showToast(message) {
  const toast = document.getElementById('toast-message');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

// Helper: Common Modal Confirm Dialog
function showModal({ icon = '⚠️', title, desc, onConfirm }) {
  const modal = document.getElementById('common-modal');
  document.getElementById('modal-icon').textContent = icon;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-desc').innerHTML = desc;

  const btnConfirm = document.getElementById('btn-modal-confirm');
  const btnCancel = document.getElementById('btn-modal-cancel');

  modal.classList.add('active');

  const cleanup = () => {
    modal.classList.remove('active');
    btnConfirm.onclick = null;
    btnCancel.onclick = null;
  };

  btnConfirm.onclick = () => {
    cleanup();
    if (onConfirm) onConfirm();
  };

  btnCancel.onclick = () => {
    cleanup();
  };
}

// Navigation switcher
function switchPage(pageId) {
  document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const targetPage = document.getElementById(pageId);
  if (targetPage) {
    targetPage.classList.add('active');
  }

  if (pageId === 'page-auth') {
    document.getElementById('nav-btn-auth').classList.add('active');
  } else if (pageId === 'page-my-class') {
    document.getElementById('nav-btn-my-class').classList.add('active');
    loadMyClassData();
  } else if (pageId === 'page-school') {
    document.getElementById('nav-btn-school').classList.add('active');
    loadSchoolData();
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  updateEventStatusBanner();
  setInterval(updateEventStatusBanner, 60 * 1000);

  setupGradeButtons();
  setupAuthTabs();
  setupFormHandlers();
  setupTimerHandlers();
  setupNavButtons();
  setupAdminHandlers();

  // Check login session
  if (state.token) {
    try {
      const data = await api('/api/me');
      if (data.loggedIn && data.class) {
        state.currentClass = data.class;
        updateAuthUI(true);
        switchPage('page-my-class');
        return;
      }
    } catch (e) {
      console.error(e);
      localStorage.removeItem('token_7942');
      state.token = null;
    }
  }

  updateAuthUI(false);
  switchPage('page-auth');
});

// Setup navigation bar buttons
function setupNavButtons() {
  document.getElementById('brand-home-btn').addEventListener('click', () => {
    if (state.currentClass) {
      switchPage('page-my-class');
    } else {
      switchPage('page-auth');
    }
  });

  document.getElementById('nav-btn-auth').addEventListener('click', () => switchPage('page-auth'));
  document.getElementById('nav-btn-my-class').addEventListener('click', () => {
    if (!state.currentClass) {
      showToast('먼저 우리 반으로 입장해 주세요!');
      switchPage('page-auth');
      return;
    }
    switchPage('page-my-class');
  });
  document.getElementById('nav-btn-school').addEventListener('click', () => switchPage('page-school'));

  document.getElementById('btn-logout').addEventListener('click', async () => {
    try {
      await api('/api/classes/logout', { method: 'POST' });
    } catch (e) {}
    localStorage.removeItem('token_7942');
    state.token = null;
    state.currentClass = null;
    updateAuthUI(false);
    showToast('로그아웃 되었습니다.');
    switchPage('page-auth');
  });
}

// Update authentication badges in navigation
function updateAuthUI(isLoggedIn) {
  const myClassBtn = document.getElementById('nav-btn-my-class');
  const authContainer = document.getElementById('auth-status-container');
  const badgeText = document.getElementById('current-class-badge-text');

  if (isLoggedIn && state.currentClass) {
    myClassBtn.style.display = 'inline-flex';
    authContainer.style.display = 'block';
    badgeText.textContent = `${state.currentClass.grade}학년 ${state.currentClass.classNumber}반 접속 중`;
  } else {
    myClassBtn.style.display = 'none';
    authContainer.style.display = 'none';
  }
}

// Setup Grade Buttons for Login & Registration
function setupGradeButtons() {
  const loginGroup = document.getElementById('login-grade-group');
  loginGroup.querySelectorAll('.grade-choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      loginGroup.querySelectorAll('.grade-choice-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.selectedGradeLogin = parseInt(btn.dataset.grade, 10);
    });
  });

  const regGroup = document.getElementById('reg-grade-group');
  regGroup.querySelectorAll('.grade-choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      regGroup.querySelectorAll('.grade-choice-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.selectedGradeReg = parseInt(btn.dataset.grade, 10);
    });
  });
}

// Setup Tab Switching in Auth Screen
function setupAuthTabs() {
  const tabLogin = document.getElementById('tab-btn-login');
  const tabRegister = document.getElementById('tab-btn-register');
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');

  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    formLogin.style.display = 'block';
    formRegister.style.display = 'none';
  });

  tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    formRegister.style.display = 'block';
    formLogin.style.display = 'none';
  });
}

// Setup Auth & Input Forms
function setupFormHandlers() {
  // 1. Login Form Submit
  const formLogin = document.getElementById('form-login');
  const btnLoginSubmit = document.getElementById('btn-login-submit');

  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const classNum = parseInt(document.getElementById('login-class-number').value, 10);
    const pin = document.getElementById('login-pin').value.trim();

    if (!classNum || classNum < 1) {
      showToast('반 번호를 올바르게 입력해 주세요.');
      return;
    }
    if (!pin) {
      showToast('4자리 학급 비밀번호를 입력해 주세요.');
      return;
    }

    btnLoginSubmit.disabled = true;
    btnLoginSubmit.textContent = '확인 중... ⏳';

    try {
      const res = await api('/api/classes/login', {
        method: 'POST',
        body: {
          grade: state.selectedGradeLogin,
          classNumber: classNum,
          pin
        }
      });

      state.token = res.token;
      localStorage.setItem('token_7942', res.token);
      state.currentClass = res.class;
      updateAuthUI(true);
      showToast(res.message);
      switchPage('page-my-class');
    } catch (err) {
      showToast(`❌ ${err.message}`);
    } finally {
      btnLoginSubmit.disabled = false;
      btnLoginSubmit.textContent = '우리 반으로 들어가기 🚀';
    }
  });

  // 2. Registration Form Submit
  const formRegister = document.getElementById('form-register');
  const btnRegSubmit = document.getElementById('btn-register-submit');

  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    const classNum = parseInt(document.getElementById('reg-class-number').value, 10);
    const pin = document.getElementById('reg-pin').value.trim();
    const checkTime = document.getElementById('reg-check-time').checked;
    const checkPages = document.getElementById('reg-check-pages').checked;

    if (!classNum || classNum < 1) {
      showToast('반 번호를 올바르게 입력해 주세요.');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      showToast('학급 비밀번호는 숫자 4자리로 입력해 주세요.');
      return;
    }

    const selectedMissions = [];
    if (checkTime) selectedMissions.push('time');
    if (checkPages) selectedMissions.push('pages');

    if (selectedMissions.length === 0) {
      showToast('참여할 미션을 최소 1개 이상 선택해 주세요.');
      return;
    }

    btnRegSubmit.disabled = true;
    btnRegSubmit.textContent = '등록 중... ⏳';

    try {
      const res = await api('/api/classes/register', {
        method: 'POST',
        body: {
          grade: state.selectedGradeReg,
          classNumber: classNum,
          pin,
          selectedMissions
        }
      });

      state.token = res.token;
      localStorage.setItem('token_7942', res.token);
      state.currentClass = res.class;
      updateAuthUI(true);
      showToast(res.message);
      if (typeof window.celebrateConfetti === 'function') {
        window.celebrateConfetti();
      }
      switchPage('page-my-class');
    } catch (err) {
      showToast(`❌ ${err.message}`);
    } finally {
      btnRegSubmit.disabled = false;
      btnRegSubmit.textContent = '우리 반 미션 시작하기 ✨';
    }
  });

  // 3. Direct Reading Time Submit (with Book Title)
  const formAddTime = document.getElementById('form-add-time');
  const btnSubmitTime = document.getElementById('btn-submit-time');

  formAddTime.addEventListener('submit', async (e) => {
    e.preventDefault();
    const minutes = parseInt(document.getElementById('input-time-minutes').value, 10);
    const bookTitle = document.getElementById('input-time-book').value.trim();
    const studentName = document.getElementById('input-time-student').value.trim();

    if (!bookTitle) {
      showToast('📖 읽은 책 제목을 입력해 주세요!');
      return;
    }

    if (!minutes || minutes <= 0) {
      showToast('1 이상의 올바른 시간을 입력해 주세요.');
      return;
    }

    // Input Safeguard: abnormal large number check (> 300 minutes = 5 hours)
    if (minutes > 300) {
      const hoursEst = (minutes / 60).toFixed(1);
      showModal({
        icon: '⚠️',
        title: '입력한 시간이 맞나요?',
        desc: `<strong>${minutes}분</strong>은 약 <strong>${hoursEst}시간</strong>에 해당합니다.<br>책: <strong>${escapeHtml(bookTitle)}</strong><br>입력한 숫자가 맞는지 확인 후 기록해 주세요!`,
        onConfirm: () => submitReadingRecord('time', minutes, bookTitle, studentName, formAddTime, btnSubmitTime)
      });
      return;
    }

    submitReadingRecord('time', minutes, bookTitle, studentName, formAddTime, btnSubmitTime);
  });

  // 4. Direct Pages Submit (with Book Title)
  const formAddPages = document.getElementById('form-add-pages');
  const btnSubmitPages = document.getElementById('btn-submit-pages');

  formAddPages.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pages = parseInt(document.getElementById('input-pages-amount').value, 10);
    const bookTitle = document.getElementById('input-pages-book').value.trim();
    const studentName = document.getElementById('input-pages-student').value.trim();

    if (!bookTitle) {
      showToast('📖 읽은 책 제목을 입력해 주세요!');
      return;
    }

    if (!pages || pages <= 0) {
      showToast('1 이상의 올바른 쪽수를 입력해 주세요.');
      return;
    }

    // Input Safeguard: abnormal large number check (> 500 pages)
    if (pages > 500) {
      showModal({
        icon: '⚠️',
        title: '입력한 쪽수가 맞나요?',
        desc: `<strong>${pages.toLocaleString()}쪽</strong>은 한 번에 읽기에 매우 많은 양입니다.<br>책: <strong>${escapeHtml(bookTitle)}</strong><br>입력한 숫자가 맞는지 확인 후 기록해 주세요!`,
        onConfirm: () => submitReadingRecord('pages', pages, bookTitle, studentName, formAddPages, btnSubmitPages)
      });
      return;
    }

    submitReadingRecord('pages', pages, bookTitle, studentName, formAddPages, btnSubmitPages);
  });
}

// Submits a reading record to the backend with double-click prevention
async function submitReadingRecord(type, amount, bookTitle, studentName, formElement, btnElement) {
  if (btnElement) {
    btnElement.disabled = true;
    btnElement.textContent = '기록 중... ⏳';
  }

  try {
    const res = await api('/api/records', {
      method: 'POST',
      body: {
        type,
        amount,
        bookTitle: bookTitle || '책 읽기',
        studentName: studentName || null
      }
    });

    showToast(res.message);
    if (formElement) formElement.reset();

    // Check if new milestone or completion reached
    const prevClass = state.currentClass;
    state.currentClass = res.updatedClass;

    const becameTimeDone = type === 'time' && prevClass.totalMinutes < GOAL_MINUTES && res.updatedClass.totalMinutes >= GOAL_MINUTES;
    const becamePagesDone = type === 'pages' && prevClass.totalPages < GOAL_PAGES && res.updatedClass.totalPages >= GOAL_PAGES;

    if (becameTimeDone || becamePagesDone) {
      if (typeof window.celebrateConfetti === 'function') {
        window.celebrateConfetti();
      }
    }

    await loadMyClassData();
  } catch (err) {
    showToast(`❌ ${err.message}`);
  } finally {
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.textContent = type === 'time' ? '기록하기 📝' : '기록하기 📖';
    }
  }
}

// Method B: Reading Timer Logic
function setupTimerHandlers() {
  const btnStart = document.getElementById('btn-timer-start');
  const btnPause = document.getElementById('btn-timer-pause');
  const btnStop = document.getElementById('btn-timer-stop');
  const timerDisplay = document.getElementById('timer-display');
  const timerConfirmBox = document.getElementById('timer-confirm-box');
  const btnTimerRecord = document.getElementById('btn-timer-record');
  const btnTimerDiscard = document.getElementById('btn-timer-discard');
  const timerConfirmText = document.getElementById('timer-confirm-text');
  const timerConfirmBookDisplay = document.getElementById('timer-confirm-book-display');
  const inputTimerBook = document.getElementById('input-timer-book');
  const inputTimerStudent = document.getElementById('input-timer-student');

  let measuredMinutes = 0;

  function updateTimerText() {
    const s = state.timer.seconds;
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    timerDisplay.textContent = 
      `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  btnStart.addEventListener('click', () => {
    const bookTitle = inputTimerBook.value.trim();
    if (!bookTitle) {
      showToast('📖 읽을 책 제목을 먼저 입력해 주세요!');
      inputTimerBook.focus();
      return;
    }

    state.timer.currentBook = bookTitle;
    state.timer.currentStudent = inputTimerStudent.value.trim();
    state.timer.isRunning = true;
    state.timer.isPaused = false;
    timerConfirmBox.style.display = 'none';

    btnStart.style.display = 'none';
    btnPause.style.display = 'inline-flex';
    btnStop.style.display = 'inline-flex';
    timerDisplay.classList.add('active-timing');

    if (state.timer.intervalId) clearInterval(state.timer.intervalId);
    state.timer.intervalId = setInterval(() => {
      state.timer.seconds++;
      updateTimerText();
    }, 1000);
  });

  btnPause.addEventListener('click', () => {
    if (!state.timer.isPaused) {
      // Pause
      clearInterval(state.timer.intervalId);
      state.timer.isPaused = true;
      btnPause.textContent = '▶ 다시 시작';
      timerDisplay.classList.remove('active-timing');
    } else {
      // Resume
      state.timer.isPaused = false;
      btnPause.textContent = '⏸ 잠시 멈춤';
      timerDisplay.classList.add('active-timing');
      state.timer.intervalId = setInterval(() => {
        state.timer.seconds++;
        updateTimerText();
      }, 1000);
    }
  });

  btnStop.addEventListener('click', () => {
    clearInterval(state.timer.intervalId);
    timerDisplay.classList.remove('active-timing');

    const totalSecs = state.timer.seconds;
    measuredMinutes = Math.max(1, Math.round(totalSecs / 60));

    timerConfirmText.innerHTML = `측정된 독서 시간: <strong>${measuredMinutes}분</strong> (${totalSecs}초)`;
    timerConfirmBookDisplay.innerHTML = `읽은 책: <strong>${escapeHtml(state.timer.currentBook || '책 읽기')}</strong>`;
    timerConfirmBox.style.display = 'block';

    btnStart.style.display = 'inline-flex';
    btnPause.style.display = 'none';
    btnStop.style.display = 'none';
    btnPause.textContent = '⏸ 잠시 멈춤';
  });

  btnTimerRecord.addEventListener('click', async () => {
    btnTimerRecord.disabled = true;
    btnTimerRecord.textContent = '기록 중...';

    try {
      await submitReadingRecord(
        'time', 
        measuredMinutes, 
        state.timer.currentBook || '책 읽기', 
        state.timer.currentStudent || null, 
        null, 
        null
      );
      // Reset timer
      state.timer.seconds = 0;
      updateTimerText();
      timerConfirmBox.style.display = 'none';
      inputTimerBook.value = '';
      inputTimerStudent.value = '';
    } finally {
      btnTimerRecord.disabled = false;
      btnTimerRecord.textContent = '기록하기 📚';
    }
  });

  btnTimerDiscard.addEventListener('click', () => {
    state.timer.seconds = 0;
    updateTimerText();
    timerConfirmBox.style.display = 'none';
  });
}

// Load and render My Class Data
async function loadMyClassData() {
  if (!state.token) return;

  try {
    const data = await api('/api/my-class');
    state.currentClass = data.class;
    state.recentRecords = data.records;
    renderMyClassDashboard();
  } catch (err) {
    showToast(`학급 정보 불러오기 실패: ${err.message}`);
  }
}

// Render the entire Page 2: Our Class Dashboard
function renderMyClassDashboard() {
  const cls = state.currentClass;
  if (!cls) return;

  // Header Title & Badges
  document.getElementById('view-class-title').textContent = `${cls.grade}학년 ${cls.classNumber}반의 7942 독서 미션`;

  const badgesRow = document.getElementById('view-class-badges');
  badgesRow.innerHTML = '';

  const missions = cls.selectedMissions || ['time', 'pages'];
  if (missions.includes('time')) {
    const b = document.createElement('span');
    b.className = 'badge-pill badge-time';
    b.innerHTML = '📚 시간 미션 참여 중';
    badgesRow.appendChild(b);
  }
  if (missions.includes('pages')) {
    const b = document.createElement('span');
    b.className = 'badge-pill badge-pages';
    b.innerHTML = '🏃 쪽수 미션 참여 중';
    badgesRow.appendChild(b);
  }

  // Check completions
  const isTimeDone = missions.includes('time') && cls.totalMinutes >= GOAL_MINUTES;
  const isPagesDone = missions.includes('pages') && cls.totalPages >= GOAL_PAGES;
  const isDoubleDone = isTimeDone && isPagesDone;

  const doubleBanner = document.getElementById('double-mission-banner');
  if (isDoubleDone) {
    doubleBanner.style.display = 'block';
  } else {
    doubleBanner.style.display = 'none';
  }

  // MISSION 1: Time
  const cardTime = document.getElementById('card-mission-time');
  if (missions.includes('time')) {
    cardTime.style.display = 'block';
    const hrs = Math.floor(cls.totalMinutes / 60);
    const remMins = cls.totalMinutes % 60;
    const timePct = Math.min(100, (cls.totalMinutes / GOAL_MINUTES) * 100);

    document.getElementById('time-current-text').textContent = `현재 ${hrs}시간 ${remMins}분`;
    document.getElementById('time-percentage-text').textContent = `${timePct.toFixed(1)}% 달성`;
    document.getElementById('time-progress-bar').style.width = `${timePct}%`;

    const timeBanner = document.getElementById('time-success-banner');
    if (isTimeDone) {
      timeBanner.style.display = 'block';
    } else {
      timeBanner.style.display = 'none';
    }

    renderBookStack(timePct, cls.totalMinutes);
  } else {
    cardTime.style.display = 'none';
  }

  // MISSION 2: Pages
  const cardPages = document.getElementById('card-mission-pages');
  if (missions.includes('pages')) {
    cardPages.style.display = 'block';
    const pagesPct = Math.min(100, (cls.totalPages / GOAL_PAGES) * 100);

    document.getElementById('pages-current-text').textContent = `현재 ${cls.totalPages.toLocaleString()}쪽`;
    document.getElementById('pages-percentage-text').textContent = `${pagesPct.toFixed(1)}% 달성`;

    const pagesBanner = document.getElementById('pages-success-banner');
    if (isPagesDone) {
      pagesBanner.style.display = 'block';
    } else {
      pagesBanner.style.display = 'none';
    }

    renderMarathonRunner(pagesPct, cls.totalPages);
  } else {
    cardPages.style.display = 'none';
  }

  // Recent records in Kakao-style chat feed
  renderRecentRecords();
}

// Mission 1: Book Stack Visualizer
function renderBookStack(percentage, totalMinutes) {
  const container = document.getElementById('book-stack-container');
  // Clear any existing stacked books, keep base and mascot
  container.querySelectorAll('.stacked-book').forEach(b => b.remove());

  const mascot = document.getElementById('book-mascot');
  const desc = document.getElementById('book-stack-desc');

  // Determine book count: 0 to 9 books based on percentage
  const bookCount = Math.min(9, Math.floor(percentage / 11) + (totalMinutes > 0 ? 1 : 0));

  for (let i = 0; i < bookCount; i++) {
    const book = document.createElement('div');
    book.className = 'stacked-book';
    const color = BOOK_COLORS[i % BOOK_COLORS.length];
    book.style.backgroundColor = color;
    const widths = [140, 130, 145, 125, 135, 120, 130, 115, 125];
    book.style.width = `${widths[i % widths.length]}px`;
    book.innerHTML = `<span class="book-spine-text">${BOOK_TITLES[i % BOOK_TITLES.length]}</span>`;
    container.appendChild(book);
  }

  // Position mascot on top of the books
  const mascotBottom = 12 + bookCount * 15;
  mascot.style.bottom = `${mascotBottom}px`;

  if (percentage >= 100) {
    mascot.textContent = '👑📚✨';
    desc.textContent = '🎉 와아! 79시간 42분 목표를 완주하여 책 탑의 꼭대기에 도달했습니다!';
  } else if (bookCount > 0) {
    mascot.textContent = '📖✨';
    desc.textContent = `우리 반이 함께 모은 독서 시간으로 ${bookCount}층의 지혜 탑이 세워졌어요!`;
  } else {
    mascot.textContent = '🌱📚';
    desc.textContent = '책을 읽고 기록하면 책 탑이 점점 높이 쌓여요!';
  }
}

// Mission 2: Marathon Runner Visualizer
function renderMarathonRunner(percentage, totalPages) {
  const runner = document.getElementById('marathon-runner');
  const bubble = document.getElementById('runner-bubble');

  // Clamp left between 2% and 94%
  const clampedPos = Math.min(94, Math.max(2, percentage));
  runner.style.left = `${clampedPos}%`;

  if (percentage >= 100) {
    bubble.textContent = '🏆 7,942쪽 완주 성공!';
    bubble.style.background = '#ECC94B';
    bubble.style.color = '#744210';
  } else if (percentage >= 75) {
    bubble.textContent = '결승선이 보여요! 🏁';
  } else if (percentage >= 50) {
    bubble.textContent = '절반 돌파! 힘내요! 💨';
  } else if (totalPages > 0) {
    bubble.textContent = '달리는 중! 🏃';
  } else {
    bubble.textContent = '출발 준비! 🏁';
  }
}

// Render Recent Records in KAKAO-STYLE CHAT BUBBLE FEED
function renderRecentRecords() {
  const listContainer = document.getElementById('recent-records-list');
  listContainer.innerHTML = '';

  if (!state.recentRecords || state.recentRecords.length === 0) {
    listContainer.innerHTML = '<div class="no-records-msg">아직 등록된 독서 기록이 없습니다. 첫 번째 책을 읽고 기록해 보세요! 📖</div>';
    return;
  }

  state.recentRecords.forEach(rec => {
    const item = document.createElement('div');
    const isTime = rec.type === 'time';
    item.className = `chat-bubble-card ${isTime ? 'bubble-time' : 'bubble-pages'}`;

    const dateStr = formatFriendlyDate(rec.createdAt);
    const senderName = rec.studentName ? escapeHtml(rec.studentName) : '익명';
    const bookTitle = rec.bookTitle ? escapeHtml(rec.bookTitle) : '재미있는 책';
    const amountText = isTime ? `⏱️ ${rec.amount}분 읽었어요!` : `📄 ${rec.amount.toLocaleString()}쪽 읽었어요!`;
    const badgeClass = isTime ? 'chat-amount-time' : 'chat-amount-pages';

    item.innerHTML = `
      <div class="chat-sender-row">
        <span class="chat-sender-name">
          <span class="chat-sender-avatar">👤</span>
          ${senderName}
        </span>
      </div>
      <div class="chat-bubble-body">
        <div class="chat-book-title">📖 ${bookTitle}</div>
        <span class="chat-amount-badge ${badgeClass}">${amountText}</span>
      </div>
      <div class="chat-bubble-footer">
        <button type="button" class="btn-bubble-delete" data-id="${rec.id}">
          기록 취소
        </button>
        <span class="chat-timestamp">${dateStr}</span>
      </div>
    `;

    // Cancellation handler with confirmation prompt
    const cancelBtn = item.querySelector('.btn-bubble-delete');
    cancelBtn.addEventListener('click', () => {
      showModal({
        icon: '🗑️',
        title: '독서 기록 취소',
        desc: `<strong>「${bookTitle}」</strong> (${rec.amount}${isTime ? '분' : '쪽'}) 기록을 정말 취소하시겠습니까?<br>학급 누적 합계에서 차감됩니다.`,
        onConfirm: async () => {
          try {
            const res = await api(`/api/records/${rec.id}`, { method: 'DELETE' });
            showToast(res.message);
            state.currentClass = res.updatedClass;
            await loadMyClassData();
          } catch (err) {
            showToast(`❌ ${err.message}`);
          }
        }
      });
    });

    listContainer.appendChild(item);
  });
}

// Helper: Friendly Korean date & time string formatter
function formatFriendlyDate(isoString) {
  if (!isoString) return '방금 전';
  let parseable = String(isoString).replace(' ', 'T');
  if (!parseable.endsWith('Z') && !parseable.includes('+')) {
    parseable += 'Z';
  }
  const d = new Date(parseable);
  const now = new Date();

  const isSameYear = d.getFullYear() === now.getFullYear();
  const isToday = isSameYear && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = isSameYear && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();

  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');

  if (isToday) {
    return `오늘 ${hours}:${minutes}`;
  } else if (isYesterday) {
    return `어제 ${hours}:${minutes}`;
  } else if (isSameYear) {
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${hours}:${minutes}`;
  } else {
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${hours}:${minutes}`;
  }
}

// Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

// Setup Admin Authentication & Controls
function setupAdminHandlers() {
  const btnNavAdmin = document.getElementById('nav-btn-admin');
  const adminModal = document.getElementById('admin-modal');
  const btnAdminCancel = document.getElementById('btn-admin-cancel');
  const formAdminLogin = document.getElementById('form-admin-login');
  const inputAdminKey = document.getElementById('input-admin-key');
  const btnAdminLogout = document.getElementById('btn-admin-logout');

  btnNavAdmin.addEventListener('click', () => {
    if (state.isAdmin) {
      showToast('이미 관리자 모드가 활성화되어 있습니다. 전체 학급 현황에서 학급을 관리할 수 있습니다.');
      switchPage('page-school');
    } else {
      adminModal.classList.add('active');
      inputAdminKey.value = '';
      inputAdminKey.focus();
    }
  });

  btnAdminCancel.addEventListener('click', () => {
    adminModal.classList.remove('active');
  });

  formAdminLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = inputAdminKey.value.trim();
    if (!key) return;

    try {
      const res = await api('/api/admin/verify', {
        method: 'POST',
        body: { key }
      });

      state.isAdmin = true;
      state.adminKey = key;
      sessionStorage.setItem('is_admin_7942', 'true');
      sessionStorage.setItem('admin_key_7942', key);

      adminModal.classList.remove('active');
      showToast(`🔐 ${res.message}`);
      switchPage('page-school');
    } catch (err) {
      showToast(`❌ ${err.message}`);
    }
  });

  btnAdminLogout.addEventListener('click', () => {
    state.isAdmin = false;
    state.adminKey = '';
    sessionStorage.removeItem('is_admin_7942');
    sessionStorage.removeItem('admin_key_7942');
    showToast('관리자 모드가 종료되었습니다.');
    loadSchoolData();
  });
}

// PAGE 3: Load and render School-Wide Data (READ-ONLY)
async function loadSchoolData() {
  try {
    const data = await api('/api/public/classes');
    renderSchoolDashboard(data);
  } catch (err) {
    showToast(`학교 현황 불러오기 실패: ${err.message}`);
  }
}

function renderSchoolDashboard(data) {
  const { classes, schoolSummary } = data;

  // School Hero Stats
  document.getElementById('school-stat-classes').textContent = `${schoolSummary.totalClasses}개 반`;
  document.getElementById('school-stat-time').textContent = `${schoolSummary.schoolHours}시간 ${schoolSummary.schoolRemMinutes}분`;
  document.getElementById('school-stat-pages').textContent = `${schoolSummary.schoolTotalPages.toLocaleString()}쪽`;

  // Admin Active Bar visibility
  const adminBar = document.getElementById('admin-active-bar');
  if (state.isAdmin) {
    adminBar.style.display = 'flex';
  } else {
    adminBar.style.display = 'none';
  }

  const container = document.getElementById('school-grades-container');
  container.innerHTML = '';

  // Group by grade (1 to 6)
  for (let g = 1; g <= 6; g++) {
    const gradeClasses = classes.filter(c => c.grade === g);
    if (gradeClasses.length === 0) continue;

    const section = document.createElement('div');
    section.className = 'grade-section';

    section.innerHTML = `
      <div class="grade-section-header">
        <span class="grade-badge-round">${g}</span>
        <span>${g}학년</span>
        <span style="font-size: 0.9rem; color: #718096; font-weight: 600; margin-left: auto;">
          ${gradeClasses.length}개 학급 참여 중
        </span>
      </div>
      <div class="classes-cards-grid" id="grade-grid-${g}"></div>
    `;

    container.appendChild(section);

    const grid = section.querySelector(`#grade-grid-${g}`);

    gradeClasses.forEach(c => {
      const card = document.createElement('div');
      card.className = 'school-class-card';

      // Trophy logic
      let trophyHtml = '';
      if (c.isDoubleCompleted) {
        trophyHtml = '<span class="badge-double-celebration" style="font-size: 0.8rem; padding: 2px 8px;">🏆 더블 미션 성공!</span>';
      } else if (c.isTimeCompleted || c.isPagesCompleted) {
        trophyHtml = '<span style="font-size: 0.85rem; font-weight: 800; color: #D69E2E; background: #FEFCBF; padding: 2px 7px; border-radius: 999px;">🏆 미션 성공!</span>';
      }

      // Time mission line
      let timeHtml = '';
      if (c.selectedMissions.includes('time')) {
        const hrs = Math.floor(c.totalMinutes / 60);
        const remMins = c.totalMinutes % 60;
        timeHtml = `
          <div class="mini-mission-row">
            <div class="mini-mission-info">
              <span>📚 79시간 미션 (${hrs}시간 ${remMins}분)</span>
              <span style="color: #2F855A;">${c.timePercentage}% ${c.isTimeCompleted ? '🎉' : ''}</span>
            </div>
            <div class="mini-progress-bar">
              <div class="mini-progress-fill" style="width: ${c.timePercentage}%;"></div>
            </div>
          </div>
        `;
      }

      // Pages mission line
      let pagesHtml = '';
      if (c.selectedMissions.includes('pages')) {
        pagesHtml = `
          <div class="mini-mission-row">
            <div class="mini-mission-info">
              <span>🏃 7,942쪽 미션 (${c.totalPages.toLocaleString()}쪽)</span>
              <span style="color: #6B46C1;">${c.pagesPercentage}% ${c.isPagesCompleted ? '🎉' : ''}</span>
            </div>
            <div class="mini-progress-bar">
              <div class="mini-progress-fill fill-pages" style="width: ${c.pagesPercentage}%;"></div>
            </div>
          </div>
        `;
      }

      // Admin Delete Button (shown ONLY when Admin mode is active)
      let adminDeleteHtml = '';
      if (state.isAdmin) {
        adminDeleteHtml = `
          <button type="button" class="btn-admin-delete-class" data-id="${c.id}" data-name="${c.grade}학년 ${c.classNumber}반">
            🗑️ 학급 삭제 (관리자)
          </button>
        `;
      }

      card.innerHTML = `
        <div class="school-class-header">
          <div class="school-class-name">${c.grade}학년 ${c.classNumber}반</div>
          <div>${trophyHtml}</div>
        </div>
        <div>
          ${timeHtml}
          ${pagesHtml}
          ${adminDeleteHtml}
        </div>
      `;

      // Handle admin delete button click
      if (state.isAdmin) {
        const delBtn = card.querySelector('.btn-admin-delete-class');
        if (delBtn) {
          delBtn.addEventListener('click', () => {
            const className = delBtn.dataset.name;
            const classId = delBtn.dataset.id;
            showModal({
              icon: '🚨',
              title: `${className} 삭제`,
              desc: `<strong>${className}</strong>을(를) 정말 삭제하시겠습니까?<br><span style="color: #E53E3E; font-size: 0.88rem;">학급의 모든 독서 기록과 데이터가 완전히 삭제되며 되돌릴 수 없습니다.</span>`,
              onConfirm: async () => {
                try {
                  const res = await api(`/api/admin/classes/${classId}`, {
                    method: 'DELETE',
                    headers: {
                      'x-admin-key': state.adminKey
                    }
                  });
                  showToast(`🗑️ ${res.message}`);
                  loadSchoolData();
                } catch (err) {
                  showToast(`❌ 삭제 실패: ${err.message}`);
                }
              }
            });
          });
        }
      }

      grid.appendChild(card);
    });
  }

  if (classes.length === 0) {
    container.innerHTML = '<div class="no-records-msg">아직 참여 중인 학급이 없습니다. 첫 번째 학급으로 도전해 보세요! 🚀</div>';
  }
}
