// breathing.js - 노출 전후 안정화를 위한 호흡 안내 기능
//
// 2026-11-26: 4-7-8 호흡법으로 바꿈(사용자 요청) - 들숨 4초(원 확대) → 멈춤 7초(확대된 채
// 유지) → 날숨 8초(원 축소). 이 순서를 3분 동안 반복한다.
// 단계 중 보여주는 문구("천천히 들이쉬세요", "차~분~해~요" 등)는 전부 없애고 숫자 카운트다운
// (1부터 그 단계 길이까지)만 보여주도록 통일함(사용자 요청: "멘트 없애고 숫자로 바꿔줘") -
// 어떤 단계인지는 원이 커지고/작아지는 애니메이션으로만 구분한다.
//
// 음성 안내(IndexedDB, PEAudioStorage, category: 'breathing-guide')는 치료자 목소리로 녹음한
// 파일을 한 개만 보관하며(업로드 시 덮어씀), 연습 중 loop 재생할 수 있다.
// 연습 기록 데이터 구조 (localStorage 키: 'breathing-records', 배열):
// { id, date, durationSec, usedAudio, completed, createdAt }

(function () {
  const RECORDS_KEY = 'breathing-records';
  const AUDIO_ID = 'breathing-guide-audio';
  const AUDIO_CATEGORY = 'breathing-guide';

  const TOTAL_DURATION_MS = 3 * 60 * 1000; // 3분
  const PHASES = [
    { name: 'inhale', durationMs: 4000 },
    { name: 'hold', durationMs: 7000 },
    { name: 'exhale', durationMs: 8000 },
  ];

  let running = false;
  let phaseIndex = 0;
  let sessionStartTime = null;
  let phaseTimeoutId = null;
  let timerIntervalId = null;
  let phaseSubTimeouts = [];
  let phaseSubIntervalId = null;

  let breathingAudioRecord = null; // { id, name, blob, category, createdAt } 또는 null
  let currentAudioObjectUrl = null;

  // ----- DOM 요소 -----
  const circleEl = document.getElementById('breathing-circle');
  const phaseTextEl = document.getElementById('breathing-phase-text');
  const timerEl = document.getElementById('breathing-timer');

  const idleControls = document.getElementById('breathing-idle-controls');
  const uploadInput = document.getElementById('breathing-upload-input');
  const uploadLabelEl = document.getElementById('breathing-upload-label');
  const audioInfoEl = document.getElementById('breathing-audio-info');
  const audioNameEl = document.getElementById('breathing-audio-name');
  const useAudioCheckbox = document.getElementById('breathing-use-audio-checkbox');
  const removeAudioBtn = document.getElementById('breathing-remove-audio-btn');
  const startBtn = document.getElementById('breathing-start-btn');

  const runningControls = document.getElementById('breathing-running-controls');
  const stopBtn = document.getElementById('breathing-stop-btn');

  const endView = document.getElementById('breathing-end-view');
  const summaryEl = document.getElementById('breathing-summary');
  const doneBtn = document.getElementById('breathing-done-btn');

  const audioEl = document.getElementById('breathing-audio');
  const historyListEl = document.getElementById('breathing-history-list');

  if (!circleEl || !idleControls) return;

  function generateId() {
    return 'b_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ----- 화면 전환 -----
  function showIdleView() {
    idleControls.hidden = false;
    runningControls.hidden = true;
    endView.hidden = true;

    circleEl.style.transition = 'transform 0.3s ease-in-out';
    circleEl.style.transform = 'scale(1)';
    phaseTextEl.textContent = '시작을 눌러보세요';
    timerEl.textContent = '03:00';

    // 화면별 마스코트 상태 요청: 휴식(호흡) 대기 화면에 머무는 동안은 편안한 표정을 계속 보여줌
    if (window.Mascot) {
      Mascot.showAmbient('default');
      Mascot.say('breathing.before');
    }
  }

  function showRunningView() {
    idleControls.hidden = true;
    runningControls.hidden = false;
    endView.hidden = true;
  }

  function showEndView(completed, elapsedMs) {
    idleControls.hidden = true;
    runningControls.hidden = true;
    endView.hidden = false;

    const minutes = Math.floor(elapsedMs / 60000);
    const seconds = Math.round((elapsedMs % 60000) / 1000);
    summaryEl.textContent = completed
      ? `3분 호흡 연습을 완료했어요. (${minutes}분 ${seconds}초)`
      : `${minutes}분 ${seconds}초 동안 연습했어요.`;
  }

  // ----- 음성 안내 업로드/삭제 -----
  async function refreshAudioInfo() {
    breathingAudioRecord = await PEAudioStorage.load(AUDIO_ID);
    if (breathingAudioRecord) {
      audioInfoEl.hidden = false;
      audioNameEl.textContent = breathingAudioRecord.name;
      uploadLabelEl.textContent = '다른 음성으로 교체';
    } else {
      audioInfoEl.hidden = true;
      uploadLabelEl.textContent = '치료자 음성 안내 업로드 (선택)';
    }
  }

  async function handleUpload() {
    const file = uploadInput.files[0];
    if (!file) return;

    await PEAudioStorage.save({
      id: AUDIO_ID,
      name: file.name,
      blob: file,
      category: AUDIO_CATEGORY,
      createdAt: new Date().toISOString(),
    });
    uploadInput.value = '';
    useAudioCheckbox.checked = true;
    await refreshAudioInfo();
  }

  async function removeAudio() {
    if (!breathingAudioRecord) return;
    const confirmed = window.confirm('등록된 호흡 안내 음성을 삭제할까요?');
    if (!confirmed) return;

    await PEAudioStorage.remove(AUDIO_ID);
    await refreshAudioInfo();
  }

  // ----- 호흡 주기 애니메이션 -----
  function clearPhaseSubTimers() {
    phaseSubTimeouts.forEach((id) => clearTimeout(id));
    phaseSubTimeouts = [];
    if (phaseSubIntervalId) {
      clearInterval(phaseSubIntervalId);
      phaseSubIntervalId = null;
    }
  }

  function applyPhase(phaseName) {
    clearPhaseSubTimers();

    const phase = PHASES.find((p) => p.name === phaseName);
    const durationSec = phase.durationMs / 1000;

    if (phaseName === 'inhale') {
      // 들숨: 원이 커짐
      circleEl.style.transition = `transform ${durationSec}s ease-in-out`;
      circleEl.style.transform = 'scale(1.35)';
    } else if (phaseName === 'hold') {
      // 멈춤: 들숨 직후라 커진 상태를 그대로 유지
      circleEl.style.transition = 'transform 0.3s ease-in-out';
      circleEl.style.transform = 'scale(1.35)';
    } else if (phaseName === 'exhale') {
      // 날숨: 원이 다시 작아짐
      circleEl.style.transition = `transform ${durationSec}s ease-in-out`;
      circleEl.style.transform = 'scale(1)';
    }
    runPhaseCountdown(durationSec);
  }

  // 단계(들숨/멈춤/날숨) 동안 1부터 그 단계 길이(초)까지 1초마다 숫자만 보여준다
  function runPhaseCountdown(durationSec) {
    let count = 1;
    phaseTextEl.textContent = String(count);
    phaseSubIntervalId = setInterval(() => {
      count++;
      if (count > durationSec) {
        clearInterval(phaseSubIntervalId);
        phaseSubIntervalId = null;
        return;
      }
      phaseTextEl.textContent = String(count);
    }, 1000);
  }

  function runNextPhase() {
    if (!running) return;

    const elapsedMs = Date.now() - sessionStartTime;
    if (elapsedMs >= TOTAL_DURATION_MS) {
      finishSession();
      return;
    }

    const phase = PHASES[phaseIndex % PHASES.length];
    phaseIndex++;
    applyPhase(phase.name);
    phaseTimeoutId = setTimeout(runNextPhase, phase.durationMs);
  }

  // ----- 타이머 표시 -----
  function formatMMSS(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function updateTimerDisplay() {
    const elapsedMs = Date.now() - sessionStartTime;
    const remainingMs = Math.max(0, TOTAL_DURATION_MS - elapsedMs);
    timerEl.textContent = formatMMSS(remainingMs);
  }

  function startTimerDisplay() {
    updateTimerDisplay();
    timerIntervalId = setInterval(updateTimerDisplay, 1000);
  }

  function stopTimerDisplay() {
    if (timerIntervalId) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
  }

  // ----- 세션 시작/종료 -----
  function startSession() {
    running = true;
    phaseIndex = 0;
    sessionStartTime = Date.now();

    if (breathingAudioRecord && useAudioCheckbox.checked) {
      if (currentAudioObjectUrl) URL.revokeObjectURL(currentAudioObjectUrl);
      currentAudioObjectUrl = URL.createObjectURL(breathingAudioRecord.blob);
      audioEl.src = currentAudioObjectUrl;
      audioEl.loop = true;
      audioEl.play().catch(() => {
        // 자동 재생이 막힌 경우에도 시각적 애니메이션은 정상 진행됨
      });
    } else {
      audioEl.removeAttribute('src');
    }

    showRunningView();
    startTimerDisplay();
    runNextPhase();

    if (window.Mascot) Mascot.lock();
  }

  function stopSession() {
    if (!running) return;
    finishSession();
  }

  function finishSession() {
    running = false;

    if (phaseTimeoutId) {
      clearTimeout(phaseTimeoutId);
      phaseTimeoutId = null;
    }
    clearPhaseSubTimers();
    stopTimerDisplay();

    if (!audioEl.paused) audioEl.pause();

    const elapsedMs = Date.now() - sessionStartTime;
    const completed = elapsedMs >= TOTAL_DURATION_MS;
    saveRecord(elapsedMs, completed);

    circleEl.style.transition = 'transform 0.6s ease-in-out';
    circleEl.style.transform = 'scale(1)';
    phaseTextEl.textContent = '잘 하셨어요';

    showEndView(completed, elapsedMs);

    if (window.Mascot) {
      Mascot.unlock();
      Mascot.say('breathing.done');
    }
  }

  function saveRecord(elapsedMs, completed) {
    const record = {
      id: generateId(),
      date: new Date().toISOString().slice(0, 10),
      durationSec: Math.round(elapsedMs / 1000),
      usedAudio: !!(breathingAudioRecord && useAudioCheckbox.checked),
      completed,
      createdAt: new Date().toISOString(),
    };

    const records = PEStorage.load(RECORDS_KEY, []);
    records.push(record);
    PEStorage.save(RECORDS_KEY, records);

    if (window.MicroReaction) {
      MicroReaction.ripple();
      if (completed) MicroReaction.firefly();
    }

    renderHistory();
  }

  function renderHistory() {
    const records = PEStorage.load(RECORDS_KEY, []).slice().reverse();
    historyListEl.innerHTML = '';

    if (records.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'placeholder-text';
      empty.textContent = '아직 연습 기록이 없습니다.';
      historyListEl.appendChild(empty);
      return;
    }

    records.forEach((rec) => {
      const row = document.createElement('div');
      row.className = 'suds-log-row';
      const minutes = Math.floor(rec.durationSec / 60);
      const seconds = rec.durationSec % 60;
      const audioNote = rec.usedAudio ? ' (음성 안내 포함)' : '';
      const statusNote = rec.completed ? '완료' : '중간에 종료';
      row.textContent = `${rec.date} - ${minutes}분 ${seconds}초, ${statusNote}${audioNote}`;
      historyListEl.appendChild(row);
    });
  }

  // 다른 탭에서 넘어올 때 호흡 진행 중인지 확인해 마스코트 ambient 여부를 판단할 수 있도록
  // 노출시킨다 (index.html의 activateTab이 사용)
  window.PEBreathing = { isSessionActive: () => running };

  function init() {
    refreshAudioInfo();
    renderHistory();
    showIdleView();

    uploadInput.addEventListener('change', handleUpload);
    removeAudioBtn.addEventListener('click', removeAudio);
    startBtn.addEventListener('click', startSession);
    stopBtn.addEventListener('click', stopSession);
    doneBtn.addEventListener('click', showIdleView);
  }

  init();
})();
