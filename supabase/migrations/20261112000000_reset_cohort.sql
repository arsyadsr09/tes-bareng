-- Admin RPC: reset an active cohort back to forming so it can be restarted.
-- Deletes all assignments and clears ring positions; members stay.
-- Contract: docs/contract.md (RPC `reset_cohort`).

create function public.reset_cohort(p_cohort_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  perform private.require_admin();
  select status into v_status from public.cohorts where id = p_cohort_id for update;
  if not found then
    perform private.fail('not-found', 'Cohort tidak ditemukan.');
  end if;
  if v_status <> 'active' then
    perform private.fail('failed-precondition', 'Hanya cohort yang sedang berjalan yang bisa direset.');
  end if;

  delete from public.assignments where cohort_id = p_cohort_id;
  update public.cohort_members set ring_position = null, assigned_at = null where cohort_id = p_cohort_id;
  update public.cohorts set status = 'forming', day0_at = null where id = p_cohort_id;
end;
$$;

revoke all on function public.reset_cohort(uuid) from public;
grant execute on function public.reset_cohort(uuid) to anon, authenticated;
