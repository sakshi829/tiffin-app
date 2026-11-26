-- =============================================================================
-- 2500 OWNER ALERTS IN THE OWNER'S LANGUAGE (Phase 8c, owner app in Marathi/Hindi)
-- The owner app now saves its language like the other apps, so the alerts the
-- owner receives (payments to confirm, late skips, chats, join requests,
-- referrals, the daily count, regular expenses) get templates too.
-- Suggestions (owner_insights) come back in the owner's language too.
-- Also fixes 2300: a voice note's alert text is a fixed system sentence
-- ("Open Chats to listen."), so it is translated; typed chat text never is.
-- Tests: 28-alert-language.test.mjs.
-- =============================================================================

insert into app.alert_templates (seq, pattern, mr, hi) values
-- late skip (owner)
(100, '^(.+) skipped lunch late$', '\1 यांनी दुपारचे जेवण उशिरा वगळले', '\1 ने दोपहर का खाना देर से छोड़ा'),
(101, '^(.+) skipped dinner late$', '\1 यांनी रात्रीचे जेवण उशिरा वगळले', '\1 ने रात का खाना देर से छोड़ा'),
(102, '^(.+) will not take lunch on (.+) \(after the cutoff\)\.$', '\1 \2 रोजी दुपारचे जेवण घेणार नाहीत (अंतिम वेळेनंतर).', '\1 \2 को दोपहर का खाना नहीं लेंगे (अंतिम समय के बाद)।'),
(103, '^(.+) will not take dinner on (.+) \(after the cutoff\)\.$', '\1 \2 रोजी रात्रीचे जेवण घेणार नाहीत (अंतिम वेळेनंतर).', '\1 \2 को रात का खाना नहीं लेंगे (अंतिम समय के बाद)।'),
-- payment reported by a customer
(104, '^(.+) paid (₹[0-9,.]+)$', '\1 यांनी \2 भरले', '\1 ने \2 भरे'),
(105, '^UPI reference (.+)\. Check your bank app, then confirm in Money\.$', 'UPI संदर्भ \1. तुमचे बँक ॲप तपासा, मग पैसे मध्ये पक्के करा.', 'UPI संदर्भ \1। अपना बैंक ऐप जाँचें, फिर पैसे में पक्का करें।'),
-- chats (the customer's own words are never translated; only these fixed lines)
(106, '^Message from (.+)$', '\1 यांचा संदेश', '\1 का संदेश'),
(107, '^Voice note from (.+)$', '\1 यांची व्हॉइस नोट', '\1 का वॉइस नोट'),
(108, '^Open Chats to listen\.$', 'ऐकण्यासाठी चॅट उघडा.', 'सुनने के लिए चैट खोलें।'),
-- join requests and referrals
(109, '^New request to join$', 'सामील होण्याची नवीन विनंती', 'जुड़ने का नया अनुरोध'),
(110, '^(.+) asked to join\. Open More › Join requests to approve\.$', '\1 यांनी सामील होण्याची विनंती केली. मंजूर करण्यासाठी अधिक › सामील होण्याच्या विनंत्या उघडा.', '\1 ने जुड़ने का अनुरोध किया। मंज़ूर करने के लिए और › जुड़ने के अनुरोध खोलें।'),
(111, '^(.+) referred (.+)$', '\1 यांनी \2 यांची शिफारस केली', '\1 ने \2 का सुझाव दिया'),
(112, '^(.+) \(([^)]+)\) may want tiffins\. Approve in More › Referrals\.$', '\1 (\2) यांना टिफिन हवा असू शकतो. अधिक › शिफारसी मध्ये मंजूर करा.', '\1 (\2) को टिफिन चाहिए हो सकता है। और › सुझाए गए लोग में मंज़ूर करें।'),
-- daily count after the cutoff
(113, '^Lunch today: final count$', 'आजचे दुपारचे जेवण: अंतिम संख्या', 'आज का दोपहर का खाना: अंतिम गिनती'),
(114, '^Dinner today: final count$', 'आजचे रात्रीचे जेवण: अंतिम संख्या', 'आज का रात का खाना: अंतिम गिनती'),
(115, '^([0-9]+) tiffins \(([0-9]+) veg, ([0-9]+) non-veg\)\. Extras: (.+)\.$', '\1 टिफिन (\2 शाकाहारी, \3 मांसाहारी). जास्तीचे: \4.', '\1 टिफिन (\2 शाकाहारी, \3 मांसाहारी)। अतिरिक्त: \4।'),
(116, '^([0-9]+) tiffins \(([0-9]+) veg, ([0-9]+) non-veg\)\.$', '\1 टिफिन (\2 शाकाहारी, \3 मांसाहारी).', '\1 टिफिन (\2 शाकाहारी, \3 मांसाहारी)।'),
-- regular expense due
(117, '^(.+) is due$', '\1 देय आहे', '\1 देय है'),
(118, '^(₹[0-9,.]+) · tap Money › Expenses to record it\.$', '\1 · नोंदवण्यासाठी पैसे › खर्च वर टॅप करा.', '\1 · दर्ज करने के लिए पैसे › खर्च पर टैप करें।');

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
          left(case when v_lang = 'en' or p_kind = 'announcement' then p_title else app.localize_alert(p_title, v_lang) end, 80),
          left(case when v_lang = 'en' or v_keep_body then p_body else app.localize_alert(p_body, v_lang) end, 300),
          coalesce(p_data, '{}'::jsonb), p_dedupe,
          case when coalesce(v_muted, false) then 'skipped' else 'pending' end)
  on conflict (dedupe_key) do nothing;
end $$;

-- ---------------------------------------------------------------- suggestions (Money › Suggestions)
insert into app.alert_templates (seq, pattern, mr, hi) values
(120, '^(.+) spending up (-?[0-9]+)%$', '\1 वरचा खर्च \2% वाढला', '\1 पर खर्च \2% बढ़ा'),
(121, '^(₹[0-9,.]+) so far this month vs (₹[0-9,.]+) in the same days last month, while meals changed n/a\. Check prices or quantities\.$',
      'या महिन्यात आतापर्यंत \1, तर मागच्या महिन्यात याच दिवसांत \2. किमती किंवा प्रमाण तपासा.', 'इस महीने अब तक \1, जबकि पिछले महीने इन्हीं दिनों में \2। कीमतें या मात्रा जाँचें।'),
(122, '^(₹[0-9,.]+) so far this month vs (₹[0-9,.]+) in the same days last month, while meals changed (-?[0-9]+)%\. Check prices or quantities\.$',
      'या महिन्यात आतापर्यंत \1, तर मागच्या महिन्यात याच दिवसांत \2; जेवणे \3% बदलली. किमती किंवा प्रमाण तपासा.', 'इस महीने अब तक \1, जबकि पिछले महीने इन्हीं दिनों में \2; खाने \3% बदले। कीमतें या मात्रा जाँचें।'),
(123, '^Cost per meal is rising$', 'एका जेवणाचा खर्च वाढत आहे', 'एक खाने का खर्च बढ़ रहा है'),
(124, '^(₹[0-9,.]+) per meal this month vs (₹[0-9,.]+) last month\.$', 'या महिन्यात एका जेवणाला \1, मागच्या महिन्यात \2.', 'इस महीने एक खाने पर \1, पिछले महीने \2।'),
(125, '^([A-Z][a-z]+day) lunch: ([0-9]+)% skipped$', '\1 दुपारचे जेवण: \2% वगळले', '\1 दोपहर का खाना: \2% छोड़ा'),
(126, '^([A-Z][a-z]+day) dinner: ([0-9]+)% skipped$', '\1 रात्रीचे जेवण: \2% वगळले', '\1 रात का खाना: \2% छोड़ा'),
(127, '^About 1 fewer tiffin is needed on a typical ([A-Z][a-z]+day)\. Consider cooking a little less\.$',
      'साधारण \1 ला सुमारे 1 टिफिन कमी लागतो. थोडे कमी बनवण्याचा विचार करा.', 'आम तौर पर \1 को लगभग 1 टिफिन कम चाहिए। थोड़ा कम बनाने पर विचार करें।'),
(128, '^About ([0-9]+) fewer tiffins are needed on a typical ([A-Z][a-z]+day)\. Consider cooking a little less\.$',
      'साधारण \2 ला सुमारे \1 टिफिन कमी लागतात. थोडे कमी बनवण्याचा विचार करा.', 'आम तौर पर \2 को लगभग \1 टिफिन कम चाहिए। थोड़ा कम बनाने पर विचार करें।'),
(129, '^Extra food: ([0-9]+)% of meals$', 'जास्तीचे अन्न: \1% जेवण', 'ज़्यादा खाना: \1% खाने'),
(130, '^([0-9]+) tiffins were left over in the last 30 days\. Cooking slightly less saves money\.$',
      'मागच्या 30 दिवसांत \1 टिफिन उरले. थोडे कमी बनवल्यास पैसे वाचतात.', 'पिछले 30 दिनों में \1 टिफिन बचे। थोड़ा कम बनाने से पैसे बचते हैं।'),
(131, '^1 customer with no payment for 30\+ days$', '30+ दिवस पेमेंट न केलेला 1 ग्राहक', '30+ दिन से भुगतान न करने वाला 1 ग्राहक'),
(132, '^([0-9]+) customers with no payment for 30\+ days$', '30+ दिवस पेमेंट न केलेले \1 ग्राहक', '30+ दिन से भुगतान न करने वाले \1 ग्राहक'),
(133, '^(₹[0-9,.]+) due in total: (.+)\.$', 'एकूण \1 बाकी: \2.', 'कुल \1 बकाया: \2।'),
(134, '^(.+) is over budget$', '\1 बजेटपेक्षा जास्त', '\1 बजट से ज़्यादा'),
(135, '^(₹[0-9,.]+) spent of (₹[0-9,.]+) this month\.$', 'या महिन्यात \2 पैकी \1 खर्च.', 'इस महीने \2 में से \1 खर्च।'),
(136, '^1 box out for 5\+ days$', '1 डबा 5+ दिवस बाहेर', '1 डिब्बा 5+ दिन से बाहर'),
(137, '^([0-9]+) boxes out for 5\+ days$', '\1 डबे 5+ दिवस बाहेर', '\1 डिब्बे 5+ दिन से बाहर'),
(138, '^See More › Boxes not back\.$', 'अधिक › परत न आलेले डबे पाहा.', 'और › वापस न आए डिब्बे देखें।'),
(139, '^1 customer ordering much less$', '1 ग्राहक खूपच कमी जेवण घेत आहे', '1 ग्राहक बहुत कम खाना ले रहा है'),
(140, '^([0-9]+) customers ordering much less$', '\1 ग्राहक खूपच कमी जेवण घेत आहेत', '\1 ग्राहक बहुत कम खाना ले रहे हैं'),
(141, '^Fewer meals in the last 2 weeks: (.+)\. A friendly message may help\.$',
      'मागच्या 2 आठवड्यांत कमी जेवणे: \1. एक प्रेमळ संदेश उपयोगी ठरू शकतो.', 'पिछले 2 हफ़्तों में कम खाने: \1। एक दोस्ताना संदेश मदद कर सकता है।'),
(142, '^(-?[0-9]+)% of your investments recovered$', 'तुमच्या गुंतवणुकीपैकी \1% वसूल', 'आपके निवेश का \1% वसूल'),
(143, '^Investments so far: (₹-?[0-9,.]+)\. Profit since the first one: (₹-?[0-9,.]+)\.$',
      'आतापर्यंत गुंतवणूक: \1. पहिल्या गुंतवणुकीपासूनचा नफा: \2.', 'अब तक निवेश: \1। पहले निवेश से अब तक मुनाफ़ा: \2।');

-- A suggestion line in the chosen language; full day names too (only here, never in alerts).
create or replace function app.localize_insight(p_text text, p_lang text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  en_d text[] := array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  mr_d text[] := array['सोमवार','मंगळवार','बुधवार','गुरुवार','शुक्रवार','शनिवार','रविवार'];
  hi_d text[] := array['सोमवार','मंगलवार','बुधवार','गुरुवार','शुक्रवार','शनिवार','रविवार'];
  v text; i int;
begin
  if p_lang not in ('mr','hi') or p_text is null then return p_text; end if;
  v := app.localize_alert(p_text, p_lang);
  if v = p_text then return v; end if;   -- no template: leave the whole line English
  for i in 1..7 loop
    v := regexp_replace(v, '\m' || en_d[i] || '\M', case p_lang when 'mr' then mr_d[i] else hi_d[i] end, 'g');
  end loop;
  return v;
end $$;

-- The English suggestions move to the private schema; the public function returns them in the caller's language.
alter function public.owner_insights(uuid) set schema app;
alter function app.owner_insights(uuid) rename to owner_insights_en;
revoke execute on function app.owner_insights_en(uuid) from public, anon, authenticated;

create function public.owner_insights(p_kitchen uuid)
returns table (severity text, title text, detail text)
language plpgsql stable security definer set search_path = '' as $$
declare v_lang text;
begin
  select np.language into v_lang from public.notification_prefs np where np.user_id = auth.uid();
  v_lang := coalesce(v_lang, 'en');
  return query
    select i.severity, app.localize_insight(i.title, v_lang), app.localize_insight(i.detail, v_lang)
    from app.owner_insights_en(p_kitchen) i;   -- checks owner rights itself (NOT_ALLOWED)
end $$;
revoke execute on function public.owner_insights(uuid) from public, anon;
grant execute on function public.owner_insights(uuid) to authenticated;
revoke execute on function app.localize_insight(text, text) from public, anon, authenticated;
