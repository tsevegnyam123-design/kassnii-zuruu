-- Run in the existing Supabase project's SQL Editor after reviewing the current schema.
-- These fields match the portal's 16-field form. Existing rows are preserved.
alter table public.employee_profiles
  add column if not exists branch_code text,
  add column if not exists start_date date,
  add column if not exists status text,
  add column if not exists employment_type text,
  add column if not exists phone text,
  add column if not exists contact_email text,
  add column if not exists emergency_contact text,
  add column if not exists emergency_phone text,
  add column if not exists address text,
  add column if not exists education text,
  add column if not exists training_status text,
  add column if not exists notes text;
-- surname, given_name, employee_code, job_title and branch_id already exist.
-- auth_user_id must reference the existing Supabase Auth user; the API supplies it from the verified JWT.
-- The portal backend enforces field-level permissions; never expose the service role key to the browser.
-- Review any NOT NULL / foreign-key constraints on existing columns before creating a profile.
