// home.js - 홈 화면 요약 카드
//
// 기능을 고르는 화면이기만 하면 "오늘 뭘 하면 되는지" 한눈에 보기 어렵다는 피드백으로 추가함.
// 새 데이터를 만들지 않고 다른 탭이 이미 저장한 데이터를 모아서 보여주기만 한다
// (records.js와 같은 원칙). 타일 5개: 오늘의 과제 / 이번 주 진행 상황 / 최근 수행한 활동 /
// 지난번 나의 배움 / 디딤이의 오늘의 한마디.

(function () {
  const HIERARCHY_KEY = 'hierarchy-items';
  const EXPOSURE_RECORDS_KEY = 'exposure-records';
  const LISTENING_RECORDS_KEY = 'listening-records';
  const BREATHING_RECORDS_KEY = 'breathing-records';
  const WEEKLY_TARGETS_KEY = 'weekly-targets';
  const GREETING_INDEX_KEY = 'mascotGreetingIndex'; // mascot.js와 같은 저장 키

  const summaryEl = document.getElementById('home-summary');
  const homeNavBtn = document.querySelector('.nav-btn[data-tab="home"]');
  // 홈으로 돌아오는 경로가 하단 탭 버튼 하나만 있는 게 아니라 각 화면의 뒤로가기 버튼도 있어서,
  // 어느 경로로 돌아오든 최신 데이터로 다시 그리도록 "home"으로 가는 모든 버튼에 건다
  const backToHomeBtns = document.querySelectorAll('[data-back-to="home"]');

  if (!summaryEl) return;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function tile(title, bodyLines) {
    const card = el('div', 'home-summary-tile');
    card.appendChild(el('p', 'home-summary-title', title));
    (Array.isArray(bodyLines) ? bodyLines : [bodyLines]).forEach((line) => {
      card.appendChild(el('p', 'home-summary-body', line));
    });
    return card;
  }

  function withinLastNDays(dateStr, n) {
    const date = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((today - date) / (24 * 60 * 60 * 1000));
    return diffDays >= 0 && diffDays < n;
  }

  // ----- 오늘의 과제 -----
  // "완료 여부"와 "다음에 할 일"까지 한 타일에 묶어 보여준다 - 이번 주로 고른 과제(isThisWeek)
  // 안에서 오늘 마친 것/다음으로 할 것을 가리키는 것이라, 치료자가 지정하는 별도 과제 체계는
  // 아니다(홈 화면의 "이번 주 과제"를 그대로 보강하기로 함).
  function buildTodaysTask() {
    const items = PEStorage.load(HIERARCHY_KEY, []).filter((i) => i.isThisWeek);
    const today = new Date().toISOString().slice(0, 10);
    const doneToday = new Set(
      PEStorage.load(EXPOSURE_RECORDS_KEY, [])
        .filter((r) => r.date === today)
        .map((r) => r.itemId)
    );
    const undone = items.filter((i) => !doneToday.has(i.id));
    const doneCount = items.length - undone.length;

    if (items.length === 0) return tile('오늘의 과제', '아직 이번 주 과제가 없어요. 위계표에서 골라보세요.');

    const statusLine = `완료 여부: 오늘 ${doneCount}/${items.length}개 완료`;

    if (undone.length === 0) {
      return tile('오늘의 과제', ['이번 주로 고른 과제를 오늘은 다 마쳤어요. 잘하셨어요.', statusLine]);
    }

    // 화면별 마스코트 상태 요청: 오늘의 미션이 남아있을 때 눈웃음+좌우 흔들기로 하루 한 번 알림
    if (window.Mascot) Mascot.say('home.missionPending');

    const next = undone[0];
    const lines = [
      `"${next.description}" (SUDS ${next.currentSUDS}) 위계표에서 바로 시작할 수 있어요.`,
      statusLine,
    ];
    if (undone[1]) {
      lines.push(`다음에 할 일: "${undone[1].description}"`);
    }
    return tile('오늘의 과제', lines);
  }

  // ----- 이번 주 진행 상황 -----
  function buildWeekProgress() {
    const targets = PEStorage.load(WEEKLY_TARGETS_KEY, {});
    const counts = {
      exposure: PEStorage.load(EXPOSURE_RECORDS_KEY, []).filter((r) => withinLastNDays(r.date, 7)).length,
      listening: PEStorage.load(LISTENING_RECORDS_KEY, []).filter((r) => withinLastNDays(r.date, 7)).length,
      breathing: PEStorage.load(BREATHING_RECORDS_KEY, []).filter((r) => withinLastNDays(r.date, 7)).length,
    };
    const format = (count, target, label) => (target ? `${label} ${count}/${target}` : `${label} ${count}회`);
    const body = [
      format(counts.exposure, targets.exposure, '실제노출'),
      format(counts.listening, targets.listening, '상상노출'),
      format(counts.breathing, targets.breathing, '호흡'),
    ].join(' · ');
    return tile('이번 주 진행 상황 (최근 7일)', body);
  }

  // ----- 최근 수행한 활동 -----
  function buildRecentActivity() {
    const candidates = [
      ...PEStorage.load(EXPOSURE_RECORDS_KEY, []).map((r) => ({
        createdAt: r.createdAt,
        text: `실제노출 · ${r.date} · ${r.itemDescription}`,
      })),
      ...PEStorage.load(LISTENING_RECORDS_KEY, []).map((r) => ({
        createdAt: r.createdAt,
        text: `상상노출 · ${r.date} · ${r.recordingName}`,
      })),
      ...PEStorage.load(BREATHING_RECORDS_KEY, []).map((r) => ({
        createdAt: r.createdAt,
        text: `호흡 연습 · ${r.date}`,
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (candidates.length === 0) return tile('최근 수행한 활동', '아직 기록이 없어요.');
    return tile('최근 수행한 활동', candidates[0].text);
  }

  // ----- 지난번에 기록한 나의 배움 -----
  function buildLastLearning() {
    const exposureCandidates = PEStorage.load(EXPOSURE_RECORDS_KEY, [])
      .filter((r) => r.takeaway || r.difference)
      .map((r) => ({ createdAt: r.createdAt, text: r.takeaway || r.difference }));
    const listeningCandidates = PEStorage.load(LISTENING_RECORDS_KEY, [])
      .filter((r) => r.takeaway || r.difference)
      .map((r) => ({ createdAt: r.createdAt, text: r.takeaway || r.difference }));

    const all = [...exposureCandidates, ...listeningCandidates].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );

    if (all.length === 0) return tile('지난번에 기록한 나의 배움', '아직 적어둔 성찰이 없어요.');
    return tile('지난번에 기록한 나의 배움', all[0].text);
  }

  // ----- 디딤이의 오늘의 한마디 -----
  function buildMascotLine() {
    const greetings = window.MASCOT_GREETINGS || [];
    if (greetings.length === 0) return null;
    const index = PEStorage.load(GREETING_INDEX_KEY, 0) % greetings.length;
    const card = tile('디딤이의 오늘의 한마디', greetings[index]);
    card.classList.add('home-summary-tile-mascot');
    return card;
  }

  function renderHomeSummary() {
    // 화면별 마스코트 상태 요청: 홈 화면에 머무는 동안은 기본 표정 + 숨쉬기를 계속 보여준다
    if (window.Mascot) Mascot.showAmbient('default');

    summaryEl.innerHTML = '';
    [buildTodaysTask(), buildWeekProgress(), buildRecentActivity(), buildLastLearning(), buildMascotLine()]
      .filter(Boolean)
      .forEach((card) => summaryEl.appendChild(card));
  }

  renderHomeSummary();
  if (homeNavBtn) homeNavBtn.addEventListener('click', renderHomeSummary);
  backToHomeBtns.forEach((btn) => btn.addEventListener('click', renderHomeSummary));
})();
