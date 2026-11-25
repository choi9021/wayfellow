// therapist.js - 치료자 대시보드 (therapist.html 전용)
//
// 환자 쪽(js/sync.js)은 익명 인증 + 코드로 회원가입 없이 동작하지만, 치료자는 진짜
// 이메일/비밀번호 계정(Supabase Auth)으로 로그인한다. 이 파일이 다루는 데이터는 전부
// supabase/schema.sql의 `patients` 테이블이고, RLS 정책 덕분에 로그인한 치료자 자신의
// 환자 행만 보인다 - 클라이언트 코드에서 따로 필터링하지 않아도 안전함.
//
// `data` 컬럼은 환자 기기의 PEStorage.getAllData() 전체를 그대로 미러링한 JSON이라서,
// 여기서 읽는 키(hierarchy-items, exposure-records 등)는 전부 js/hierarchy.js,
// js/exposure.js 등 환자 앱 쪽 파일의 주석에 적힌 데이터 구조와 1:1로 같다.

(function () {
  const config = window.PE_SUPABASE_CONFIG;

  const notConfiguredEl = document.getElementById('tp-not-configured');
  const authView = document.getElementById('tp-auth-view');
  const authTitle = document.getElementById('tp-auth-title');
  const emailInput = document.getElementById('tp-email');
  const passwordInput = document.getElementById('tp-password');
  const authErrorEl = document.getElementById('tp-auth-error');
  const authSubmitBtn = document.getElementById('tp-auth-submit-btn');
  const authToggleBtn = document.getElementById('tp-auth-toggle-btn');
  const logoutBtn = document.getElementById('tp-logout-btn');

  const listView = document.getElementById('tp-patient-list-view');
  const listEl = document.getElementById('tp-patient-list');
  const newPatientBtn = document.getElementById('tp-new-patient-btn');

  const detailView = document.getElementById('tp-patient-detail-view');
  const detailTitle = document.getElementById('tp-detail-title');
  const detailContent = document.getElementById('tp-detail-content');
  const backToListBtn = document.getElementById('tp-back-to-list-btn');

  if (!config || !config.url || !config.anonKey || !window.supabase) {
    if (notConfiguredEl) notConfiguredEl.hidden = false;
    return;
  }

  const client = window.supabase.createClient(config.url, config.anonKey);

  let isSignUpMode = false;
  let patientsCache = [];

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showView(view) {
    [authView, listView, detailView].forEach((v) => {
      if (v) v.hidden = v !== view;
    });
  }

  // ----- 인증 -----
  function setAuthError(message) {
    if (!authErrorEl) return;
    authErrorEl.hidden = !message;
    authErrorEl.textContent = message || '';
  }

  function updateAuthMode() {
    authTitle.textContent = isSignUpMode ? '회원가입' : '로그인';
    authSubmitBtn.textContent = isSignUpMode ? '회원가입' : '로그인';
    authToggleBtn.textContent = isSignUpMode ? '이미 계정이 있으신가요? 로그인' : '계정이 없으신가요? 회원가입';
    setAuthError('');
  }

  async function handleAuthSubmit() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      setAuthError('이메일과 비밀번호를 모두 입력해주세요.');
      return;
    }

    setAuthError('');
    authSubmitBtn.disabled = true;
    try {
      const { error } = isSignUpMode
        ? await client.auth.signUp({ email, password })
        : await client.auth.signInWithPassword({ email, password });

      if (error) {
        setAuthError(error.message);
        return;
      }

      if (isSignUpMode) {
        setAuthError('가입 확인 메일을 보냈다면 메일함을 확인한 뒤 로그인해주세요. 확인 메일이 필요 없는 설정이라면 바로 로그인됩니다.');
      }

      await refreshAuthState();
    } finally {
      authSubmitBtn.disabled = false;
    }
  }

  async function handleLogout() {
    await client.auth.signOut();
    await refreshAuthState();
  }

  async function refreshAuthState() {
    const { data } = await client.auth.getSession();
    const session = data && data.session;

    if (session && session.user) {
      logoutBtn.hidden = false;
      await loadPatientList();
      showView(listView);
    } else {
      logoutBtn.hidden = true;
      showView(authView);
    }
  }

  // ----- 환자 목록 -----
  async function loadPatientList() {
    const { data, error } = await client
      .from('patients')
      .select('id, code, display_name, updated_at')
      .order('updated_at', { ascending: false });

    if (error) {
      listEl.innerHTML = '';
      listEl.appendChild(el('p', 'placeholder-text', '환자 목록을 불러오지 못했습니다: ' + error.message));
      return;
    }

    patientsCache = data || [];
    renderPatientList();
  }

  function renderPatientList() {
    listEl.innerHTML = '';

    if (patientsCache.length === 0) {
      listEl.appendChild(el('p', 'placeholder-text', '아직 발급한 환자 코드가 없습니다. 위에서 새로 발급해보세요.'));
      return;
    }

    patientsCache.forEach((patient) => {
      const card = el('div', 'hierarchy-item tp-patient-card');

      const header = el('div', 'hierarchy-item-header');
      header.appendChild(el('span', 'category-badge', patient.code));
      if (!patient.updated_at) {
        header.appendChild(el('span', 'weekly-badge', '연결 대기 중'));
      }
      card.appendChild(header);

      card.appendChild(el('p', 'hierarchy-item-desc', patient.display_name || '(이름 미지정)'));
      card.appendChild(
        el(
          'p',
          'safety-note',
          patient.updated_at
            ? `마지막 동기화: ${new Date(patient.updated_at).toLocaleString('ko-KR')}`
            : '환자가 아직 이 코드를 입력하지 않았어요.'
        )
      );

      const openBtn = el('button', 'btn btn-outline', '기록 보기');
      openBtn.type = 'button';
      openBtn.addEventListener('click', () => openPatientDetail(patient.id));
      card.appendChild(openBtn);

      listEl.appendChild(card);
    });
  }

  function generatePatientCode() {
    // 헷갈리는 문자(0/O, 1/I) 제외
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  async function handleNewPatient() {
    const { data: sessionData } = await client.auth.getSession();
    const therapistId = sessionData && sessionData.session && sessionData.session.user.id;
    if (!therapistId) return;

    const code = generatePatientCode();
    const { error } = await client.from('patients').insert({ therapist_id: therapistId, code });

    if (error) {
      window.alert('코드 발급에 실패했습니다: ' + error.message);
      return;
    }

    window.alert(`새 환자 코드: ${code}\n\n이 코드를 환자에게 전달해주세요. 환자가 Wayfellow 앱의 "환자 코드 입력"에 이 코드를 넣고, 설정 > 개인정보 관리에서 "치료자와 자동 동기화"를 켜면 기록이 올라옵니다.`);
    await loadPatientList();
  }

  // ----- 환자 상세 -----
  async function openPatientDetail(patientId) {
    const { data: patient, error } = await client
      .from('patients')
      .select('*')
      .eq('id', patientId)
      .single();

    if (error || !patient) {
      window.alert('환자 기록을 불러오지 못했습니다.');
      return;
    }

    detailTitle.textContent = patient.display_name || patient.code;
    renderPatientDetail(patient);
    showView(detailView);
  }

  function section(title, descText) {
    const wrap = el('div', 'records-section');
    wrap.appendChild(el('h3', null, title));
    if (descText) wrap.appendChild(el('p', 'placeholder-text', descText));
    return wrap;
  }

  function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}분 ${String(seconds).padStart(2, '0')}초`;
  }

  // records.js의 같은 이름 함수와 동일 - 환자 앱과 치료자 대시보드가 서로 다른 데이터
  // 소스(PEStorage vs fetch한 JSON)를 읽어서 모듈을 공유하기 애매해 중복해뒀다.
  const CHECKLIST_LABELS = {
    phone: { label: '휴대폰 확인', category: 'avoidance' },
    rushing: { label: '서두름', category: 'avoidance' },
    overactivity: { label: '과도한 활동', category: 'avoidance' },
    companion: { label: '동행자 의지', category: 'safety' },
    safetyObject: { label: '안전 물품', category: 'safety' },
  };

  function formatChecklistSummary(checklist) {
    if (!checklist) return null;

    const items = Object.keys(CHECKLIST_LABELS).map((key) => ({
      label: CHECKLIST_LABELS[key].label,
      category: CHECKLIST_LABELS[key].category,
      checked: !!checklist[key],
    }));
    (checklist.custom || []).forEach((c) => {
      items.push({ label: c.label, category: c.category || 'avoidance', checked: !!c.checked });
    });

    const fmt = (list) => list.map((i) => `${i.label}${i.checked ? ' ✓' : ''}`).join(', ');
    const avoidance = items.filter((i) => i.category === 'avoidance');
    const safety = items.filter((i) => i.category === 'safety');

    const parts = [];
    if (avoidance.length) parts.push(`회피행동 - ${fmt(avoidance)}`);
    if (safety.length) parts.push(`안전행동 - ${fmt(safety)}`);
    return parts.join(' / ');
  }

  function renderPatientDetail(patient) {
    const payload = patient.data || {};
    detailContent.innerHTML = '';

    // 동기화 상태
    const statusSection = section('동기화 상태');
    statusSection.appendChild(
      el(
        'p',
        'safety-note',
        patient.updated_at
          ? `마지막 동기화: ${new Date(patient.updated_at).toLocaleString('ko-KR')}`
          : '아직 이 코드로 연결된 기기가 없습니다.'
      )
    );
    detailContent.appendChild(statusSection);

    // 회기 준비 메모 (환자가 직접 적어 치료자에게 남긴 메모 - 가장 먼저 보여줌)
    const prep = payload['session-prep-notes'];
    if (prep && (prep.memorable || prep.difficult || prep.questions || prep.discuss)) {
      const prepSection = section('환자가 남긴 회기 준비 메모');
      [
        ['지난 회기 이후 기억에 남은 경험', prep.memorable],
        ['어려웠던 과제', prep.difficult],
        ['다음 회기에 질문하고 싶은 내용', prep.questions],
        ['치료자와 상의할 사항', prep.discuss],
      ].forEach(([label, text]) => {
        if (!text) return;
        const row = el('p', 'report-note-item');
        row.innerHTML = `<strong>${label}:</strong> `;
        row.appendChild(document.createTextNode(text));
        prepSection.appendChild(row);
      });
      detailContent.appendChild(prepSection);
    }

    // 위계표 비교 (최초 vs 현재 SUDS)
    const hierarchyItems = payload['hierarchy-items'] || [];
    const hierarchySection = section('위계표 (SUDS 최초 vs 현재)');
    if (hierarchyItems.length === 0) {
      hierarchySection.appendChild(el('p', 'placeholder-text', '위계표 항목이 없습니다.'));
    } else {
      hierarchyItems
        .slice()
        .sort((a, b) => a.currentSUDS - b.currentSUDS)
        .forEach((item) => {
          const diff = item.currentSUDS - item.initialSUDS;
          const diffText = diff === 0 ? '변화 없음' : diff > 0 ? `+${diff}` : String(diff);
          hierarchySection.appendChild(
            el(
              'p',
              'report-row',
              `[${item.category}] ${item.description} — 최초 ${item.initialSUDS} → 현재 ${item.currentSUDS} (${diffText})`
            )
          );
        });
    }
    detailContent.appendChild(hierarchySection);

    // 실제노출 기록 (최근 20개)
    const exposureRecords = (payload['exposure-records'] || [])
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const exposureSection = section('실제노출 기록 (최근순)');
    if (exposureRecords.length === 0) {
      exposureSection.appendChild(el('p', 'placeholder-text', '아직 실제노출 기록이 없습니다.'));
    } else {
      exposureRecords.slice(0, 20).forEach((rec) => {
        const last = rec.sudsLog[rec.sudsLog.length - 1];
        const entry = el('div', 'album-entry');
        entry.appendChild(
          el('p', 'hierarchy-item-desc', `${rec.date} · ${rec.itemDescription}`)
        );
        entry.appendChild(
          el(
            'p',
            'album-entry-row',
            `SUDS ${rec.startSUDS} → ${last.suds}, 총 ${formatDuration(rec.totalDurationMs)}` +
              (rec.endedEarly ? ' (중단으로 종료)' : '')
          )
        );
        const checklistSummary = formatChecklistSummary(rec.checklist);
        if (checklistSummary) {
          entry.appendChild(el('p', 'album-entry-row', checklistSummary));
        }
        if (rec.prediction) {
          entry.appendChild(el('p', 'album-entry-row', `노출 전 예상: ${rec.prediction}`));
        }
        if (rec.actualOutcome) {
          entry.appendChild(el('p', 'album-entry-row', `실제 경험: ${rec.actualOutcome}`));
        }
        if (rec.difference) {
          entry.appendChild(el('p', 'album-entry-row', `예상과 달랐던 점: ${rec.difference}`));
        }
        if (rec.takeaway) {
          entry.appendChild(el('p', 'album-entry-row', `다음에 기억하고 싶은 것: ${rec.takeaway}`));
        }
        exposureSection.appendChild(entry);
      });
    }
    detailContent.appendChild(exposureSection);

    // 상상노출 기록 (최근 20개) - 실제노출과 같은 방식으로 기록되므로 같은 구조로 보여준다
    const listeningRecords = (payload['listening-records'] || [])
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const listeningSection = section('상상노출 기록 (최근순)');
    if (listeningRecords.length === 0) {
      listeningSection.appendChild(el('p', 'placeholder-text', '아직 상상노출 기록이 없습니다.'));
    } else {
      listeningRecords.slice(0, 20).forEach((rec) => {
        const entry = el('div', 'album-entry');
        entry.appendChild(el('p', 'hierarchy-item-desc', `${rec.date} · ${rec.recordingName}`));

        if (Array.isArray(rec.sudsLog) && rec.sudsLog.length > 0) {
          const last = rec.sudsLog[rec.sudsLog.length - 1];
          entry.appendChild(
            el(
              'p',
              'album-entry-row',
              `SUDS ${rec.startSUDS} → ${last.suds}` +
                (rec.totalDurationMs ? `, 총 ${formatDuration(rec.totalDurationMs)}` : '') +
                (rec.endedEarly ? ' (중단으로 종료)' : '')
            )
          );
        }

        const checklistSummary = formatChecklistSummary(rec.checklist);
        if (checklistSummary) {
          entry.appendChild(el('p', 'album-entry-row', checklistSummary));
        }
        if (rec.prediction) {
          entry.appendChild(el('p', 'album-entry-row', `시작 전 예상: ${rec.prediction}`));
        }
        if (rec.actualOutcome) {
          entry.appendChild(el('p', 'album-entry-row', `실제 경험: ${rec.actualOutcome}`));
        }
        if (rec.difference) {
          entry.appendChild(el('p', 'album-entry-row', `예상과 달랐던 점: ${rec.difference}`));
        }
        if (rec.takeaway) {
          entry.appendChild(el('p', 'album-entry-row', `다음에 기억하고 싶은 것: ${rec.takeaway}`));
        }
        if (rec.hotspots && rec.hotspots.length > 0) {
          const times = rec.hotspots
            .map((h) => (h.note ? `${formatDuration(h.atMs)}(${h.note})` : formatDuration(h.atMs)))
            .join(', ');
          entry.appendChild(el('p', 'album-entry-row', `핫스팟: ${times}`));
        }
        listeningSection.appendChild(entry);
      });
    }
    detailContent.appendChild(listeningSection);

    // 호흡 연습 기록
    const breathingRecords = (payload['breathing-records'] || [])
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const breathingSection = section('호흡 연습 기록');
    if (breathingRecords.length === 0) {
      breathingSection.appendChild(el('p', 'placeholder-text', '아직 호흡 연습 기록이 없습니다.'));
    } else {
      breathingRecords.slice(0, 20).forEach((rec) => {
        const minutes = Math.floor(rec.durationSec / 60);
        const seconds = rec.durationSec % 60;
        breathingSection.appendChild(
          el(
            'p',
            'suds-log-row',
            `${rec.date} - ${minutes}분 ${seconds}초, ${rec.completed ? '완료' : '중간에 종료'}`
          )
        );
      });
    }
    detailContent.appendChild(breathingSection);
  }

  // ----- 이벤트 연결 -----
  authSubmitBtn.addEventListener('click', handleAuthSubmit);
  authToggleBtn.addEventListener('click', () => {
    isSignUpMode = !isSignUpMode;
    updateAuthMode();
  });
  logoutBtn.addEventListener('click', handleLogout);
  newPatientBtn.addEventListener('click', handleNewPatient);
  backToListBtn.addEventListener('click', () => {
    showView(listView);
    loadPatientList();
  });

  updateAuthMode();
  refreshAuthState();
})();
