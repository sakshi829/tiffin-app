-- =============================================================================
-- 1000 SCHEDULED JOBS (pg_cron, times in UTC; IST = UTC + 5:30)
-- Skipped automatically where pg_cron is unavailable (e.g. local test DB).
-- Later phases add: reminders, push sending, late fees, media retention.
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- 21:00 IST daily: create orders for today .. today + horizon (idempotent)
    perform cron.schedule('generate-orders-nightly', '30 15 * * *', 'select app.generate_orders_all()');
    -- 05:00 IST daily: second pass (catches late subscription changes)
    perform cron.schedule('generate-orders-morning', '30 23 * * *', 'select app.generate_orders_all()');
    -- hourly: drop old rate-limit windows
    perform cron.schedule('cleanup-rate-limits', '7 * * * *',
      $job$delete from app.rate_limits where window_start < now() - interval '2 days'$job$);
  end if;
end $$;
