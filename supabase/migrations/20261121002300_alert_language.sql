-- =============================================================================
-- 2300 ALERTS IN THE PERSON'S LANGUAGE (Phase 8c, F44)
-- Each person's app language is saved with their alert settings. When an alert
-- is created for someone who chose Marathi or Hindi, its title and text are
-- translated by templates (exact sentence shapes, values kept), and day/month
-- names in dates are translated too. Anything without a template stays English
-- (owner alerts for now, announcements and chat messages are never touched).
-- Tests: 28-alert-language.test.mjs.
-- =============================================================================

alter table public.notification_prefs add column language text not null default 'en' check (language in ('en','mr','hi'));

create or replace function public.set_my_language(p_lang text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_lang not in ('en','mr','hi') then raise exception 'INVALID_SETTING' using errcode = 'P0001'; end if;
  insert into public.notification_prefs (user_id, language, updated_at) values (auth.uid(), p_lang, app.now())
  on conflict (user_id) do update set language = excluded.language, updated_at = excluded.updated_at;
end $$;
revoke execute on function public.set_my_language(text) from public, anon;
grant execute on function public.set_my_language(text) to authenticated;

-- Sentence shapes -> translations. \1, \2… are the values (names, amounts, dates).
create table app.alert_templates (
  seq      int primary key,
  pattern  text not null,
  mr       text not null,
  hi       text not null
);
revoke all on app.alert_templates from public, anon, authenticated;

insert into app.alert_templates (seq, pattern, mr, hi) values
-- meal delivered (customer)
(10, '^Lunch delivered$', 'दुपारचे जेवण पोहोचले', 'दोपहर का खाना पहुँच गया'),
(11, '^Dinner delivered$', 'रात्रीचे जेवण पोहोचले', 'रात का खाना पहुँच गया'),
(12, '^Your lunch has been delivered\. Enjoy your meal!$', 'तुमचे दुपारचे जेवण पोहोचले आहे. जेवणाचा आनंद घ्या!', 'आपका दोपहर का खाना पहुँच गया है। खाने का आनंद लें!'),
(13, '^Your dinner has been delivered\. Enjoy your meal!$', 'तुमचे रात्रीचे जेवण पोहोचले आहे. जेवणाचा आनंद घ्या!', 'आपका रात का खाना पहुँच गया है। खाने का आनंद लें!'),
-- late skip (delivery staff)
(20, '^Skip (.+)$', 'वगळा: \1', 'छोड़ें: \1'),
(21, '^(.+) will not take lunch today\. Do not deliver\.$', '\1 आज दुपारचे जेवण घेणार नाहीत. पोहोचवू नका.', '\1 आज दोपहर का खाना नहीं लेंगे। न पहुँचाएँ।'),
(22, '^(.+) will not take dinner today\. Do not deliver\.$', '\1 आज रात्रीचे जेवण घेणार नाहीत. पोहोचवू नका.', '\1 आज रात का खाना नहीं लेंगे। न पहुँचाएँ।'),
-- kitchen closed / reopened (customer)
(30, '^Kitchen closed ([A-Z][a-z]{2} [0-9]{2} [A-Z][a-z]{2})$', 'किचन बंद \1', 'किचन बंद \1'),
(31, '^No lunch or dinner on ([A-Z][a-z]{2} [0-9]{2} [A-Z][a-z]{2})( \(.*\))?\. You will not be charged\.$', '\1 रोजी दुपारचे किंवा रात्रीचे जेवण नाही\2. पैसे लागणार नाहीत.', '\1 को दोपहर या रात का खाना नहीं\2। पैसा नहीं लगेगा।'),
(32, '^No lunch on ([A-Z][a-z]{2} [0-9]{2} [A-Z][a-z]{2})( \(.*\))?\. You will not be charged\.$', '\1 रोजी दुपारचे जेवण नाही\2. पैसे लागणार नाहीत.', '\1 को दोपहर का खाना नहीं\2। पैसा नहीं लगेगा।'),
(33, '^No dinner on ([A-Z][a-z]{2} [0-9]{2} [A-Z][a-z]{2})( \(.*\))?\. You will not be charged\.$', '\1 रोजी रात्रीचे जेवण नाही\2. पैसे लागणार नाहीत.', '\1 को रात का खाना नहीं\2। पैसा नहीं लगेगा।'),
(34, '^Kitchen open ([A-Z][a-z]{2} [0-9]{2} [A-Z][a-z]{2})$', 'किचन सुरू \1', 'किचन खुला \1'),
(35, '^Good news: your lunch on ([A-Z][a-z]{2} [0-9]{2} [A-Z][a-z]{2}) is back on\.$', 'चांगली बातमी: \1 चे तुमचे दुपारचे जेवण पुन्हा सुरू.', 'अच्छी ख़बर: \1 का आपका दोपहर का खाना फिर से है।'),
(36, '^Good news: your dinner on ([A-Z][a-z]{2} [0-9]{2} [A-Z][a-z]{2}) is back on\.$', 'चांगली बातमी: \1 चे तुमचे रात्रीचे जेवण पुन्हा सुरू.', 'अच्छी ख़बर: \1 का आपका रात का खाना फिर से है।'),
-- route assigned / customer moved (delivery staff)
(40, '^Lunch route ready$', 'दुपारचा मार्ग तयार', 'दोपहर का रूट तैयार'),
(41, '^Dinner route ready$', 'रात्रीचा मार्ग तयार', 'रात का रूट तैयार'),
(42, '^Deliveries for lunch on ([A-Z][a-z]{2} [0-9]{2} [A-Z][a-z]{2}) are assigned to you\.$', '\1 च्या दुपारच्या डिलिव्हरी तुम्हाला दिल्या आहेत.', '\1 की दोपहर की डिलीवरी आपको दी गई हैं।'),
(43, '^Deliveries for dinner on ([A-Z][a-z]{2} [0-9]{2} [A-Z][a-z]{2}) are assigned to you\.$', '\1 च्या रात्रीच्या डिलिव्हरी तुम्हाला दिल्या आहेत.', '\1 की रात की डिलीवरी आपको दी गई हैं।'),
(44, '^(.+) moved$', '\1 यांचे ठिकाण बदलले', '\1 की जगह बदली'),
(45, '^(.+) is now at: (.+)\.$', '\1 आता इथे आहेत: \2.', '\1 अब यहाँ हैं: \2।'),
-- payments and bills (customer)
(50, '^Payment received$', 'पेमेंट मिळाले', 'भुगतान मिला'),
(51, '^(₹[0-9,.]+) received\. Thank you!$', '\1 मिळाले. धन्यवाद!', '\1 मिला। धन्यवाद!'),
(52, '^Payment not found$', 'पेमेंट सापडले नाही', 'भुगतान नहीं मिला'),
(53, '^(₹[0-9,.]+) \(UTR (.*)\) could not be matched: (.*)$', '\1 (UTR \2) जुळले नाही: \3', '\1 (UTR \2) मेल नहीं खाया: \3'),
(54, '^Your bill is ready$', 'तुमचे बिल तयार आहे', 'आपका बिल तैयार है'),
(55, '^(₹[0-9,.]+) due by ([0-9]{2} [A-Z][a-z]{2}) \(bill (\S+)\)\.$', '\2 पर्यंत \1 भरायचे (बिल \3).', '\2 तक \1 भरना है (बिल \3)।'),
(56, '^Nothing due \(bill (\S+)\)\.$', 'काहीही भरायचे नाही (बिल \1).', 'कुछ भरना नहीं है (बिल \1)।'),
(57, '^Payment due ([0-9]{2} [A-Z][a-z]{2})$', 'पैसे भरण्याची तारीख \1', 'भुगतान की तारीख \1'),
(58, '^(₹[0-9,.]+) is due by ([0-9]{2} [A-Z][a-z]{2}) \(bill (\S+)\)\. A late fee applies after that date\.$', '\2 पर्यंत \1 भरायचे आहेत (बिल \3). त्यानंतर विलंब शुल्क लागेल.', '\2 तक \1 भरना है (बिल \3)। उसके बाद विलंब शुल्क लगेगा।'),
(59, '^(₹[0-9,.]+) is due by ([0-9]{2} [A-Z][a-z]{2}) \(bill (\S+)\)\.$', '\2 पर्यंत \1 भरायचे आहेत (बिल \3).', '\2 तक \1 भरना है (बिल \3)।'),
(60, '^Late fee added$', 'विलंब शुल्क लावले', 'विलंब शुल्क जोड़ा गया'),
(61, '^(₹[0-9,.]+) late fee added: bill (\S+) was due ([0-9]{2} [A-Z][a-z]{2})\.$', '\1 विलंब शुल्क लावले: बिल \2 ची तारीख \3 होती.', '\1 विलंब शुल्क जोड़ा गया: बिल \2 की तारीख \3 थी।'),
(62, '^Advance running low$', 'आगाऊ रक्कम संपत आली', 'अग्रिम राशि कम हो रही है'),
(63, '^Advance left: (₹[0-9,.]+)\. Please top up soon\.$', 'आगाऊ रक्कम शिल्लक: \1. कृपया लवकर भरा.', 'अग्रिम राशि बची: \1। कृपया जल्दी भरें।'),
(64, '^Your advance is used up\. Please top up\.$', 'तुमची आगाऊ रक्कम संपली. कृपया भरा.', 'आपकी अग्रिम राशि ख़त्म हो गई। कृपया भरें।'),
(65, '^Your advance is used up and (₹[0-9,.]+) is due\. Please top up\.$', 'तुमची आगाऊ रक्कम संपली आणि \1 भरायचे आहेत. कृपया भरा.', 'आपकी अग्रिम राशि ख़त्म हो गई और \1 भरना है। कृपया भरें।'),
-- where are you today (customer)
(70, '^Where are you today\?$', 'आज तुम्ही कुठे आहात?', 'आज आप कहाँ हैं?'),
(71, '^Set your place for lunch before ([0-9]{1,2}:[0-9]{2} [AP]M) so we can deliver\.$', '\1 पूर्वी दुपारच्या जेवणासाठी तुमचे ठिकाण सांगा, म्हणजे आम्ही पोहोचवू शकू.', '\1 से पहले दोपहर के खाने के लिए अपनी जगह बताएँ, ताकि हम पहुँचा सकें।'),
(72, '^Set your place for dinner before ([0-9]{1,2}:[0-9]{2} [AP]M) so we can deliver\.$', '\1 पूर्वी रात्रीच्या जेवणासाठी तुमचे ठिकाण सांगा, म्हणजे आम्ही पोहोचवू शकू.', '\1 से पहले रात के खाने के लिए अपनी जगह बताएँ, ताकि हम पहुँचा सकें।'),
-- referrals, chat, loyalty, sign-in, joining (customer)
(80, '^Thank you for referring (.+)$', '\1 ची शिफारस केल्याबद्दल धन्यवाद', '\1 को सुझाने के लिए धन्यवाद'),
(81, '^We have added (.+) and will contact them soon\.$', 'आम्ही \1 यांना जोडले आहे आणि लवकरच संपर्क करू.', 'हमने \1 को जोड़ लिया है और जल्द संपर्क करेंगे।'),
(82, '^We will keep (.+) in mind\.$', 'आम्ही \1 यांना लक्षात ठेवू.', 'हम \1 को ध्यान में रखेंगे।'),
(83, '^Message from the kitchen$', 'किचनकडून संदेश', 'किचन से संदेश'),
(84, '^Voice note from the kitchen$', 'किचनकडून व्हॉइस नोट', 'किचन से वॉइस नोट'),
(85, '^Open Message the kitchen to listen\.$', 'ऐकण्यासाठी ''किचनला संदेश पाठवा'' उघडा.', 'सुनने के लिए ''किचन को संदेश भेजें'' खोलें।'),
(86, '^Thank you for ([0-9]+) meals!$', '\1 जेवणांसाठी धन्यवाद!', '\1 खानों के लिए धन्यवाद!'),
(87, '^You get a (.+) on us: (₹[0-9,.]+) taken off your bill\.$', 'आमच्याकडून \1: तुमच्या बिलातून \2 कमी केले.', 'हमारी तरफ़ से \1: आपके बिल से \2 कम किए गए।'),
(88, '^New sign-in to your account$', 'तुमच्या खात्यात नवीन साइन इन', 'आपके खाते में नया साइन इन'),
(89, '^Signed in on (.+) at ([0-9]{1,2}:[0-9]{2} [AP]M), ([0-9]{2} [A-Z][a-z]{2})\. Not you\? Sign out on all your devices and tell the kitchen\.$',
     '\3 रोजी \2 वाजता \1 वर साइन इन झाले. तुम्ही नव्हता? सर्व डिव्हाइसवरून साइन आउट करा आणि किचनला सांगा.',
     '\3 को \2 बजे \1 पर साइन इन हुआ। आप नहीं थे? सभी डिवाइस से साइन आउट करें और किचन को बताएँ।'),
(90, '^Welcome to (.+)$', '\1 मध्ये आपले स्वागत', '\1 में आपका स्वागत है'),
(91, '^You can now choose your meals in the app\.$', 'आता तुम्ही ॲपमध्ये तुमचे जेवण निवडू शकता.', 'अब आप ऐप में अपना खाना चुन सकते हैं।'),
(92, '^About your request to join$', 'तुमच्या सामील होण्याच्या विनंतीबद्दल', 'आपके जुड़ने के अनुरोध के बारे में'),
(93, '^The kitchen cannot take new customers right now\. Please contact them for details\.$', 'किचन सध्या नवीन ग्राहक घेऊ शकत नाही. अधिक माहितीसाठी त्यांच्याशी संपर्क साधा.', 'किचन अभी नए ग्राहक नहीं ले सकता। जानकारी के लिए उनसे संपर्क करें।');

-- Day and month names inside dates like "Tue 01 Dec" / "01 Dec" (same names as the apps).
create or replace function app.localize_dates(p_text text, p_lang text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  en_d text[] := array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  mr_d text[] := array['रवि','सोम','मंगळ','बुध','गुरु','शुक्र','शनि'];
  hi_d text[] := array['रवि','सोम','मंगल','बुध','गुरु','शुक्र','शनि'];
  en_m text[] := array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  mr_m text[] := array['जाने','फेब्रु','मार्च','एप्रि','मे','जून','जुलै','ऑग','सप्टें','ऑक्टो','नोव्हें','डिसें'];
  hi_m text[] := array['जन','फ़र','मार्च','अप्रै','मई','जून','जुल','अग','सित','अक्टू','नव','दिस'];
  v text := p_text; i int;
begin
  if p_lang not in ('mr','hi') or v is null then return v; end if;
  for i in 1..7 loop
    v := regexp_replace(v, '\m' || en_d[i] || '( [0-9]{2} [A-Z][a-z]{2})', case p_lang when 'mr' then mr_d[i] else hi_d[i] end || '\1', 'g');
  end loop;
  for i in 1..12 loop
    v := regexp_replace(v, '([0-9]{2} )' || en_m[i] || '\M', '\1' || case p_lang when 'mr' then mr_m[i] else hi_m[i] end, 'g');
  end loop;
  return v;
end $$;

create or replace function app.localize_alert(p_text text, p_lang text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare t app.alert_templates;
begin
  if p_lang not in ('mr','hi') or p_text is null then return p_text; end if;
  for t in select * from app.alert_templates order by seq loop
    if p_text ~ t.pattern then
      return app.localize_dates(regexp_replace(p_text, t.pattern, case p_lang when 'mr' then t.mr else t.hi end), p_lang);
    end if;
  end loop;
  return p_text;   -- no template: stays English
end $$;

create or replace function app.notify(p_kitchen uuid, p_user uuid, p_kind text, p_title text, p_body text, p_data jsonb, p_dedupe text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_muted boolean; v_lang text;
begin
  if p_user is null then return; end if;
  select p_kind = any (np.muted_kinds), np.language into v_muted, v_lang from public.notification_prefs np where np.user_id = p_user;
  v_lang := coalesce(v_lang, 'en');
  insert into public.notifications (kitchen_id, user_id, kind, title, body, data, dedupe_key, push_status)
  values (p_kitchen, p_user, p_kind,
          left(case when v_lang = 'en' or p_kind = 'announcement' then p_title else app.localize_alert(p_title, v_lang) end, 80),
          left(case when v_lang = 'en' or p_kind in ('announcement','chat_message') then p_body else app.localize_alert(p_body, v_lang) end, 300),
          coalesce(p_data, '{}'::jsonb), p_dedupe,
          case when coalesce(v_muted, false) then 'skipped' else 'pending' end)
  on conflict (dedupe_key) do nothing;
end $$;
revoke execute on function app.localize_dates(text, text), app.localize_alert(text, text) from public, anon, authenticated;
