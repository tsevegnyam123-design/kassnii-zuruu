-- Portal v2: independent tables; leaves legacy sheets and tables untouched.
-- Run in a dedicated Supabase project after reviewing with your administrator.
-- All application clients use only the publishable/anon key plus Supabase Auth.
-- Only database administrators may provision staff and managers.

create table if not exists public.portal_v2_managers (
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  branch_code text not null,
  primary key (auth_user_id, branch_code)
);

create table if not exists public.portal_v2_staff (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  employee_code text not null unique,
  surname text not null default '',
  given_name text not null,
  branch_code text not null,
  job_role text not null check (job_role in ('BM', 'SL', 'Staff')),
  job_title text not null default '',
  level integer not null check (level between 1 and 4),
  hired_at date,
  employment_status text not null default 'Идэвхтэй',
  work_type text not null default '',
  monthly_norm numeric(7,2) not null default 176 check (monthly_norm > 0 and monthly_norm <= 744),
  tax_relief_mnt numeric(12,2) not null default 12000 check (tax_relief_mnt >= 0),
  advance_mnt numeric(12,2) not null default 0 check (advance_mnt >= 0)
);

create table if not exists public.portal_v2_details (
  auth_user_id uuid primary key references public.portal_v2_staff(auth_user_id) on delete cascade,
  phone text not null default '',
  email text not null default '',
  emergency_contact_name text not null default '',
  emergency_contact_phone text not null default '',
  address_text text not null default '',
  google_maps_url text,
  updated_at timestamptz not null default now(),
  constraint google_maps_link_only check (
    google_maps_url is null or
    google_maps_url ~* '^https://(www\.google\.com/maps(/|\?|$)|maps\.google\.com(/|\?|$)|maps\.app\.goo\.gl/)'
  )
);

create table if not exists public.portal_v2_shifts (
  employee_user_id uuid not null references public.portal_v2_staff(auth_user_id) on delete cascade,
  work_date date not null,
  shift_kind text not null check (shift_kind in ('morning','day','night')),
  approval_status text not null default 'draft' check (approval_status in ('draft','approved')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (employee_user_id, work_date),
  constraint approval_consistency check (
    (approval_status = 'draft' and approved_by is null and approved_at is null)
    or (approval_status = 'approved' and approved_by is not null and approved_at is not null)
  )
);

create table if not exists public.portal_v2_cash (
  id bigint generated always as identity primary key,
  employee_user_id uuid not null references public.portal_v2_staff(auth_user_id) on delete cascade,
  amount_mnt numeric(12,2) not null check (amount_mnt <> 0),
  explanation text not null check (char_length(trim(explanation)) between 3 and 1000),
  entered_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists portal_v2_staff_branch_idx on public.portal_v2_staff(branch_code);
create index if not exists portal_v2_shifts_date_idx on public.portal_v2_shifts(work_date);
create index if not exists portal_v2_cash_employee_date_idx on public.portal_v2_cash(employee_user_id, created_at desc);

alter table public.portal_v2_managers enable row level security;
alter table public.portal_v2_staff enable row level security;
alter table public.portal_v2_details enable row level security;
alter table public.portal_v2_shifts enable row level security;
alter table public.portal_v2_cash enable row level security;

-- Apply policies exactly once in a fresh project, or drop the named policies first.
create policy "manager self membership"
on public.portal_v2_managers for select to authenticated
using (auth_user_id = (select auth.uid()));

create policy "staff self or own branch manager"
on public.portal_v2_staff for select to authenticated
using (
  auth_user_id = (select auth.uid())
  or exists (
    select 1 from public.portal_v2_managers m
    where m.auth_user_id = (select auth.uid())
      and m.branch_code = portal_v2_staff.branch_code
  )
);

create policy "private details read self"
on public.portal_v2_details for select to authenticated
using (auth_user_id = (select auth.uid()));
create policy "private details insert self"
on public.portal_v2_details for insert to authenticated
with check (auth_user_id = (select auth.uid()));
create policy "private details update self"
on public.portal_v2_details for update to authenticated
using (auth_user_id = (select auth.uid()))
with check (auth_user_id = (select auth.uid()));

-- Employee sees only own shifts. Managers see shifts in their assigned branch.
create policy "shifts read self or managed branch"
on public.portal_v2_shifts for select to authenticated
using (
  employee_user_id = (select auth.uid())
  or exists (
    select 1 from public.portal_v2_staff s
    join public.portal_v2_managers m on m.branch_code = s.branch_code
    where s.auth_user_id = portal_v2_shifts.employee_user_id
      and m.auth_user_id = (select auth.uid())
  )
);

create policy "manager creates branch shifts"
on public.portal_v2_shifts for insert to authenticated
with check (
  exists (
    select 1 from public.portal_v2_staff s
    join public.portal_v2_managers m on m.branch_code = s.branch_code
    where s.auth_user_id = employee_user_id
      and m.auth_user_id = (select auth.uid())
  )
  and (
    (approval_status = 'draft' and approved_by is null and approved_at is null)
    or (approval_status = 'approved' and approved_by = (select auth.uid()) and approved_at is not null)
  )
);

create policy "manager edits branch shifts"
on public.portal_v2_shifts for update to authenticated
using (
  exists (
    select 1 from public.portal_v2_staff s
    join public.portal_v2_managers m on m.branch_code = s.branch_code
    where s.auth_user_id = employee_user_id
      and m.auth_user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.portal_v2_staff s
    join public.portal_v2_managers m on m.branch_code = s.branch_code
    where s.auth_user_id = employee_user_id
      and m.auth_user_id = (select auth.uid())
  )
  and (
    (approval_status = 'draft' and approved_by is null and approved_at is null)
    or (approval_status = 'approved' and approved_by = (select auth.uid()) and approved_at is not null)
  )
);

create policy "manager deletes branch shifts"
on public.portal_v2_shifts for delete to authenticated
using (
  exists (
    select 1 from public.portal_v2_staff s
    join public.portal_v2_managers m on m.branch_code = s.branch_code
    where s.auth_user_id = employee_user_id
      and m.auth_user_id = (select auth.uid())
  )
);

-- Cash entries are append-only. Corrections use a new negative entry and explanation.
create policy "cash read self or own branch manager"
on public.portal_v2_cash for select to authenticated
using (
  employee_user_id = (select auth.uid())
  or exists (
    select 1 from public.portal_v2_staff s
    join public.portal_v2_managers m on m.branch_code = s.branch_code
    where s.auth_user_id = portal_v2_cash.employee_user_id
      and m.auth_user_id = (select auth.uid())
  )
);

create policy "manager adds cash entry to own branch"
on public.portal_v2_cash for insert to authenticated
with check (
  entered_by = (select auth.uid())
  and exists (
    select 1 from public.portal_v2_staff s
    join public.portal_v2_managers m on m.branch_code = s.branch_code
    where s.auth_user_id = employee_user_id
      and m.auth_user_id = (select auth.uid())
  )
);

revoke all on public.portal_v2_managers, public.portal_v2_staff,
  public.portal_v2_details, public.portal_v2_shifts, public.portal_v2_cash from anon;
grant select on public.portal_v2_managers, public.portal_v2_staff,
  public.portal_v2_details, public.portal_v2_shifts, public.portal_v2_cash to authenticated;
grant insert, update on public.portal_v2_details to authenticated;
grant insert, update, delete on public.portal_v2_shifts to authenticated;
grant insert on public.portal_v2_cash to authenticated;
grant usage, select on sequence public.portal_v2_cash_id_seq to authenticated;

-- Manager provisioning example (database admin ONLY, never run in the browser):
-- Find the verified Auth UUID for employee code 115091, then insert a matching
-- (auth_user_id, branch_code) row into portal_v2_managers.
-- Do not authorize manager access by comparing an employee code in JavaScript.
