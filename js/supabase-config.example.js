// supabase-config.example.js - 클라우드 동기화 설정 템플릿
//
// 이 파일을 복사해서 "js/supabase-config.js"라는 이름으로 저장하고, 아래 두 값을
// 본인의 Supabase 프로젝트 값으로 채워 넣으세요 (Supabase 대시보드 > Project Settings
// > API에서 확인할 수 있습니다).
//
// 주의: 여기 들어가는 "anon public" 키는 Supabase 설계상 클라이언트(브라우저)에 노출되는
// 게 정상인 키입니다 - 실제 접근 제어는 supabase/schema.sql의 Row Level Security 정책이
// 담당합니다. 하지만 "service_role" 키는 절대 여기에 넣지 마세요 (그건 서버 전용이며,
// 넣는 순간 모든 환자 데이터가 RLS 없이 노출됩니다).
//
// js/supabase-config.js는 .gitignore에 등록돼 있어 커밋되지 않습니다. 설정하지 않으면
// (이 예시 파일만 있고 실제 파일이 없으면) 클라우드 동기화 기능은 조용히 꺼진 채로
// 앱의 나머지 기능은 그대로 동작합니다 (js/sync.js의 가드 로직 참고).
(function () {
  window.PE_SUPABASE_CONFIG = {
    url: '',      // 예: 'https://xxxxxxxxxxxx.supabase.co'
    anonKey: '',  // 예: 'eyJhbGciOiJI...' (anon public 키)
  };
})();
