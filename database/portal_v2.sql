-- Portal v2 (no Google Sheets, no personal questionnaire).
-- This is a NEW schema: does not migrate or expose old Sheet passwords.
-- Setup in Supabase SQL editor after reviewing docs/PORTAL_V2_SETUP.md.
create extension if not exists pgcrypto;

create table if not exists public.portal_v2_accounts (
  employee_code text primary key check (employee_code ~ '^[0-9]{4,12}$'),
  pin_hash text not null,
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  branch_code text not null check (char_length(trim(branch_code)) between 1 and 50),
  access_role text not null default 'employee' check (access_role in ('employee','manager')),
  salary_role text not null default 'Staff' check (salary_role in ('BM','SL','Staff')),
  level integer not null default 1 check (level between 1 and 4),
  monthly_norm numeric(7,2) not null default 176 check (monthly_norm > 0 and monthly_norm <= 744),
  tax_relief_mnt numeric(12,2) not null default 12000 check (tax_relief_mnt >= 0),
  advance_mnt numeric(12,2) not null default 0 check (advance_mnt >= 0),
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.portal_v2_shifts (
  employee_code text not null references public.portal_v2_accounts(employee_code) on delete restrict,
  work_date date not null,
  shift_kind text not null check (shift_kind in ('morning','day','night')),
  approved boolean not null default false,
  approved_by text references public.portal_v2_accounts(employee_code),
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (employee_code, work_date),
  constraint approved_fields_match check (
    (approved = false and approved_by is null and approved_at is null)
    or (approved = true and approved_by is not null and approved_at is not null)
  )
);

create table if not exists public.portal_v2_cash (
  id bigint generated always as identity primary key,
  employee_code text not null references public.portal_v2_accounts(employee_code) on delete restrict,
  business_date date not null,
  amount_mnt numeric(12,2) not null check (amount_mnt <> 0),
  explanation text not null check (char_length(trim(explanation)) between 3 and 1000),
  entered_by text not null references public.portal_v2_accounts(employee_code),
  created_at timestamptz not null default now()
);

create table if not exists public.portal_v2_sessions (
  token_hash text primary key,
  employee_code text not null references public.portal_v2_accounts(employee_code) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists portal_v2_shifts_month on public.portal_v2_shifts(work_date,employee_code);
create index if not exists portal_v2_cash_employee_date on public.portal_v2_cash(employee_code,business_date desc);
create index if not exists portal_v2_sessions_expiry on public.portal_v2_sessions(expires_at);

alter table public.portal_v2_accounts enable row level security;
alter table public.portal_v2_shifts enable row level security;
alter table public.portal_v2_cash enable row level security;
alter table public.portal_v2_sessions enable row level security;

-- NEVER expose these tables to a browser. Server API alone reads using
-- service-role credentials, held only in private deployment env vars.
revoke all on public.portal_v2_accounts,public.portal_v2_shifts,
  public.portal_v2_cash,public.portal_v2_sessions from anon, authenticated;
revoke all on sequence public.portal_v2_cash_id_seq from anon, authenticated;

-- Only service_role may call these functions. They never return PIN hashes.
-- SECURITY DEFINER is necessary for atomic rate-limit counting with FOR UPDATE.
create or replace function public.portal_v2_authenticate(
  p_code text, p_pin text
) returns text language plpgsql security definer set search_path = ''
as $$
declare account_row public.portal_v2_accounts%rowtype;
begin
  select * into account_row
  from public.portal_v2_accounts
  where employee_code = p_code and is_active = true
  for update;
  if not found then
    return null;
  end if;
  if account_row.locked_until is not null and account_row.locked_until > now() then
    return null;
  end if;
  if p_pin !~ '^[0-9]{4}$'
     or account_row.pin_hash <> extensions.crypt(p_pin, account_row.pin_hash) then
    update public.portal_v2_accounts
      set failed_attempts = case when account_row.failed_attempts >= 4 then 0
                                 else account_row.failed_attempts + 1 end,
          locked_until = case when account_row.failed_attempts >= 4
                              then now() + interval '15 minutes' else null end
    where employee_code = p_code;
    return null;
  end if;
  update public.portal_v2_accounts
    set failed_attempts = 0, locked_until = null
    where employee_code = p_code;
  return p_code;
end;
$$;

create or replace function public.portal_v2_create_employee(
  p_code text, p_pin text, p_name text, p_branch text,
  p_salary_role text, p_level integer
) returns text language plpgsql security definer set search_path = ''
as $$
begin
  if p_code !~ '^[0-9]{4,12}$' or p_pin !~ '^[0-9]{4}$'
     or char_length(trim(p_name)) not between 1 and 120
     or char_length(trim(p_branch)) not between 1 and 50
     or p_salary_role not in ('BM','SL','Staff')
     or p_level not between 1 and 4 then
    raise exception 'Invalid employee input';
  end if;
  insert into public.portal_v2_accounts (
    employee_code,pin_hash,display_name,branch_code,access_role,salary_role,level
  ) values (
    p_code, extensions.crypt(p_pin,extensions.gen_salt('bf',12)),
    trim(p_name),trim(p_branch),'employee',p_salary_role,p_level
  );
  return p_code;
end;
$$;

create or replace function public.portal_v2_reset_pin(
  p_code text, p_pin text
) returns text language plpgsql security definer set search_path = ''
as $$
begin
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN must be four digits'; end if;
  update public.portal_v2_accounts
    set pin_hash = extensions.crypt(p_pin,extensions.gen_salt('bf',12)),
        failed_attempts=0, locked_until=null
  where employee_code=p_code and access_role='employee';
  if not found then raise exception 'Employee not found'; end if;
  delete from public.portal_v2_sessions where employee_code=p_code;
  return p_code;
end;
$$;

revoke all on function public.portal_v2_authenticate(text,text) from public, anon, authenticated;
revoke all on function public.portal_v2_create_employee(text,text,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.portal_v2_reset_pin(text,text) from public, anon, authenticated;
grant execute on function public.portal_v2_authenticate(text,text) to service_role;
grant execute on function public.portal_v2_create_employee(text,text,text,text,text,integer) to service_role;
grant execute on function public.portal_v2_reset_pin(text,text) to service_role;

-- Initial manager 115091 is created by an authorized database administrator.
-- Do not commit an actual PIN to GitHub:
-- insert into public.portal_v2_accounts
-- (employee_code,pin_hash,display_name,branch_code,access_role,salary_role,level)
-- values ('115091', extensions.crypt('<private-4-digit-PIN>',extensions.gen_salt('bf',12)),
--         'Салбарын менежер', '<your-branch-code>', 'manager', 'BM', 1);
