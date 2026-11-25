-- Wayfellow 클라우드 동기화 스키마
--
-- 이 파일은 Supabase 대시보드의 SQL Editor에 붙여넣어 한 번 실행하면 된다(코드 변경 없이
-- 직접 실행하는 설정 파일 - 앱이 자동으로 실행하지 않음).
--
-- 설계 원칙 (js/sync.js, js/therapist.js와 반드시 함께 읽을 것):
-- - 환자 기기는 이메일 회원가입을 하지 않는다. 대신 Supabase "익명 인증"(signInAnonymously)으로
--   기기마다 조용히 auth.uid()를 하나씩 받고, 치료자가 발급한 "환자 코드"를 한 번 입력해 그
--   uid를 patients.device_auth_uid에 연결(claim)한다. 코드 자체는 여전히 "진짜 인증이 아닌
--   절차적 확인"이라는 이 앱의 기존 원칙(CLAUDE.md "안전장치" 섹션의 환자 코드 설명)을 그대로
--   따르지만, 이제 그 코드가 클라우드 쪽에서 실제 행(row) 접근 권한과 연결되므로, 코드 추측/
--   탈취로 "아직 아무도 안 쓴 코드"를 가로채지 못하도록 claim 과정만큼은 아래
--   claim_patient_code() 함수(SECURITY DEFINER)를 통해서만 하게 막아뒀다 - RLS 정책에
--   "아직 비어있는 행이면 아무나 UPDATE 가능" 같은 느슨한 규칙을 두지 않음.
-- - 로컬(localStorage/IndexedDB)이 항상 원본이다. 이 테이블의 `data` 컬럼은 환자 기기가
--   PEStorage.getAllData()를 통째로 올려보내는 "거울(mirror)"일 뿐이고, 클라우드 → 로컬
--   방향의 동기화는 없다(충돌 해소 로직이 필요 없도록 의도적으로 단순하게 설계함).
-- - 치료자는 진짜 이메일/비밀번호 계정(Supabase Auth)을 쓴다. 치료자 1명이 여러 환자를
--   가질 수 있고, 환자 1명은 정확히 한 치료자에게만 속한다.

create extension if not exists pgcrypto; -- gen_random_uuid() 사용을 위함 (Supabase 프로젝트엔 보통 기본 포함)

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references auth.users(id) on delete cascade,
  code text not null,                 -- 치료자가 환자에게 알려주는 코드 (예: A1234)
  display_name text,                  -- 선택: 치료자가 구분하려고 적는 이름/별칭
  device_auth_uid uuid unique,        -- 그 코드를 입력한 환자 기기의 익명 인증 uid (claim 전엔 null)
  data jsonb not null default '{}'::jsonb,  -- PEStorage.getAllData() 전체를 그대로 미러링
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (therapist_id, code)
);

comment on table public.patients is
  'Wayfellow 환자 1명 = 1행. data 컬럼은 환자 기기의 localStorage 전체를 그대로 올린 JSON 거울이며, 치료자 대시보드(therapist.html)가 이걸 읽어서 보여준다.';

alter table public.patients enable row level security;

-- ----- 치료자: 자기 환자 행만 전부(조회/생성/수정/삭제) -----
drop policy if exists "therapist can manage own patients" on public.patients;
create policy "therapist can manage own patients"
  on public.patients
  for all
  using (auth.uid() = therapist_id)
  with check (auth.uid() = therapist_id);

-- ----- 환자 기기(익명 인증, 이미 claim된 뒤): 자기 행만 조회/수정 -----
-- claim(아직 비어있는 행에 처음 연결하는 것) 자체는 이 정책이 아니라 아래
-- claim_patient_code() 함수로만 가능하다 - RLS로 "device_auth_uid is null이면 아무나
-- UPDATE 가능"을 허용하면, 코드를 몰라도 unclaimed 행을 아무거나 집어갈 수 있어서 위험함.
drop policy if exists "device can read own patient row" on public.patients;
create policy "device can read own patient row"
  on public.patients
  for select
  using (auth.uid() = device_auth_uid);

drop policy if exists "device can update own patient row" on public.patients;
create policy "device can update own patient row"
  on public.patients
  for update
  using (auth.uid() = device_auth_uid)
  with check (auth.uid() = device_auth_uid);

-- ----- 환자 기기가 코드로 자신을 연결(claim)하는 유일한 통로 -----
-- SECURITY DEFINER라 RLS를 우회해서 실행되지만, 함수 내부 로직 자체가
-- "code가 정확히 일치하고 + 아직 비어있는 행"만 골라서 호출자 자신의 uid로 연결하므로
-- 안전하다. 호출자는 반드시 (익명이라도) 인증된 상태여야 한다.
create or replace function public.claim_patient_code(p_code text)
returns public.patients
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.patients;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  update public.patients
  set device_auth_uid = v_uid, updated_at = now()
  where code = p_code and device_auth_uid is null
  returning * into v_row;

  if v_row.id is null then
    raise exception 'invalid or already-claimed code';
  end if;

  return v_row;
end;
$$;

revoke all on function public.claim_patient_code(text) from public;
grant execute on function public.claim_patient_code(text) to authenticated, anon;

-- ----- 기본 권한 (Supabase 표준 템플릿엔 보통 이미 있지만, 스크립트 단독 실행을 위해 명시) -----
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.patients to authenticated;
grant select, update on public.patients to anon;
