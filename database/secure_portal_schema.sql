-- Supabase PostgreSQL starter schema. Run after review in a dedicated project.
create extension if not exists pgcrypto;
create table if not exists public.branches (
 id uuid primary key default gen_random_uuid(),
 branch_code text not null unique,
 branch_name text not null,
 latitude double precision,
 longitude double precision,
 created_at timestamptz not null default now(),
 constraint branch_lat check (latitude is null or latitude between -90 and 90),
 constraint branch_lon check (longitude is null or longitude between -180 and 180)
);
create table if not exists public.employee_profiles (
 id uuid primary key default gen_random_uuid(),
 auth_user_id uuid unique references auth.users(id) on delete restrict,
 employee_code text not null unique,
 surname text not null,
 given_name text not null,
 gender text,
 birth_date date,
 phone text,
 email text,
 address_text text,
 education text,
 profession text,
 marital_status text,
 emergency_contact_name text,
 emergency_contact_phone text,
 branch_id uuid references public.branches(id),
 job_title text,
 iban text,
 home_lat double precision,
 home_lon double precision,
 consent_version text not null,
 consent_at timestamptz not null,
 submitted_at timestamptz not null default now(),
 constraint home_lat_range check (home_lat between -90 and 90),
 constraint home_lon_range check (home_lon between -180 and 180),
 constraint home_location_pair check ((home_lat is null) = (home_lon is null))
);
create table if not exists public.portal_roles (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null check (role in ('employee','hr_admin'))
);
create table if not exists public.audit_events (
 id bigint generated always as identity primary key,
 actor_user_id uuid references auth.users(id),
 action text not null,
 subject_employee_code text,
 created_at timestamptz not null default now()
);
alter table public.branches enable row level security;
alter table public.employee_profiles enable row level security;
alter table public.portal_roles enable row level security;
alter table public.audit_events enable row level security;
-- Deliberately no browser access policies for sensitive tables.
-- All reads/writes require a backend that authenticates and authorizes each request.
-- Never expose the Supabase service role key to GitHub Pages.
