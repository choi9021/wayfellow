// supabase-config.js - 실제 연결 정보 (Vercel 배포를 위해 2026-11-26부터 커밋됨)
//
// 주의: 여기 들어가는 "anon public" 키는 Supabase 설계상 클라이언트(브라우저)에 노출되는
// 게 정상인 키입니다 - 실제 접근 제어는 supabase/schema.sql의 Row Level Security 정책이
// 담당합니다. 하지만 "service_role" 키는 절대 여기에 넣지 마세요 (그건 서버 전용이며,
// 넣는 순간 모든 환자 데이터가 RLS 없이 노출됩니다).
//
// 이 저장소는 private이고, Vercel이 빌드 없이 파일을 그대로 서빙하는 정적 배포라 서버
// 환경변수로 주입할 방법이 없어서 이 파일을 커밋하기로 함(.gitignore 참고). 공개 저장소로
// 바뀌거나 포크한다면 이 파일을 다시 .gitignore에 넣고 각자 자기 키로 채우는 방식으로
// 되돌릴 것 - 템플릿은 js/supabase-config.example.js에 그대로 남겨둠.
(function () {
  window.PE_SUPABASE_CONFIG = {
    url: 'https://albexfmxvarsrmijharj.supabase.co',      // 예: 'https://xxxxxxxxxxxx.supabase.co'
    anonKey: 'sb_publishable_AMea9Yf2LerDGXH2dzbVmg_GHtbMyol',  // 예: 'eyJhbGciOiJI...' (anon public 키)
  };
})();
