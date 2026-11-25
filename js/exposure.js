// exposure.js - 실제노출(in vivo exposure) 과제 진행 및 기록 기능
//
// 세션 저장 데이터 구조 (localStorage 키: 'exposure-session', 진행 중일 때만 존재):
// {
//   itemId, itemCategory, itemDescription, itemInitialSUDS, // 선택한 위계표 항목 정보
//   startSUDS: number,         // 시작 SUDS
//   prediction: string,        // 시작 전 "가장 두려운 일" 예측 (선택, 비교용)
//   startTime: number,         // 시작 시각(epoch ms) - 화면이 꺼져도 경과 시간은 이 값으로 계산
//   sudsLog: [{ atMs, suds }], // 시간별 SUDS 기록 (atMs = 시작 후 경과 ms)
//   extendNoticeShown: boolean // 연장 권유를 이미 보여줬는지 여부
// }
//
// 완료 기록 저장 데이터 구조 (localStorage 키: 'exposure-records', 배열):
// { id, date, itemId, itemCategory, itemDescription, startSUDS, sudsLog,
//   totalDurationMs, endedEarly, checklist, prediction,
//   predictionCameTrue ('yes'|'partial'|'no'|null), actualOutcome, difference, takeaway, createdAt }
// checklist = { phone, rushing, overactivity (고정 회피행동 3개),
//               companion, safetyObject (고정 안전행동 2개),
//               custom: [{ id, label, category: 'avoidance'|'safety', checked }] }
//               // custom은 설정 > 회피 체크리스트 관리에서 등록한 항목
//
// 종료 기준(연장 권유 시점/목표 감소율)은 하드코딩하지 않고 설정 > 실제노출 기준에서
// 치료자가 바꿀 수 있다 ('exposure-settings' 키, settings.js가 관리). 기본값(45분/50%)은
// PE 프로토콜에서 흔히 쓰는 값일 뿐 모든 환자·상황에 일률적으로 강제하는 기준이 아니다.

(function () {
  const SESSION_KEY = 'exposure-session';
  const RECORDS_KEY = 'exposure-records';
  const HIERARCHY_KEY = 'hierarchy-items'; // 위계표(hierarchy.js)와 동일한 저장 키
  const SELECTED_ITEM_KEY = 'selectedExposureItemId';
  const CUSTOM_CHECKLIST_KEY = 'custom-safety-behaviors'; // 설정(settings.js)과 동일한 저장 키
  const EXPOSURE_SETTINGS_KEY = 'exposure-settings'; // 설정(settings.js)과 동일한 저장 키

  let customChecklistItems = []; // [{ id, label, category, checkbox }] - 종료 화면을 그릴 때마다 새로 만듦

  const PROMPT_INTERVAL_MS = 5 * 60 * 1000; // 5분마다 SUDS 체크
  const DEFAULT_EXTEND_MINUTES = 45;
  const DEFAULT_REDUCTION_PCT = 50;

  // 연장 권유 시점/목표 감소율은 치료자가 설정 탭에서 바꿀 수 있다 - 호출할 때마다 새로 읽어서
  // 세션 도중에 설정을 바꿔도(드물겠지만) 다음 체크부터 바로 반영되게 한다.
  function getExposureSettings() {
    const saved = PEStorage.load(EXPOSURE_SETTINGS_KEY, {});
    return {
      extendMs: (saved.extendMinutes || DEFAULT_EXTEND_MINUTES) * 60 * 1000,
      reductionRatio: (saved.reductionPct || DEFAULT_REDUCTION_PCT) / 100,
    };
  }

  let session = null; // 진행 중인 세션 (없으면 null)
  let tickInterval = null;
  let endedEarly = false; // "중단" 또는 "멍해짐"으로 끝났는지 - 종료 화면 마스코트 대사 분기용

  // ----- DOM 요소 -----
  const idleView = document.getElementById('exposure-idle-view');
  const noItemView = document.getElementById('exposure-no-item');
  const goHierarchyBtn = document.getElementById('exposure-go-hierarchy-btn');
  const selectedItemView = document.getElementById('exposure-selected-item');
  const itemCategoryEl = document.getElementById('exposure-item-category');
  const itemDescEl = document.getElementById('exposure-item-desc');
  const itemInitialSudsEl = document.getElementById('exposure-item-initial-suds');
  const startSudsInput = document.getElementById('exposure-start-suds');
  const startSudsValueEl = document.getElementById('exposure-start-suds-value');
  const predictionInput = document.getElementById('exposure-prediction');
  const startBtn = document.getElementById('exposure-start-btn');

  const runningView = document.getElementById('exposure-running-view');
  const runningCategoryEl = document.getElementById('exposure-running-category');
  const runningDescEl = document.getElementById('exposure-running-desc');
  const elapsedEl = document.getElementById('exposure-elapsed');
  const sudsLogListEl = document.getElementById('exposure-suds-log-list');
  const sudsPromptBtn = document.getElementById('exposure-suds-prompt-btn');
  const interruptBtn = document.getElementById('exposure-interrupt-btn');

  const endView = document.getElementById('exposure-end-view');
  const summaryEl = document.getElementById('exposure-summary');
  const predictionRecapEl = document.getElementById('exposure-prediction-recap');
  const predictionCheckWrap = document.getElementById('exposure-prediction-check-wrap');
  const predictionCameTrueSelect = document.getElementById('exposure-prediction-came-true');
  const actualOutcomeInput = document.getElementById('exposure-actual-outcome');
  const differenceInput = document.getElementById('exposure-difference');
  const takeawayInput = document.getElementById('exposure-takeaway');
  const saveBtn = document.getElementById('exposure-save-btn');
  const checklistBoxes = {
    phone: document.getElementById('checklist-phone'),
    companion: document.getElementById('checklist-companion'),
    rushing: document.getElementById('checklist-rushing'),
    safetyObject: document.getElementById('checklist-safety-object'),
    overactivity: document.getElementById('checklist-overactivity'),
  };
  const customChecklistEl = document.getElementById('exposure-custom-checklist');

  const sudsCheckModal = document.getElementById('exposure-suds-check-modal');
  const sudsCheckInput = document.getElementById('exposure-suds-check-input');
  const sudsCheckValueEl = document.getElementById('exposure-suds-check-value');
  const sudsCheckConfirmBtn = document.getElementById('exposure-suds-check-confirm-btn');

  const targetMetModal = document.getElementById('exposure-target-met-modal');
  const targetContinueBtn = document.getElementById('exposure-target-continue-btn');
  const targetEndBtn = document.getElementById('exposure-target-end-btn');

  const extendModal = document.getElementById('exposure-extend-modal');
  const extendContinueBtn = document.getElementById('exposure-extend-continue-btn');
  const extendEndBtn = document.getElementById('exposure-extend-end-btn');

  const interruptModal = document.getElementById('exposure-interrupt-modal');
  const interruptContinueBtn = document.getElementById('exposure-interrupt-continue-btn');
  const interruptStopBtn = document.getElementById('exposure-interrupt-stop-btn');

  const dissociationBtn = document.getElementById('exposure-dissociation-btn');

  const finalSudsModal = document.getElementById('exposure-final-suds-modal');
  const finalSudsInput = document.getElementById('exposure-final-suds-input');
  const finalSudsValueEl = document.getElementById('exposure-final-suds-value');
  const finalSudsConfirmBtn = document.getElementById('exposure-final-suds-confirm-btn');

  const ALL_MODALS = [sudsCheckModal, targetMetModal, extendModal, interruptModal, finalSudsModal];

  if (!idleView || !runningView) return;

  function generateId() {
    return 'e_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ----- 모달 제어 -----
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

  // ----- 시간 표시 포맷 -----
  function formatElapsed(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  }

  // ----- 저장/불러오기 -----
  function saveSession() {
    PEStorage.save(SESSION_KEY, session);
  }

  function clearSession() {
    session = null;
    PEStorage.remove(SESSION_KEY);
  }

  function lastLogEntry() {
    return session.sudsLog[session.sudsLog.length - 1];
  }

  function hasMetTarget() {
    const { reductionRatio } = getExposureSettings();
    return lastLogEntry().suds <= session.startSUDS * (1 - reductionRatio);
  }

  // ----- 대기 화면 -----
  function refreshIdleView() {
    if (session) return; // 진행 중인 세션이 있으면 대기 화면을 건드리지 않음

    const selectedId = PEStorage.load(SELECTED_ITEM_KEY, null);
    const hierarchyItems = PEStorage.load(HIERARCHY_KEY, []);
    const item = selectedId ? hierarchyItems.find((i) => i.id === selectedId) : null;

    if (!item) {
      noItemView.hidden = false;
      selectedItemView.hidden = true;
      if (window.Mascot) Mascot.showAmbient('default');
      return;
    }

    noItemView.hidden = true;
    selectedItemView.hidden = false;
    itemCategoryEl.textContent = item.category;
    itemDescEl.textContent = item.description;
    itemInitialSudsEl.textContent = `최초 SUDS: ${item.initialSUDS} / 현재 SUDS: ${item.currentSUDS}`;
    startSudsInput.value = item.currentSUDS;
    startSudsValueEl.textContent = String(item.currentSUDS);
    predictionInput.value = '';

    selectedItemView.dataset.itemId = item.id;

    // 화면별 마스코트 상태 요청: 노출 시작 전 대기 화면에 머무는 동안은 편안한 표정을 계속 보여줌
    if (window.Mascot) {
      Mascot.showAmbient('default');
      Mascot.say('exposure.before');
    }
  }

  function startSession() {
    const itemId = selectedItemView.dataset.itemId;
    const hierarchyItems = PEStorage.load(HIERARCHY_KEY, []);
    const item = hierarchyItems.find((i) => i.id === itemId);
    if (!item) return;

    const startSUDS = Number(startSudsInput.value);
    const prediction = predictionInput.value.trim();
    endedEarly = false;

    session = {
      itemId: item.id,
      itemCategory: item.category,
      itemDescription: item.description,
      itemInitialSUDS: item.initialSUDS,
      startSUDS,
      prediction,
      startTime: Date.now(),
      sudsLog: [{ atMs: 0, suds: startSUDS }],
      extendNoticeShown: false,
    };
    saveSession();

    if (window.Mascot) {
      Mascot.say('exposure.start');
      // "다녀와, 여기서 기다릴게" 말풍선이 2초간 보인 뒤에 잠겨야 하므로(스크립트의 autoHideMs),
      // 그 직후에 잠근다 - 바로 잠그면 말풍선이 뜨자마자 숨어버린다
      setTimeout(() => Mascot.lock(), 2100);
    }

    showRunningView();
    startTicking();
  }

  // ----- 진행 화면 -----
  function showRunningView() {
    idleView.hidden = true;
    endView.hidden = true;
    runningView.hidden = false;

    runningCategoryEl.textContent = session.itemCategory;
    runningDescEl.textContent = session.itemDescription;
    renderSudsLog();
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
    elapsedEl.textContent = formatElapsed(elapsedMs);

    if (isAnyModalOpen()) return;

    // 설정된 연장 권유 시점이 지났는데 아직 목표 감소율에 못 미치면 한 번만 안내
    // (강제 종료 기준이 아니라 권유일 뿐 - 실제 종료 여부는 항상 사용자가 선택)
    const { extendMs } = getExposureSettings();
    if (!session.extendNoticeShown && elapsedMs >= extendMs && !hasMetTarget()) {
      session.extendNoticeShown = true;
      saveSession();
      openModal(extendModal);
      return;
    }

    // 5분마다 "지금 SUDS는?" 체크
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
    if (window.Mascot) Mascot.unlock();
    showEndView();
  }

  // "멍해짐/현실감 없음"으로 종료할 때는 그라운딩 직후에 숫자를 다시 묻지 않고,
  // 마지막으로 기록된 SUDS를 그대로 써서 바로 마무리 화면(체크리스트/메모)으로 넘어간다.
  function endDueToDissociation() {
    const elapsedMs = Date.now() - session.startTime;
    session.sudsLog.push({ atMs: elapsedMs, suds: lastLogEntry().suds });
    session.totalDurationMs = elapsedMs;
    saveSession();

    endedEarly = true;
    stopTicking();
    if (window.Mascot) Mascot.unlock();
    showEndView();
  }

  // 치료자와 함께 등록한 이 환자만의 안전행동(설정 > 회피 체크리스트 관리)을 종료 화면에 추가로 그림.
  // 기본 5항목과 같은 체크 애니메이션(CSS :checked)을 쓰도록 같은 마크업 구조로 만들고,
  // 고정 항목과 같은 방식으로 회피/안전 행동을 구분해서 그룹 라벨을 붙인다.
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
    runningView.hidden = true;
    endView.hidden = false;

    const first = session.startSUDS;
    const last = lastLogEntry().suds;
    const reductionPct = first > 0 ? Math.round((1 - last / first) * 100) : 0;

    summaryEl.innerHTML = '';
    const rows = [
      `상황: ${session.itemDescription}`,
      `시작 SUDS: ${first} → 종료 SUDS: ${last} (${reductionPct}% 감소)`,
      `총 소요 시간: ${formatElapsed(session.totalDurationMs)}`,
    ];
    rows.forEach((text) => {
      const p = document.createElement('p');
      p.className = 'exposure-summary-row';
      p.textContent = text;
      summaryEl.appendChild(p);
    });

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

    if (window.Mascot) {
      Mascot.say(endedEarly ? 'exposure.stoppedEarly' : 'exposure.done');
    }
  }

  function saveRecord() {
    const record = {
      id: generateId(),
      date: new Date(session.startTime).toISOString().slice(0, 10),
      itemId: session.itemId,
      itemCategory: session.itemCategory,
      itemDescription: session.itemDescription,
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
      createdAt: new Date().toISOString(),
    };

    const records = PEStorage.load(RECORDS_KEY, []);
    records.push(record);
    PEStorage.save(RECORDS_KEY, records);

    if (window.MicroReaction) {
      MicroReaction.ripple();
      if (!endedEarly) MicroReaction.firefly();
    }

    // 화면별 마스코트 상태 요청: 기록 저장 완료 순간엔 말풍선 없이 입 벌린 기쁨 표정을 짧게 보여줌
    // (하루 1회 제한 없이 저장할 때마다 반응 - say()가 아니라 flashFace를 쓰는 이유)
    if (window.Mascot) Mascot.flashFace('joy', null, 1800);

    const finalSUDS = lastLogEntry().suds;
    const itemId = session.itemId;
    const itemDescription = session.itemDescription;

    clearSession();

    // 위계표의 현재 SUDS를 이번 결과로 갱신할지 확인
    const shouldUpdate = window.confirm(
      `위계표의 "${itemDescription}" 현재 SUDS를 이번 결과(${finalSUDS})로 업데이트할까요?`
    );
    if (shouldUpdate) {
      const hierarchyItems = PEStorage.load(HIERARCHY_KEY, []);
      const item = hierarchyItems.find((i) => i.id === itemId);
      if (item) {
        item.currentSUDS = finalSUDS;
        item.updatedAt = new Date().toISOString();
        PEStorage.save(HIERARCHY_KEY, hierarchyItems);

        if (window.Mascot && item.initialSUDS - item.currentSUDS >= 2) {
          Mascot.say('hierarchy.settled');
        }
      }
    }

    PEStorage.remove(SELECTED_ITEM_KEY);

    endView.hidden = true;
    idleView.hidden = false;
    refreshIdleView();
  }

  // 다른 탭에서 넘어올 때(홈 카드 클릭 등) 노출 진행 중인지 확인해 마스코트 ambient 여부를
  // 판단할 수 있도록 노출시킨다 (index.html의 activateTab이 사용)
  window.PEExposure = { isSessionActive: () => !!session };

  function init() {
    const saved = PEStorage.load(SESSION_KEY, null);
    if (saved !== null) {
      session = saved;
      showRunningView();
      startTicking();
    } else {
      refreshIdleView();
    }

    goHierarchyBtn.addEventListener('click', () => {
      if (window.PEApp && typeof window.PEApp.switchTab === 'function') {
        window.PEApp.switchTab('hierarchy');
      }
    });

    startSudsInput.addEventListener('input', () => {
      startSudsValueEl.textContent = startSudsInput.value;
    });
    startBtn.addEventListener('click', startSession);

    interruptBtn.addEventListener('click', () => {
      if (isAnyModalOpen()) return;
      openModal(interruptModal);
    });

    dissociationBtn.addEventListener('click', () => {
      if (isAnyModalOpen()) return;
      window.PESafety.showGroundingAlert({
        onContinue: () => {
          // 그냥 닫고 계속 진행 (tick()이 알아서 이어감)
        },
        onStopToday: () => {
          endDueToDissociation();
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

    saveBtn.addEventListener('click', saveRecord);

    // 화면이 백그라운드에 있다가 다시 보일 때 경과 시간을 즉시 다시 확인
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && session) tick();
    });

    // 위계표에서 새 항목을 선택했을 때 대기 화면을 바로 갱신
    window.addEventListener('pe:exposure-item-selected', () => {
      if (!session) refreshIdleView();
    });
  }

  init();
})();
