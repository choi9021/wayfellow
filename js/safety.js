// safety.js - 앱 전체 안전장치
//
// - 환자 코드 입력 화면: 처음 1회만, 치료자에게 받은 코드를 입력받아 기록 구분용으로 저장
//   (서버가 없어 실제 인증은 아니며, 입력값을 그대로 저장하고 통과시키는 절차적 확인)
// - 첫 실행 시 "치료를 대신하지 않는다"는 안내 (한 번만 표시)
// - 모든 화면 상단 "도움이 필요해요" 버튼: 그라운딩 안내 / 치료자 연락처 / 긴급 상담전화
// - 노출·듣기 중 "멍해짐/현실감 없음" 버튼에서 쓰는 그라운딩 알림을 window.PESafety로 공개해
//   exposure.js, listening.js가 호출해서 쓸 수 있게 한다
//
// 주의: SUDS 숫자가 높다고 자동으로 과제를 중단시키는 로직은 두지 않는다
// (노출 중 불안이 올라가는 것은 자연스러운 과정이기 때문).

(function () {
  const PATIENT_CODE_KEY = 'patient-code'; // { code, registeredAt }
  const ONBOARDING_SEEN_KEY = 'onboarding-seen';
  const THERAPIST_CONTACT_KEY = 'therapist-contact'; // { name, phone }

  const codeScreen = document.getElementById('patient-code-screen');
  const codeForm = document.getElementById('patient-code-form');
  const codeInput = document.getElementById('patient-code-input');

  const helpBtn = document.getElementById('safety-help-btn');

  const onboardingModal = document.getElementById('safety-onboarding-modal');
  const onboardingConfirmBtn = document.getElementById('safety-onboarding-confirm-btn');

  const helpModal = document.getElementById('safety-help-modal');
  const helpCloseBtn = document.getElementById('safety-help-close-btn');

  const therapistDisplay = document.getElementById('safety-therapist-display');
  const therapistInfoEl = document.getElementById('safety-therapist-info');
  const therapistCallLink = document.getElementById('safety-therapist-call-link');
  const therapistEditBtn = document.getElementById('safety-therapist-edit-btn');

  const therapistForm = document.getElementById('safety-therapist-form');
  const therapistNameInput = document.getElementById('safety-therapist-name');
  const therapistPhoneInput = document.getElementById('safety-therapist-phone');
  const therapistSaveBtn = document.getElementById('safety-therapist-save-btn');

  const groundingModal = document.getElementById('safety-grounding-modal');
  const groundingContinueBtn = document.getElementById('safety-grounding-continue-btn');
  const groundingStopBtn = document.getElementById('safety-grounding-stop-btn');

  if (!helpBtn || !onboardingModal || !codeScreen) return;

  function openModal(modal) {
    modal.hidden = false;
  }

  function closeModal(modal) {
    modal.hidden = true;
  }

  // ----- 환자 코드 입력 (처음 1회만) -----
  function checkPatientCode() {
    const saved = PEStorage.load(PATIENT_CODE_KEY, null);
    if (!saved) {
      openModal(codeScreen);
    } else {
      // 코드가 이미 있는 재방문 환자도 앱을 열 때마다 js/sync.js(클라우드 동기화, 설정 안
      // 했으면 아무도 안 들음)가 동기화를 시도할 수 있도록 알려준다
      notifyPatientCodeSet(saved.code);
    }
  }

  // 코드가 새로 저장/변경될 때마다 쏘는 이벤트 - js/sync.js가 이걸 듣고 클라우드 동기화를
  // 시도한다. 동기화 기능을 설정 안 했으면 아무도 안 듣고 지나가므로 안전함.
  function notifyPatientCodeSet(code) {
    window.dispatchEvent(new CustomEvent('pe:patient-code-set', { detail: { code } }));
  }

  function submitPatientCode(e) {
    e.preventDefault();
    const code = codeInput.value.trim();
    if (!code) return;

    PEStorage.save(PATIENT_CODE_KEY, { code, registeredAt: new Date().toISOString() });
    closeModal(codeScreen);
    notifyPatientCodeSet(code);

    if (window.Mascot) Mascot.say('patientCode.done');
  }

  // ----- 첫 실행 안내 -----
  function checkFirstRun() {
    const seen = PEStorage.load(ONBOARDING_SEEN_KEY, false);
    if (!seen) openModal(onboardingModal);
  }

  function dismissOnboarding() {
    PEStorage.save(ONBOARDING_SEEN_KEY, true);
    closeModal(onboardingModal);

    if (window.Mascot) Mascot.say('firstRun.after');
  }

  // ----- 치료자 연락처 (도움 패널 안에서 바로 입력/수정) -----
  function refreshTherapistSection() {
    const contact = PEStorage.load(THERAPIST_CONTACT_KEY, null);
    if (contact && contact.phone) {
      therapistDisplay.hidden = false;
      therapistForm.hidden = true;
      therapistInfoEl.textContent = contact.name ? `${contact.name} - ${contact.phone}` : contact.phone;
      therapistCallLink.href = `tel:${contact.phone.replace(/[^0-9+]/g, '')}`;
    } else {
      therapistDisplay.hidden = true;
      therapistForm.hidden = false;
      therapistNameInput.value = '';
      therapistPhoneInput.value = '';
    }
  }

  function saveTherapistContact() {
    const name = therapistNameInput.value.trim();
    const phone = therapistPhoneInput.value.trim();
    if (!phone) return;

    PEStorage.save(THERAPIST_CONTACT_KEY, { name, phone });
    refreshTherapistSection();
  }

  function editTherapistContact() {
    const contact = PEStorage.load(THERAPIST_CONTACT_KEY, null);
    therapistNameInput.value = contact ? contact.name || '' : '';
    therapistPhoneInput.value = contact ? contact.phone || '' : '';
    therapistDisplay.hidden = true;
    therapistForm.hidden = false;
  }

  // ----- 도움이 필요해요 패널 -----
  function openHelp() {
    refreshTherapistSection();
    openModal(helpModal);

    if (window.Mascot) Mascot.say('help.open');
  }

  // ----- 그라운딩 알림 (노출/듣기 중 "멍해짐" 버튼에서 호출) -----
  let activeCallbacks = null;

  function showGroundingAlert(callbacks) {
    activeCallbacks = callbacks || {};
    openModal(groundingModal);
    if (window.Mascot) Mascot.lock();
  }

  function isGroundingAlertOpen() {
    return !groundingModal.hidden;
  }

  function resolveGrounding(key) {
    closeModal(groundingModal);
    if (window.Mascot) {
      Mascot.unlock();
      Mascot.say('help.after');
    }
    const callbacks = activeCallbacks;
    activeCallbacks = null;
    if (callbacks && typeof callbacks[key] === 'function') callbacks[key]();
  }

  // 다른 탭(exposure.js, listening.js)에서 호출할 수 있도록 전역으로 공개
  window.PESafety = {
    showGroundingAlert,
    isGroundingAlertOpen,
    checkPatientCode,
  };

  function init() {
    // checkPatientCode()는 여기서 바로 부르지 않는다 - 환자 코드 화면도 시작화면과 같은
    // z-index(200)를 쓰는데, 여기서 즉시 열면 DOM에서 더 나중에 나오는 환자 코드 화면이
    // 시작화면보다 위에 떠서 "시작화면 먼저 → 환자 코드" 순서(이 파일 "환자 코드 입력 화면"
    // 설명 참고)가 뒤집히는 버그가 있었다. index.html의 시작화면 "시작하기" 버튼 클릭
    // 핸들러가 시작화면을 닫은 뒤 PESafety.checkPatientCode()를 불러준다.
    checkFirstRun();
    refreshTherapistSection();

    codeForm.addEventListener('submit', submitPatientCode);

    helpBtn.addEventListener('click', openHelp);
    onboardingConfirmBtn.addEventListener('click', dismissOnboarding);
    helpCloseBtn.addEventListener('click', () => closeModal(helpModal));

    therapistSaveBtn.addEventListener('click', saveTherapistContact);
    therapistEditBtn.addEventListener('click', editTherapistContact);

    groundingContinueBtn.addEventListener('click', () => resolveGrounding('onContinue'));
    groundingStopBtn.addEventListener('click', () => resolveGrounding('onStopToday'));
  }

  init();
})();
