// sync.js - 치료자 클라우드 동기화 (선택 기능)
//
// 이 앱의 원본 데이터는 항상 이 기기의 localStorage/IndexedDB다(PEStorage 참고, js/storage.js).
// 이 파일은 그 데이터를 통째로(PEStorage.getAllData()) 치료자의 Supabase 프로젝트로 주기적
// 으로 "미러링"만 할 뿐, 반대 방향(클라우드 → 로컬) 동기화는 하지 않는다 - 충돌 해소 로직이
// 필요 없도록 의도적으로 단순하게 설계함. 그래서 노출/녹음/호흡 중 네트워크가 끊겨도 로컬
// 기록에는 전혀 영향이 없다(이 파일의 모든 호출은 best-effort이고 실패해도 조용히 넘어감).
//
// 스키마/보안 설계는 supabase/schema.sql 주석에 자세히 적어뒀다. 요약:
// - 환자 기기는 이메일 회원가입 없이 Supabase "익명 인증"으로 조용히 uid 하나를 받는다.
// - 치료자가 발급한 코드를 claim_patient_code() RPC로 그 uid에 연결(claim)한다 - 코드
//   추측으로 남의 미연결 행을 가로채지 못하도록 이 RPC만 claim을 허용한다(RLS 정책이 직접
//   허용하지 않음).
// - js/supabase-config.js(git에 커밋 안 됨, supabase-config.example.js가 템플릿)가 없거나
//   비어있으면 이 파일은 아무 일도 하지 않는다 - 클라우드 동기화는 선택 기능이라 설정 안 해도
//   앱의 나머지 기능엔 전혀 영향 없어야 한다.
//
// 필수 사전 설정(코드로는 할 수 없음, 치료자가 Supabase 대시보드에서 직접 해야 함):
// 1. supabase/schema.sql을 SQL Editor에서 실행
// 2. Authentication > Providers에서 "Anonymous Sign-ins" 켜기 (꺼져 있으면 기본값이라 꼭 켜야 함)
// 3. js/supabase-config.js에 Project Settings > API의 URL과 anon public 키 채우기

(function () {
  const PATIENT_CODE_KEY = 'patient-code';
  const SYNC_ENABLED_KEY = 'cloud-sync-enabled';
  const SYNC_INTERVAL_MS = 60 * 1000;

  const config = window.PE_SUPABASE_CONFIG;

  const syncSection = document.getElementById('settings-sync-section');
  const syncToggle = document.getElementById('settings-sync-toggle');
  const syncStatusEl = document.getElementById('settings-sync-status');

  // 설정 안 했으면 조용히 비활성화 (앱의 나머지 기능엔 영향 없음)
  if (!config || !config.url || !config.anonKey || !window.supabase) {
    return;
  }

  const client = window.supabase.createClient(config.url, config.anonKey);

  let syncing = false;

  function isEnabled() {
    return PEStorage.load(SYNC_ENABLED_KEY, true);
  }

  function setStatus(text) {
    if (syncStatusEl) syncStatusEl.textContent = text;
  }

  async function ensureAnonSession() {
    const { data } = await client.auth.getSession();
    if (data && data.session) return;
    await client.auth.signInAnonymously();
  }

  // 치료자가 준 코드를 이번 기기의 익명 uid에 연결한다. 이미 이 기기가 이전에 연결해둔
  // 코드라면 RPC가 "already-claimed" 에러를 내는데(코드가 더 이상 비어있지 않으므로),
  // 그 자체는 문제가 아니다 - 바로 다음에 호출하는 pushSync()가 "내 소유 행"으로 정상
  // 동작하면 결과적으로 연결된 상태인 것이다.
  async function claimCode(code) {
    try {
      await ensureAnonSession();
      await client.rpc('claim_patient_code', { p_code: code });
    } catch (err) {
      // 오프라인이거나 코드가 아예 Supabase에 등록돼 있지 않은 경우 - 조용히 넘어감
    }
  }

  async function pushSync() {
    if (!isEnabled() || syncing) return;
    syncing = true;
    try {
      await ensureAnonSession();
      const { data: userData } = await client.auth.getUser();
      const uid = userData && userData.user && userData.user.id;
      if (!uid) {
        setStatus('동기화 대기 중');
        return;
      }

      const payload = PEStorage.getAllData();
      const { data, error } = await client
        .from('patients')
        .update({ data: payload, updated_at: new Date().toISOString() })
        .eq('device_auth_uid', uid)
        .select('id');

      if (error || !data || data.length === 0) {
        setStatus('동기화 대기 중 (코드가 아직 연결되지 않았어요)');
      } else {
        setStatus(`마지막 동기화: ${new Date().toLocaleTimeString('ko-KR')}`);
      }
    } catch (err) {
      setStatus('동기화 연결 실패 (오프라인일 수 있어요)');
    } finally {
      syncing = false;
    }
  }

  async function handlePatientCodeSet(e) {
    const code = e.detail && e.detail.code;
    refreshSyncUI();
    if (!code) return;
    await claimCode(code);
    pushSync();
  }

  // 환자 코드 화면/설정에서 코드가 있어야만 보이는 섹션이라, 코드 유무에 따라 보이기/
  // 숨기기를 맞춘다 (safety.js/settings.js가 코드를 저장·변경할 때 pe:patient-code-set을
  // 쏴주면 이 함수가 다시 불림)
  function refreshSyncUI() {
    if (!syncSection) return;
    const saved = PEStorage.load(PATIENT_CODE_KEY, null);
    syncSection.hidden = !saved;
    if (syncToggle) syncToggle.checked = isEnabled();
  }

  window.addEventListener('pe:patient-code-set', handlePatientCodeSet);

  if (syncToggle) {
    syncToggle.addEventListener('change', () => {
      PEStorage.save(SYNC_ENABLED_KEY, syncToggle.checked);
      if (syncToggle.checked) {
        pushSync();
      } else {
        setStatus('동기화 꺼짐');
      }
    });
  }

  refreshSyncUI();

  // 이미 코드가 저장돼 있는 재방문 환자는 앱을 열 때마다 한 번 동기화를 시도한다
  // (safety.js의 checkPatientCode()가 코드가 있으면 pe:patient-code-set을 쏴주므로,
  // 보통 여기서 별도로 또 부를 필요는 없지만 로드 순서 문제에 대비해 한 번 더 시도)
  if (PEStorage.load(PATIENT_CODE_KEY, null)) {
    pushSync();
  }

  setInterval(pushSync, SYNC_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pushSync();
  });
})();
