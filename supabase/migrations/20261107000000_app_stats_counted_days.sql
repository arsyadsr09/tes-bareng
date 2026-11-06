-- Google counts a closed-test day only while every slot is filled at once, so the app's clock is the days of its
-- slot-th most senior active tester (0 while seats are open). The app list and Tugas saya show this instead of a
-- per-tester "eligible" count. Ready to apply stays eligible_count >= tester_slots, which gives the same answer.
-- Same definition as 20261102000000_badges_digest_flag.sql, plus counted_days at the end.
create or replace view public.app_stats with (security_invoker = true) as
select
  a.id as app_id,
  coalesce(t.active_tester_count, 0)::int as active_tester_count,
  coalesce(t.eligible_count, 0)::int as eligible_count,
  coalesce(t.feedback_sent_count, 0)::int as feedback_sent_count,
  coalesce(t.feedback_verified_count, 0)::int as feedback_verified_count,
  coalesce(t.replied_count, 0)::int as replied_count,
  coalesce(b.build_count, 0)::int as build_count,
  b.last_build_at,
  coalesce(ps.testing_count, 0)::int as creator_testing_count,
  coalesce(ps.feedback_sent_count, 0)::int as creator_feedback_sent_count,
  coalesce(ps.feedback_verified_count, 0)::int as creator_feedback_verified_count,
  coalesce(ps.badge_tier, 'none') as creator_badge_tier,
  coalesce(c.counted_days, 0)::int as counted_days
from public.apps a
left join lateral (
  select
    count(*) as active_tester_count,
    count(*) filter (where now() - e.opted_in_at >= interval '14 days') as eligible_count,
    count(*) filter (where e.feedback_sent) as feedback_sent_count,
    count(*) filter (where e.feedback_verified) as feedback_verified_count,
    count(*) filter (where e.replied) as replied_count
  from public.testers e
  where e.app_id = a.id and e.status = 'active'
) t on true
left join lateral (
  select greatest(0, floor(extract(epoch from now() - e.opted_in_at) / 86400))::int as counted_days
  from public.testers e
  where e.app_id = a.id and e.status = 'active'
  order by e.opted_in_at asc
  offset a.tester_slots - 1
  limit 1
) c on true
left join lateral (
  select count(*) as build_count, max(x.uploaded_at) as last_build_at
  from public.builds x
  where x.app_id = a.id
) b on true
left join public.profile_stats ps on ps.profile_id = a.creator_id;
