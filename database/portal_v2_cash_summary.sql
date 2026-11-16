-- Manager-only cash discrepancy net summaries.
-- Positive amounts add a discrepancy; negative entries reduce/reverse it.
-- The balance reflects REGISTERED ledger entries, not a legal/payroll debt.
-- SECURITY INVOKER + service_role-only execution: browser clients cannot call it.
create or replace function public.portal_v2_cash_summary(
  p_manager_code text,
  p_from date,
  p_to date
)
returns table (
  employee_code text,
  display_name text,
  opening_mnt numeric,
  period_mnt numeric,
  closing_mnt numeric,
  entry_count bigint,
  latest_entry_date date
)
language sql
stable
security invoker
set search_path = ''
as $sql$
  select
    employee.employee_code,
    employee.display_name,
    coalesce(sum(c.amount_mnt) filter (where c.business_date < p_from), 0)::numeric as opening_mnt,
    coalesce(sum(c.amount_mnt) filter (
      where c.business_date >= p_from and c.business_date <= p_to
    ), 0)::numeric as period_mnt,
    coalesce(sum(c.amount_mnt), 0)::numeric as closing_mnt,
    count(c.id)::bigint as entry_count,
    max(c.business_date) as latest_entry_date
  from public.portal_v2_accounts as manager
  join public.portal_v2_accounts as employee
    on employee.branch_code = manager.branch_code
   and employee.access_role = 'employee'
  left join public.portal_v2_cash as c
    on c.employee_code = employee.employee_code
   and c.business_date <= p_to
  where manager.employee_code = p_manager_code
    and manager.access_role = 'manager'
    and manager.is_active = true
    and p_from <= p_to
  group by employee.employee_code, employee.display_name
  order by coalesce(sum(c.amount_mnt), 0) desc, employee.display_name, employee.employee_code;
$sql$;

revoke all on function public.portal_v2_cash_summary(text,date,date)
  from public, anon, authenticated;
grant execute on function public.portal_v2_cash_summary(text,date,date)
  to service_role;
