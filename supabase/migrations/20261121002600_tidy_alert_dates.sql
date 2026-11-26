-- =============================================================================
-- 2600 ALERT DATES LOOK LIKE THE APPS: "Tue, 1 Dec" (not "Tue 01 Dec"), "8 Dec" (not "08 Dec")
-- Alerts are still written and translated with the old shape ("Tue 01 Dec"), because the
-- Marathi/Hindi templates (2300, 2500) match it exactly. As the very last step before an
-- alert is saved, the date is tidied, in English, Marathi and Hindi alike.
-- The owner's announcements and people's chat messages are their own words: never touched.
-- Tests: 14-notifications, 24-launch, 28-alert-language.
-- =============================================================================

create or replace function app.tidy_dates(p_text text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  -- same day and month names as app.localize_dates (2300) and the apps
  v_days text := 'Sun|Mon|Tue|Wed|Thu|Fri|Sat|रवि|सोम|मंगळ|मंगल|बुध|गुरु|शुक्र|शनि';
  v_months text := 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec'
    || '|जाने|फेब्रु|मार्च|एप्रि|मे|जून|जुलै|ऑग|सप्टें|ऑक्टो|नोव्हें|डिसें'
    || '|जन|फ़र|अप्रै|मई|जुल|अग|सित|अक्टू|नव|दिस';
  v text := p_text;
begin
  if v is null then return v; end if;
  -- "Tue 01 Dec" -> "Tue, 1 Dec"
  v := regexp_replace(v, '(^|[[:space:](])(' || v_days || ') 0?([0-9]{1,2}) (' || v_months || ')(?![[:alpha:]])',
                      '\1\2, \3 \4', 'g');
  -- "01 Dec" / "08 Dec" -> "1 Dec" / "8 Dec"
  v := regexp_replace(v, '(^|[[:space:](,])0([1-9]) (' || v_months || ')(?![[:alpha:]])', '\1\2 \3', 'g');
  return v;
end $$;
revoke execute on function app.tidy_dates(text) from public, anon, authenticated;

-- Same as 2500, plus tidy_dates on every text the system writes.
create or replace function app.notify(p_kitchen uuid, p_user uuid, p_kind text, p_title text, p_body text, p_data jsonb, p_dedupe text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_muted boolean; v_lang text; v_keep_body boolean;
begin
  if p_user is null then return; end if;
  select p_kind = any (np.muted_kinds), np.language into v_muted, v_lang from public.notification_prefs np where np.user_id = p_user;
  v_lang := coalesce(v_lang, 'en');
  -- the sender's own words stay as written; the fixed voice-note line is ours, so it is translated
  v_keep_body := p_kind = 'announcement'
    or (p_kind = 'chat_message' and coalesce(p_body, '') !~ '^Open (Chats|Message the kitchen) to listen\.$');
  insert into public.notifications (kitchen_id, user_id, kind, title, body, data, dedupe_key, push_status)
  values (p_kitchen, p_user, p_kind,
          left(case when p_kind = 'announcement' then p_title
                    else app.tidy_dates(case when v_lang = 'en' then p_title else app.localize_alert(p_title, v_lang) end) end, 80),
          left(case when v_keep_body then p_body
                    else app.tidy_dates(case when v_lang = 'en' then p_body else app.localize_alert(p_body, v_lang) end) end, 300),
          coalesce(p_data, '{}'::jsonb), p_dedupe,
          case when coalesce(v_muted, false) then 'skipped' else 'pending' end)
  on conflict (dedupe_key) do nothing;
end $$;
