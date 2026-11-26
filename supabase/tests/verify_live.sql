-- Run in the Supabase SQL editor (or psql) AFTER `supabase db push`.
-- Every query must return ZERO rows (except the last, which must return 'ok').
-- These are the same guarantees the automated tests check on PGlite.

-- 1. Tables without Row Level Security
select 'RLS OFF' as problem, tablename from pg_tables where schemaname = 'public' and not rowsecurity;

-- 2. Anything anon can touch
select 'ANON TABLE GRANT' as problem, table_name, privilege_type
from information_schema.role_table_grants where grantee = 'anon' and table_schema in ('public','app');
select 'ANON FUNCTION' as problem, n.nspname || '.' || p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','app') and has_function_privilege('anon', p.oid, 'execute');

-- 3. Unexpected table-level write grants for logged-in users
select 'UNEXPECTED WRITE GRANT' as problem, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'authenticated' and table_schema = 'public' and privilege_type not in ('SELECT')
  and not (privilege_type = 'DELETE' and table_name in ('budgets','daily_menu','item_ingredients','slot_overrides','waste_entries'));

-- 4. Unexpected API functions
select 'UNEXPECTED API FUNCTION' as problem, p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
  and p.proname !~ '^(customer_|staff_|owner_|redeem_invite$|register_device$|unregister_device$|my_balance$|mark_notifications_read$|set_notification_prefs$|chat_mark_read$|forget_other_devices$|record_sign_in$|kitchen_join_info$|set_my_language$|loyalty_progress$)';

-- 4b. The push sender API must be service-role only
select 'PUSH API EXPOSED' as problem, p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('push_claim','push_complete','media_expired','push_receipts_due','push_receipts_done','media_forget')
  and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));

-- 4c. Storage: our 5 buckets must exist and be PRIVATE, and our 3 access rules must be present
select 'BUCKET MISSING OR PUBLIC' as problem, b.wanted
from unnest(array['kitchen-media','delivery-proofs','payment-proofs','voice-notes','receipts']) as b(wanted)
where not exists (select 1 from storage.buckets x where x.id = b.wanted and not x.public);
-- 4d. Each bucket must limit file SIZE and TYPE (set in the dashboard, Setup steps 13-14):
--     images <= 2 MB (jpeg/png/webp only), voice notes <= 1 MB (audio only). Nothing else accepted.
select 'BUCKET LIMIT MISSING OR TOO LOOSE' as problem, x.id, x.file_size_limit, x.allowed_mime_types
from storage.buckets x
where x.id in ('kitchen-media','delivery-proofs','payment-proofs','receipts','voice-notes')
  and (x.file_size_limit is null
       or x.file_size_limit > case when x.id = 'voice-notes' then 1048576 else 2097152 end
       or x.allowed_mime_types is null
       or not (x.allowed_mime_types <@ case when x.id = 'voice-notes'
                 then array['audio/mp4','audio/x-m4a','audio/m4a','audio/aac','audio/webm']
                 else array['image/jpeg','image/png','image/webp'] end));
select 'STORAGE POLICY MISSING' as problem, p.wanted
from unnest(array['ak_media_read','ak_media_insert','ak_media_delete']) as p(wanted)
where not exists (select 1 from pg_policies x where x.schemaname = 'storage' and x.tablename = 'objects' and x.policyname = p.wanted);

-- 5. SECURITY DEFINER functions without a pinned search_path
select 'DEFINER WITHOUT search_path' as problem, n.nspname || '.' || p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','app') and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');

-- 6. Future objects must be private: creates and drops a probe table + function.
begin;
create table public.zz_probe (id int);
create function public.zz_probe_fn() returns int language sql as $$ select 1 $$;
select case
  when has_table_privilege('anon', 'public.zz_probe', 'select')
    or has_table_privilege('authenticated', 'public.zz_probe', 'select')
    or has_function_privilege('anon', 'public.zz_probe_fn()', 'execute')
    or has_function_privilege('authenticated', 'public.zz_probe_fn()', 'execute')
  then 'PROBLEM: new objects are exposed by default' else 'ok' end as future_objects;
rollback;
