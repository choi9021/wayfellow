// settings.js - 설정 탭: 알림 설정(준비 중 안내) / 개인정보 관리 / 회피 체크리스트 관리 / 앱 정보 / 버전 정보
//
// "데이터 내보내기"/"전체 삭제" 버튼은 records.js가 이미 id 기준으로 이벤트를 붙이므로
// (DOM 위치와 무관), 이 파일은 모달을 열고 닫는 것과 환자 코드 표시만 담당한다.
//
// 회피 체크리스트 관리: 기본 5항목(고정, exposure.js에 하드코딩) 외에 치료자와 함께 등록하는
// 이 환자만의 안전행동을 'custom-safety-behaviors' 키([{id, label}])에 저장한다.
// exposure.js가 실제노출 종료 화면에서 이 키를 읽어 체크리스트에 추가로 렌더링한다.

(function () {
  const PATIENT_CODE_KEY = 'patient-code';
  const CUSTOM_CHECKLIST_KEY = 'custom-safety-behaviors';
  const MASCOT_ENABLED_KEY = 'mascot-enabled'; // mascot.js와 같은 저장 키
  const EXPOSURE_SETTINGS_KEY = 'exposure-settings'; // exposure.js와 같은 저장 키
  const DEFAULT_EXTEND_MINUTES = 45;
  const DEFAULT_REDUCTION_PCT = 50;

  const mascotToggle = document.getElementById('settings-mascot-toggle');

  const notificationBtn = document.getElementById('settings-notification-btn');
  const notificationModal = document.getElementById('settings-notification-modal');
  const notificationCloseBtn = document.getElementById('settings-notification-close-btn');

  const exposureBtn = document.getElementById('settings-exposure-btn');
  const exposureModal = document.getElementById('settings-exposure-modal');
  const exposureCloseBtn = document.getElementById('settings-exposure-close-btn');
  const exposureSaveBtn = document.getElementById('settings-exposure-save-btn');
  const exposureExtendInput = document.getElementById('settings-exposure-extend-minutes');
  const exposureReductionInput = document.getElementById('settings-exposure-reduction-pct');

  const appInfoBtn = document.getElementById('settings-app-info-btn');
  const appInfoModal = document.getElementById('settings-app-info-modal');
  const appInfoCloseBtn = document.getElementById('settings-app-info-close-btn');

  const privacyBtn = document.getElementById('settings-privacy-btn');
  const privacyModal = document.getElementById('settings-privacy-modal');
  const privacyCloseBtn = document.getElementById('settings-privacy-close-btn');
  const patientCodeDisplay = document.getElementById('settings-patient-code-display');
  const patientCodeInput = document.getElementById('settings-patient-code-input');
  const patientCodeSaveBtn = document.getElementById('settings-patient-code-save-btn');
  const storageUsageEl = document.getElementById('settings-storage-usage');
  const importBtn = document.getElementById('settings-import-btn');
  const importInput = document.getElementById('settings-import-input');

  const checklistBtn = document.getElementById('settings-checklist-btn');
  const checklistModal = document.getElementById('settings-checklist-modal');
  const checklistCloseBtn = document.getElementById('settings-checklist-close-btn');
  const checklistListEl = document.getElementById('settings-checklist-list');
  const checklistForm = document.getElementById('settings-checklist-form');
  const checklistInput = document.getElementById('settings-checklist-input');
  const checklistCategorySelect = document.getElementById('settings-checklist-category');

  const CATEGORY_LABELS = { avoidance: '회피 행동', safety: '안전 행동' };

  if (!notificationBtn || !appInfoBtn || !privacyBtn || !checklistBtn || !exposureBtn) return;

  function generateId() {
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function openModal(modal) {
    modal.hidden = false;
  }

  function closeModal(modal) {
    modal.hidden = true;
  }

  function refreshPatientCodeDisplay() {
    const saved = PEStorage.load(PATIENT_CODE_KEY, null);
    patientCodeDisplay.textContent = saved && saved.code
      ? `등록된 환자 코드: ${saved.code}`
      : '등록된 환자 코드가 없습니다.';
    patientCodeInput.value = '';
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  async function refreshStorageUsage() {
    if (!window.PEAudioStorage) {
      storageUsageEl.textContent = '';
      return;
    }
    const all = await PEAudioStorage.listAll();
    const totalBytes = all.reduce((sum, rec) => sum + (rec.blob ? rec.blob.size : 0), 0);
    storageUsageEl.textContent =
      all.length === 0
        ? '저장된 녹음 음성 파일이 없습니다.'
        : `녹음 음성 파일 ${all.length}개, 총 ${formatBytes(totalBytes)} 사용 중 (상상노출 탭에서 개별 삭제 가능).`;
  }

  function openPrivacyModal() {
    refreshPatientCodeDisplay();
    refreshStorageUsage();
    openModal(privacyModal);
  }

  function changePatientCode() {
    const code = patientCodeInput.value.trim();
    if (!code) return;

    const saved = PEStorage.load(PATIENT_CODE_KEY, null);
    PEStorage.save(PATIENT_CODE_KEY, {
      code,
      registeredAt: saved ? saved.registeredAt : new Date().toISOString(),
    });
    refreshPatientCodeDisplay();
    // js/sync.js(클라우드 동기화)가 새 코드로 다시 연결을 시도할 수 있도록 알림
    window.dispatchEvent(new CustomEvent('pe:patient-code-set', { detail: { code } }));
  }

  async function handleImport() {
    const file = importInput.files[0];
    if (!file) return;

    const confirmed = window.confirm(
      '데이터를 가져오면 지금 이 기기에 있는 기록을 같은 키의 가져온 값으로 덮어씁니다. ' +
        '업로드한 녹음 음성 파일은 이 가져오기에 포함되지 않습니다. 계속할까요?'
    );
    if (!confirmed) {
      importInput.value = '';
      return;
    }

    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      PEStorage.importJSON(backup);
      window.alert('데이터를 가져왔습니다. 앱을 새로고침합니다.');
      location.reload();
    } catch (error) {
      window.alert('파일을 읽는 데 실패했습니다. 이 앱에서 내보낸 JSON 파일이 맞는지 확인해주세요.');
    } finally {
      importInput.value = '';
    }
  }

  // ----- 회피 체크리스트 관리 -----
  function loadCustomChecklist() {
    return PEStorage.load(CUSTOM_CHECKLIST_KEY, []);
  }

  function saveCustomChecklist(items) {
    PEStorage.save(CUSTOM_CHECKLIST_KEY, items);
  }

  function renderChecklistList() {
    const items = loadCustomChecklist();
    checklistListEl.innerHTML = '';

    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'placeholder-text';
      empty.textContent = '아직 등록한 항목이 없습니다.';
      checklistListEl.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'manage-list-row';

      const label = document.createElement('span');
      label.className = 'manage-list-row-label';
      const categoryLabel = CATEGORY_LABELS[item.category] || CATEGORY_LABELS.avoidance;
      label.textContent = `[${categoryLabel}] ${item.label}`;
      row.appendChild(label);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'manage-list-row-remove';
      removeBtn.setAttribute('aria-label', '삭제');
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        const updated = loadCustomChecklist().filter((i) => i.id !== item.id);
        saveCustomChecklist(updated);
        renderChecklistList();
      });
      row.appendChild(removeBtn);

      checklistListEl.appendChild(row);
    });
  }

  function addCustomChecklistItem(e) {
    e.preventDefault();
    const label = checklistInput.value.trim();
    if (!label) return;

    const items = loadCustomChecklist();
    items.push({ id: generateId(), label, category: checklistCategorySelect.value });
    saveCustomChecklist(items);

    checklistInput.value = '';
    renderChecklistList();
  }

  // ----- 실제노출 기준 설정 -----
  function openExposureModal() {
    const saved = PEStorage.load(EXPOSURE_SETTINGS_KEY, {});
    exposureExtendInput.value = saved.extendMinutes || DEFAULT_EXTEND_MINUTES;
    exposureReductionInput.value = saved.reductionPct || DEFAULT_REDUCTION_PCT;
    openModal(exposureModal);
  }

  function saveExposureSettings() {
    PEStorage.save(EXPOSURE_SETTINGS_KEY, {
      extendMinutes: Number(exposureExtendInput.value) || DEFAULT_EXTEND_MINUTES,
      reductionPct: Number(exposureReductionInput.value) || DEFAULT_REDUCTION_PCT,
    });
    closeModal(exposureModal);
  }

  notificationBtn.addEventListener('click', () => openModal(notificationModal));
  notificationCloseBtn.addEventListener('click', () => closeModal(notificationModal));

  appInfoBtn.addEventListener('click', () => openModal(appInfoModal));
  appInfoCloseBtn.addEventListener('click', () => closeModal(appInfoModal));

  privacyBtn.addEventListener('click', openPrivacyModal);
  privacyCloseBtn.addEventListener('click', () => closeModal(privacyModal));
  patientCodeSaveBtn.addEventListener('click', changePatientCode);
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', handleImport);

  checklistBtn.addEventListener('click', () => {
    renderChecklistList();
    openModal(checklistModal);
  });

  exposureBtn.addEventListener('click', openExposureModal);
  exposureCloseBtn.addEventListener('click', () => closeModal(exposureModal));
  exposureSaveBtn.addEventListener('click', saveExposureSettings);
  checklistCloseBtn.addEventListener('click', () => closeModal(checklistModal));
  checklistForm.addEventListener('submit', addCustomChecklistItem);

  // ----- 디딤이 보기 토글 -----
  if (mascotToggle) {
    mascotToggle.checked = PEStorage.load(MASCOT_ENABLED_KEY, true);
    mascotToggle.addEventListener('change', () => {
      PEStorage.save(MASCOT_ENABLED_KEY, mascotToggle.checked);
      if (!mascotToggle.checked && window.Mascot) Mascot.hide();
    });
  }
})();
