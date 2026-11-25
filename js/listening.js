// listening.js - 상상노출(imaginal exposure) 과제 진행 및 기록 기능
//
// 2026-11-26: "녹음듣기"(수동적으로 녹음을 재생만 하던 기능)에서 "상상노출"로 다시 설계함.
// 치료자와 함께 만든 이야기(녹음)를 반복해서 들으며 그 기억에 머무는 실제 PE 상상노출
// 과제이고, exposure.js(실제노출)와 완전히 동일한 흐름(예측 → SUDS 기록 → 회피/안전행동
// 체크 → 성찰 질문 3개)을 따른다. 유일한 차이는 치료자가 녹음해준 음성을 들을 수 있다는
// 것뿐이다. 세션 중 재생 버튼/일시정지 등은 그대로 두되, `audio.loop = true`로 녹음이
// 끝나도 자동으로 반복돼서 정해진 시간만큼 머무를 수 있게 했다(한 번 다 들었다고 자동
// 종료되지 않음 - 종료는 항상 "상상노출 종료"/"그만하기" 버튼으로 사용자가 선택).
//
// 내부 저장 식별자(localStorage 키 'listening-records'/'listening-session', IndexedDB
// category 'imaginal-exposure')는 기능 이름이 바뀌어도 그대로 둔다 - 이미 저장된 데이터가
// 고아가 되는 걸 막기 위함(앱 이름 바꿀 때와 같은 원칙, CLAUDE.md 참고).
//
// 세션 데이터 구조 (localStorage 키: 'listening-session', 진행 중일 때만 존재):
// { recordingId, recordingName, startSUDS, prediction, startTime, sudsLog: [{atMs, suds}],
//   extendNoticeShown, hotspots: [{atMs, note}] }
//
// 완료 기록 데이터 구조 (localStorage 키: 'listening-records', 배열):
// { id, date, recordingId, recordingName, startSUDS, sudsLog, totalDurationMs, endedEarly,
//   checklist, prediction, predictionCameTrue, actualOutcome, difference, takeaway,
//   hotspots, createdAt }
// checklist 모양은 exposure.js의 실제노출 기록과 동일(고정 5항목 + custom) - 같은 환자별
// 커스텀 안전행동 목록(설정 > 회피 체크리스트 관리)을 공유해서 쓴다.
//
// 종료 기준(목표 감소율/연장 권유 시점)도 exposure.js와 같은 설정(`exposure-settings` 키)을
// 그대로 읽어 쓴다 - "실제노출이랑 동일하게"라는 요청에 따라 기준을 분리하지 않았다.

(function () {
  const RECORDS_KEY = 'listening-records';
  const SESSION_KEY = 'listening-session';
  const CUSTOM_CHECKLIST_KEY = 'custom-safety-behaviors'; // 설정(settings.js)과 동일한 저장 키
  const EXPOSURE_SETTINGS_KEY = 'exposure-settings'; // exposure.js와 동일한 저장 키 (동일 기준 공유)

  const PROMPT_INTERVAL_MS = 5 * 60 * 1000; // 5분마다 SUDS 체크 (exposure.js와 동일)
  const DEFAULT_EXTEND_MINUTES = 45;
  const DEFAULT_REDUCTION_PCT = 50;

  let customChecklistItems = []; // [{ id, label, category, checkbox }] - 종료 화면을 그릴 때마다 새로 만듦

  function getExposureSettings() {
    const saved = PEStorage.load(EXPOSURE_SETTINGS_KEY, {});
    return {
      extendMs: (saved.extendMinutes || DEFAULT_EXTEND_MINUTES) * 60 * 1000,
      reductionRatio: (saved.reductionPct || DEFAULT_REDUCTION_PCT) / 100,
    };
  }

  let recordings = []; // IndexedDB에서 불러온 녹음 메타 목록 (blob 포함)
  let selectedRecording = null; // 현재 선택한 녹음
  let currentObjectUrl = null; // 재생 중인 Blob URL (교체/정리 시 해제)
  let session = null; // 진행 중인 세션 (없으면 null)
  let tickInterval = null;
  let endedEarly = false; // "그만하기"로 끝났는지 - 종료 화면 마스코트 대사 분기용

  // ----- DOM 요소 -----
  const uploadInput = document.getElementById('listening-upload-input');
  const recordingListEl = document.getElementById('listening-recording-list');

  const beforePanel = document.getElementById('listening-before-panel');
  const beforeNameEl = document.getElementById('listening-before-name');
  const beforeSudsInput = document.getElementById('listening-before-suds');
  const beforeSudsValueEl = document.getElementById('listening-before-suds-value');
  const predictionInput = document.getElementById('listening-prediction');
  const startBtn = document.getElementById('listening-start-btn');
  const beforeCancelBtn = document.getElementById('listening-before-cancel-btn');

  const playerPanel = document.getElementById('listening-player-panel');
  const playerNameEl = document.getElementById('listening-player-name');
  const audioEl = document.getElementById('listening-audio');
  const sudsLogListEl = document.getElementById('listening-suds-log-list');
  const sudsPromptBtn = document.getElementById('listening-suds-prompt-btn');
  const interruptBtn = document.getElementById('listening-interrupt-btn');
  const dissociationBtn = document.getElementById('listening-dissociation-btn');
  const hotspotBtn = document.getElementById('listening-hotspot-btn');
  const hotspotListEl = document.getElementById('listening-hotspot-list');

  const afterPanel = document.getElementById('listening-after-panel');
  const summaryEl = document.getElementById('listening-summary');
  const afterHotspotSummaryEl = document.getElementById('listening-after-hotspot-summary');
  const predictionRecapEl = document.getElementById('listening-prediction-recap');
  const predictionCheckWrap = document.getElementById('listening-prediction-check-wrap');
  const predictionCameTrueSelect = document.getElementById('listening-prediction-came-true');
  const actualOutcomeInput = document.getElementById('listening-actual-outcome');
  const differenceInput = document.getElementById('listening-difference');
  const takeawayInput = document.getElementById('listening-takeaway');
  const saveBtn = document.getElementById('listening-save-btn');
  const checklistBoxes = {
    phone: document.getElementById('listening-checklist-phone'),
    companion: document.getElementById('listening-checklist-companion'),
    rushing: document.getElementById('listening-checklist-rushing'),
    safetyObject: document.getElementById('listening-checklist-safety-object'),
    overactivity: document.getElementById('listening-checklist-overactivity'),
  };
  const customChecklistEl = document.getElementById('listening-custom-checklist');

  const sudsCheckModal = document.getElementById('listening-suds-check-modal');
  const sudsCheckInput = document.getElementById('listening-suds-check-input');
  const sudsCheckValueEl = document.getElementById('listening-suds-check-value');
  const sudsCheckConfirmBtn = document.getElementById('listening-suds-check-confirm-btn');

  const targetMetModal = document.getElementById('listening-target-met-modal');
  const targetContinueBtn = document.getElementById('listening-target-continue-btn');
  const targetEndBtn = document.getElementById('listening-target-end-btn');

  const extendModal = document.getElementById('listening-extend-modal');
  const extendContinueBtn = document.getElementById('listening-extend-continue-btn');
  const extendEndBtn = document.getElementById('listening-extend-end-btn');

  const interruptModal = document.getElementById('listening-interrupt-modal');
  const interruptContinueBtn = document.getElementById('listening-interrupt-continue-btn');
  const interruptStopBtn = document.getElementById('listening-interrupt-stop-btn');

  const finalSudsModal = document.getElementById('listening-final-suds-modal');
  const finalSudsInput = document.getElementById('listening-final-suds-input');
  const finalSudsValueEl = document.getElementById('listening-final-suds-value');
  const finalSudsConfirmBtn = document.getElementById('listening-final-suds-confirm-btn');

  const ALL_MODALS = [sudsCheckModal, targetMetModal, extendModal, interruptModal, finalSudsModal];

  const historyListEl = document.getElementById('listening-history-list');

  if (!recordingListEl || !uploadInput) return;

  function generateId() {
    return 'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function formatTimestamp(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function formatElapsed(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  }

  // ----- 모달 제어 (exposure.js와 동일 패턴) -----
  function openModal(modal) {
    modal.hidden = false;
  }

  function closeModal(modal) {
    modal.hidden = true;
  }

  function isAnyModalOpen() {
    const groundingOpen = window.PESafety && window.PESafety.isGroundingAlertOpen();
    return ALL_MODALS.some((m) => !m.hidden) || !!groundingOpen;
  }

  function lastLogEntry() {
    return session.sudsLog[session.sudsLog.length - 1];
  }

  function hasMetTarget() {
    const { reductionRatio } = getExposureSettings();
    return lastLogEntry().suds <= session.startSUDS * (1 - reductionRatio);
  }

  // ----- 핫스팟 (재생 중 힘든 지점 표시) -----
  function renderHotspotList() {
    hotspotListEl.innerHTML = '';
    session.hotspots.forEach((hotspot, index) => {
      const row = document.createElement('div');
      row.className = 'hotspot-row';

      const timeBtn = document.createElement('button');
      timeBtn.type = 'button';
      timeBtn.className = 'hotspot-time-btn';
      timeBtn.textContent = formatTimestamp(hotspot.atMs);
      timeBtn.title = '이 지점으로 이동';
      timeBtn.addEventListener('click', () => {
        audioEl.currentTime = hotspot.atMs / 1000;
      });
      row.appendChild(timeBtn);

      const noteInput = document.createElement('input');
      noteInput.type = 'text';
      noteInput.className = 'hotspot-note-input';
      noteInput.placeholder = '어떤 점이 힘들었는지 적어보세요 (선택)';
      noteInput.value = hotspot.note;
      noteInput.addEventListener('input', () => {
        hotspot.note = noteInput.value;
      });
      row.appendChild(noteInput);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'hotspot-remove-btn';
      removeBtn.setAttribute('aria-label', '핫스팟 삭제');
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        session.hotspots.splice(index, 1);
        renderHotspotList();
      });
      row.appendChild(removeBtn);

      hotspotListEl.appendChild(row);
    });
  }

  function markHotspot() {
    if (!session) return;
    session.hotspots.push({ atMs: Math.round((Date.now() - session.startTime)), note: '' });
    renderHotspotList();
  }

  // ----- 화면 전환 -----
  function showListView() {
    beforePanel.hidden = true;
    playerPanel.hidden = true;
    afterPanel.hidden = true;
    recordingListEl.hidden = false;
    uploadInput.parentElement.hidden = false;
  }

  function showBeforePanel() {
    recordingListEl.hidden = true;
    uploadInput.parentElement.hidden = true;
    beforePanel.hidden = false;
    playerPanel.hidden = true;
    afterPanel.hidden = true;
  }

  function showPlayerPanel() {
    beforePanel.hidden = true;
    playerPanel.hidden = false;
    afterPanel.hidden = true;
  }

  function showAfterPanel() {
    playerPanel.hidden = true;
    afterPanel.hidden = false;
  }

  // ----- 녹음 목록 -----
  async function refreshRecordingList() {
    recordings = await PEAudioStorage.listAll('imaginal-exposure');
    recordings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    renderRecordingList();
  }

  function renderRecordingList() {
    recordingListEl.innerHTML = '';

    if (recordings.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'placeholder-text';
      empty.textContent = '아직 업로드된 녹음이 없습니다. 치료자에게 받은 녹음 파일을 업로드해주세요.';
      recordingListEl.appendChild(empty);
      return;
    }

    recordings.forEach((rec) => {
      const item = document.createElement('div');
      item.className = 'listening-recording-item';

      const info = document.createElement('div');
      info.className = 'listening-recording-info';

      const name = document.createElement('p');
      name.className = 'hierarchy-item-desc';
      name.textContent = rec.name;
      info.appendChild(name);

      const date = document.createElement('p');
      date.className = 'safety-note';
      date.textContent = `업로드: ${rec.createdAt.slice(0, 10)}`;
      info.appendChild(date);

      item.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'hierarchy-item-actions';

      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'btn btn-start';
      playBtn.textContent = '이 녹음으로 상상노출';
      playBtn.addEventListener('click', () => selectRecording(rec));
      actions.appendChild(playBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-outline btn-delete';
      deleteBtn.textContent = '삭제';
      deleteBtn.addEventListener('click', () => deleteRecording(rec.id));
      actions.appendChild(deleteBtn);

      item.appendChild(actions);
      recordingListEl.appendChild(item);
    });
  }

  async function handleUpload() {
    const file = uploadInput.files[0];
    if (!file) return;

    const record = {
      id: generateId(),
      name: file.name,
      blob: file,
      category: 'imaginal-exposure',
      createdAt: new Date().toISOString(),
    };
    await PEAudioStorage.save(record);
    uploadInput.value = '';
    await refreshRecordingList();
  }

  async function deleteRecording(id) {
    const rec = recordings.find((r) => r.id === id);
    if (!rec) return;
    const confirmed = window.confirm(`"${rec.name}" 녹음을 삭제할까요?`);
    if (!confirmed) return;

    await PEAudioStorage.remove(id);
    await refreshRecordingList();
  }

  // ----- 대기 화면 -----
  function selectRecording(rec) {
    selectedRecording = rec;
    beforeNameEl.textContent = rec.name;
    beforeSudsInput.value = 5;
    beforeSudsValueEl.textContent = '5';
    predictionInput.value = '';
    showBeforePanel();

    if (window.Mascot) Mascot.say('listening.before');
  }

  function startListening() {
    if (!selectedRecording) return;

    const startSUDS = Number(beforeSudsInput.value);
    const prediction = predictionInput.value.trim();
    endedEarly = false;

    session = {
      recordingId: selectedRecording.id,
      recordingName: selectedRecording.name,
      startSUDS,
      prediction,
      startTime: Date.now(),
      sudsLog: [{ atMs: 0, suds: startSUDS }],
      extendNoticeShown: false,
      hotspots: [],
    };
    saveSession();
    renderHotspotList();

    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
    }
    currentObjectUrl = URL.createObjectURL(selectedRecording.blob);
    audioEl.src = currentObjectUrl;
    playerNameEl.textContent = selectedRecording.name;

    showPlayerPanel();
    renderSudsLog();
    audioEl.play().catch(() => {
      // 자동 재생이 막힌 경우 사용자가 직접 재생 버튼을 눌러야 함
    });

    if (window.Mascot) Mascot.lock();
    startTicking();
  }

  // ----- 저장/불러오기 (화면이 꺼지거나 새로고침돼도 세션 유지) -----
  function saveSession() {
    PEStorage.save(SESSION_KEY, session);
  }

  function clearSession() {
    session = null;
    PEStorage.remove(SESSION_KEY);
  }

  function renderSudsLog() {
    sudsLogListEl.innerHTML = '';
    session.sudsLog.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'suds-log-row';
      row.textContent = `${formatElapsed(entry.atMs)} 경과 - SUDS ${entry.suds}`;
      sudsLogListEl.appendChild(row);
    });
  }

  function openSudsCheck() {
    sudsCheckInput.value = lastLogEntry().suds;
    sudsCheckValueEl.textContent = String(lastLogEntry().suds);
    openModal(sudsCheckModal);
  }

  // ----- 진행 중 타이머 (exposure.js와 동일하게 Date.now() 기반 경과시간 계산) -----
  function startTicking() {
    stopTicking();
    tick();
    tickInterval = setInterval(tick, 1000);
  }

  function stopTicking() {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  }

  function tick() {
    if (!session) return;

    const elapsedMs = Date.now() - session.startTime;

    if (isAnyModalOpen()) return;

    const { extendMs } = getExposureSettings();
    if (!session.extendNoticeShown && elapsedMs >= extendMs && !hasMetTarget()) {
      session.extendNoticeShown = true;
      saveSession();
      openModal(extendModal);
      return;
    }

    if (elapsedMs - lastLogEntry().atMs >= PROMPT_INTERVAL_MS) {
      openSudsCheck();
    }
  }

  function submitSudsCheck() {
    const value = Number(sudsCheckInput.value);
    const elapsedMs = Date.now() - session.startTime;
    session.sudsLog.push({ atMs: elapsedMs, suds: value });
    saveSession();
    renderSudsLog();
    closeModal(sudsCheckModal);

    if (hasMetTarget()) {
      openModal(targetMetModal);
    }
  }

  // ----- 종료 흐름 -----
  function beginEndFlow() {
    const value = lastLogEntry().suds;
    finalSudsInput.value = value;
    finalSudsValueEl.textContent = String(value);
    openModal(finalSudsModal);
  }

  function confirmFinalSuds() {
    const value = Number(finalSudsInput.value);
    const elapsedMs = Date.now() - session.startTime;
    session.sudsLog.push({ atMs: elapsedMs, suds: value });
    session.totalDurationMs = elapsedMs;
    saveSession();

    closeModal(finalSudsModal);
    stopTicking();
    audioEl.pause();
    if (window.Mascot) Mascot.unlock();
    showEndView();
  }

  const CUSTOM_CATEGORY_LABELS = {
    avoidance: '회피 행동 (환자별 추가)',
    safety: '안전 행동 (환자별 추가)',
  };

  function createChecklistRow(id, labelText) {
    const label = document.createElement('label');
    label.className = 'checklist-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'checklist-checkbox';
    label.appendChild(checkbox);

    const box = document.createElement('span');
    box.className = 'checklist-box';
    box.setAttribute('aria-hidden', 'true');
    box.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4L18 8" /></svg>';
    label.appendChild(box);

    const text = document.createElement('span');
    text.className = 'checklist-text';
    text.textContent = labelText;
    label.appendChild(text);

    return { label, checkbox };
  }

  function renderCustomChecklist() {
    customChecklistEl.innerHTML = '';
    const behaviors = PEStorage.load(CUSTOM_CHECKLIST_KEY, []);
    customChecklistItems = [];

    ['avoidance', 'safety'].forEach((category) => {
      const group = behaviors.filter((b) => (b.category || 'avoidance') === category);
      if (group.length === 0) return;

      const groupLabel = document.createElement('p');
      groupLabel.className = 'checklist-group-label';
      groupLabel.textContent = CUSTOM_CATEGORY_LABELS[category];
      customChecklistEl.appendChild(groupLabel);

      const list = document.createElement('div');
      list.className = 'checklist';
      group.forEach((behavior) => {
        const { label, checkbox } = createChecklistRow(behavior.id, behavior.label);
        list.appendChild(label);
        customChecklistItems.push({ id: behavior.id, label: behavior.label, category, checkbox });
      });
      customChecklistEl.appendChild(list);
    });
  }

  function showEndView() {
    playerPanel.hidden = true;
    afterPanel.hidden = false;

    const first = session.startSUDS;
    const last = lastLogEntry().suds;
    const reductionPct = first > 0 ? Math.round((1 - last / first) * 100) : 0;

    summaryEl.innerHTML = '';
    [
      `녹음: ${session.recordingName}`,
      `시작 SUDS: ${first} → 종료 SUDS: ${last} (${reductionPct}% 감소)`,
      `총 소요 시간: ${formatElapsed(session.totalDurationMs)}`,
    ].forEach((text) => {
      const p = document.createElement('p');
      p.className = 'exposure-summary-row';
      p.textContent = text;
      summaryEl.appendChild(p);
    });

    if (session.hotspots.length > 0) {
      afterHotspotSummaryEl.hidden = false;
      afterHotspotSummaryEl.textContent =
        `표시한 힘든 지점: ${session.hotspots.map((h) => formatTimestamp(h.atMs)).join(', ')}`;
    } else {
      afterHotspotSummaryEl.hidden = true;
      afterHotspotSummaryEl.textContent = '';
    }

    Object.values(checklistBoxes).forEach((box) => {
      if (box) box.checked = false;
    });
    renderCustomChecklist();
    actualOutcomeInput.value = '';
    differenceInput.value = '';
    takeawayInput.value = '';

    if (session.prediction) {
      predictionRecapEl.hidden = false;
      predictionRecapEl.textContent = `시작 전 예측: ${session.prediction}`;
      predictionCheckWrap.hidden = false;
      predictionCameTrueSelect.value = 'no';
    } else {
      predictionRecapEl.hidden = true;
      predictionRecapEl.textContent = '';
      predictionCheckWrap.hidden = true;
    }

    // PDF 스크립트엔 상상노출 종료/중단을 구분하는 전용 대사가 따로 없어서, 실제노출 대사를
    // 빌려오지 않고 원래 있던 "들은 후" 대사(listening.reflect)를 그대로 쓴다.
    if (window.Mascot) Mascot.say('listening.reflect');
  }

  function saveListeningRecord() {
    const record = {
      id: generateId(),
      date: new Date(session.startTime).toISOString().slice(0, 10),
      recordingId: session.recordingId,
      recordingName: session.recordingName,
      startSUDS: session.startSUDS,
      prediction: session.prediction || '',
      predictionCameTrue: session.prediction ? predictionCameTrueSelect.value : null,
      sudsLog: session.sudsLog,
      totalDurationMs: session.totalDurationMs,
      endedEarly,
      checklist: {
        phone: checklistBoxes.phone.checked,
        companion: checklistBoxes.companion.checked,
        rushing: checklistBoxes.rushing.checked,
        safetyObject: checklistBoxes.safetyObject.checked,
        overactivity: checklistBoxes.overactivity.checked,
        custom: customChecklistItems.map((item) => ({
          id: item.id,
          label: item.label,
          category: item.category,
          checked: item.checkbox.checked,
        })),
      },
      actualOutcome: actualOutcomeInput.value.trim(),
      difference: differenceInput.value.trim(),
      takeaway: takeawayInput.value.trim(),
      hotspots: session.hotspots,
      createdAt: new Date().toISOString(),
    };

    const records = PEStorage.load(RECORDS_KEY, []);
    records.push(record);
    PEStorage.save(RECORDS_KEY, records);

    if (window.MicroReaction) {
      MicroReaction.ripple();
      if (!endedEarly) MicroReaction.firefly();
    }

    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
    audioEl.removeAttribute('src');
    clearSession();
    selectedRecording = null;

    renderHistory();
    showListView();

    if (window.Mascot) Mascot.say('listening.saved');
  }

  function cancelBefore() {
    selectedRecording = null;
    showListView();
  }

  // ----- 듣기 기록(날짜별) -----
  function renderHistory() {
    const records = PEStorage.load(RECORDS_KEY, []).slice().reverse();
    historyListEl.innerHTML = '';

    if (records.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'placeholder-text';
      empty.textContent = '아직 상상노출 기록이 없습니다.';
      historyListEl.appendChild(empty);
      return;
    }

    records.forEach((rec) => {
      const hotspots = rec.hotspots || [];
      const last = rec.sudsLog ? rec.sudsLog[rec.sudsLog.length - 1] : null;
      const row = document.createElement('div');
      row.className = 'suds-log-row';
      row.textContent =
        `${rec.date} - ${rec.recordingName}: ` +
        (last ? `SUDS ${rec.startSUDS} → ${last.suds}` : '') +
        (rec.takeaway ? ` (메모: ${rec.takeaway})` : '') +
        (hotspots.length > 0
          ? ` / 핫스팟: ${hotspots.map((h) => formatTimestamp(h.atMs)).join(', ')}`
          : '');
      historyListEl.appendChild(row);
    });
  }

  function init() {
    const saved = PEStorage.load(SESSION_KEY, null);
    if (saved !== null) {
      session = saved;
      selectedRecording = { id: session.recordingId, name: session.recordingName };
      showPlayerPanel();
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
      // 새로고침 등으로 세션은 남아있는데 blob URL은 사라진 경우 - 녹음을 다시 불러와 복구
      PEAudioStorage.load(session.recordingId).then((rec) => {
        if (rec) {
          currentObjectUrl = URL.createObjectURL(rec.blob);
          audioEl.src = currentObjectUrl;
        }
      });
      playerNameEl.textContent = session.recordingName;
      renderSudsLog();
      renderHotspotList();
      startTicking();
    } else {
      showListView();
    }

    refreshRecordingList();
    renderHistory();

    uploadInput.addEventListener('change', handleUpload);
    startBtn.addEventListener('click', startListening);
    beforeCancelBtn.addEventListener('click', cancelBefore);

    interruptBtn.addEventListener('click', () => {
      if (isAnyModalOpen()) return;
      openModal(interruptModal);
    });

    dissociationBtn.addEventListener('click', () => {
      if (isAnyModalOpen()) return;
      audioEl.pause();
      window.PESafety.showGroundingAlert({
        onContinue: () => {
          audioEl.play().catch(() => {});
        },
        onStopToday: () => {
          endedEarly = true;
          beginEndFlow();
        },
      });
    });

    sudsPromptBtn.addEventListener('click', () => {
      if (isAnyModalOpen()) return;
      openSudsCheck();
    });

    sudsCheckInput.addEventListener('input', () => {
      sudsCheckValueEl.textContent = sudsCheckInput.value;
    });
    sudsCheckConfirmBtn.addEventListener('click', submitSudsCheck);

    targetContinueBtn.addEventListener('click', () => closeModal(targetMetModal));
    targetEndBtn.addEventListener('click', () => {
      closeModal(targetMetModal);
      beginEndFlow();
    });

    extendContinueBtn.addEventListener('click', () => closeModal(extendModal));
    extendEndBtn.addEventListener('click', () => {
      closeModal(extendModal);
      beginEndFlow();
    });

    interruptContinueBtn.addEventListener('click', () => closeModal(interruptModal));
    interruptStopBtn.addEventListener('click', () => {
      closeModal(interruptModal);
      endedEarly = true;
      beginEndFlow();
    });

    finalSudsInput.addEventListener('input', () => {
      finalSudsValueEl.textContent = finalSudsInput.value;
    });
    finalSudsConfirmBtn.addEventListener('click', confirmFinalSuds);

    saveBtn.addEventListener('click', saveListeningRecord);

    beforeSudsInput.addEventListener('input', () => {
      beforeSudsValueEl.textContent = beforeSudsInput.value;
    });

    hotspotBtn.addEventListener('click', markHotspot);

    // 화면이 백그라운드에 있다가 다시 보일 때 경과 시간을 즉시 다시 확인 (exposure.js와 동일)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && session) tick();
    });
  }

  init();
})();
