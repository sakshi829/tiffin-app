// Phase 8c (F44): alerts are written in each person's chosen language.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u;
before(async () => { w = await buildWorld(); t = w.t; u = w.u; });
after(async () => { await t.close(); });

// One real example per template, in exactly the format the database writes.
const SAMPLES = {
  10: 'Lunch delivered', 11: 'Dinner delivered',
  12: 'Your lunch has been delivered. Enjoy your meal!', 13: 'Your dinner has been delivered. Enjoy your meal!',
  20: 'Skip Priya', 21: 'Priya will not take lunch today. Do not deliver.', 22: 'Priya will not take dinner today. Do not deliver.',
  30: 'Kitchen closed Thu 03 Dec', 31: 'No lunch or dinner on Thu 03 Dec (Diwali). You will not be charged.',
  32: 'No lunch on Thu 03 Dec. You will not be charged.', 33: 'No dinner on Thu 03 Dec (Gas problem). You will not be charged.',
  34: 'Kitchen open Thu 03 Dec', 35: 'Good news: your lunch on Thu 03 Dec is back on.', 36: 'Good news: your dinner on Thu 03 Dec is back on.',
  40: 'Lunch route ready', 41: 'Dinner route ready',
  42: 'Deliveries for lunch on Tue 01 Dec are assigned to you.', 43: 'Deliveries for dinner on Tue 01 Dec are assigned to you.',
  44: 'Priya moved', 45: 'Priya is now at: City Hospital > Ward 5.',
  50: 'Payment received', 51: '₹1,250.50 received. Thank you!', 52: 'Payment not found',
  53: '₹500 (UTR 123456789012) could not be matched: No such payment', 54: 'Your bill is ready',
  55: '₹2,400 due by 08 Dec (bill AK-202612-00001).', 56: 'Nothing due (bill AK-202612-00002).', 57: 'Payment due 08 Dec',
  58: '₹2,400 is due by 08 Dec (bill AK-202612-00001). A late fee applies after that date.',
  59: '₹2,400 is due by 08 Dec (bill AK-202612-00001).', 60: 'Late fee added',
  61: '₹50 late fee added: bill AK-202612-00001 was due 08 Dec.', 62: 'Advance running low',
  63: 'Advance left: ₹120. Please top up soon.', 64: 'Your advance is used up. Please top up.',
  65: 'Your advance is used up and ₹80 is due. Please top up.', 70: 'Where are you today?',
  71: 'Set your place for lunch before 11:00 AM so we can deliver.', 72: 'Set your place for dinner before 6:30 PM so we can deliver.',
  80: 'Thank you for referring Neha', 81: 'We have added Neha and will contact them soon.', 82: 'We will keep Neha in mind.',
  83: 'Message from the kitchen', 84: 'Voice note from the kitchen', 85: 'Open Message the kitchen to listen.',
  86: 'Thank you for 30 meals!', 87: 'You get a free salad on us: ₹20 taken off your bill.', 88: 'New sign-in to your account',
  89: 'Signed in on Pixel 8 at 9:05 AM, 01 Dec. Not you? Sign out on all your devices and tell the kitchen.',
  90: "Welcome to Amruta's Kitchen", 91: 'You can now choose your meals in the app.', 92: 'About your request to join',
  93: 'The kitchen cannot take new customers right now. Please contact them for details.',
  // owner alerts (2500)
  100: 'Priya skipped lunch late', 101: 'Priya skipped dinner late',
  102: 'Priya will not take lunch on Thu 03 Dec (after the cutoff).', 103: 'Priya will not take dinner on Thu 03 Dec (after the cutoff).',
  104: 'Anil paid ₹500', 105: 'UPI reference 123456789012. Check your bank app, then confirm in Money.',
  106: 'Message from Priya', 107: 'Voice note from Priya', 108: 'Open Chats to listen.',
  109: 'New request to join', 110: 'Neha asked to join. Open More › Join requests to approve.',
  111: 'Priya referred Neha', 112: 'Neha (98200 12345) may want tiffins. Approve in More › Referrals.',
  113: 'Lunch today: final count', 114: 'Dinner today: final count',
  115: '12 tiffins (8 veg, 4 non-veg). Extras: Roti 3, Salad 2.', 116: '12 tiffins (8 veg, 4 non-veg).',
  117: 'Kitchen rent is due', 118: '₹15,000 · tap Money › Expenses to record it.',
  // suggestions (2500)
  120: 'Vegetables spending up 50%', 121: '₹1,500 so far this month vs ₹1,000 in the same days last month, while meals changed n/a. Check prices or quantities.',
  122: '₹1,500 so far this month vs ₹1,000 in the same days last month, while meals changed -5%. Check prices or quantities.',
  123: 'Cost per meal is rising', 124: '₹42 per meal this month vs ₹35 last month.',
  125: 'Friday lunch: 40% skipped', 126: 'Friday dinner: 40% skipped',
  127: 'About 1 fewer tiffin is needed on a typical Friday. Consider cooking a little less.',
  128: 'About 4 fewer tiffins are needed on a typical Friday. Consider cooking a little less.',
  129: 'Extra food: 12% of meals', 130: '9 tiffins were left over in the last 30 days. Cooking slightly less saves money.',
  131: '1 customer with no payment for 30+ days', 132: '3 customers with no payment for 30+ days',
  133: '₹4,800 due in total: Priya ₹2,400, Neha ₹2,400.', 134: 'Vegetables is over budget', 135: '₹1,500 spent of ₹1,200 this month.',
  136: '1 box out for 5+ days', 137: '3 boxes out for 5+ days', 138: 'See More › Boxes not back.',
  139: '1 customer ordering much less', 140: '2 customers ordering much less',
  141: 'Fewer meals in the last 2 weeks: Priya, Neha. A friendly message may help.',
  142: '35% of your investments recovered', 143: 'Investments so far: ₹20,000. Profit since the first one: ₹-1,200.',
};
// English that may legitimately remain: values (names, places, codes, reasons, labels) and AM/PM.
const ALLOWED = /\b(Priya|Neha|Anil|City|Hospital|Ward|UTR|UPI|AM|PM|AK|Diwali|Gas|problem|No|such|payment|Pixel|free|salad|Roti|Salad|rent|Vegetables|Friday|Amruta's|Kitchen)\b/g;

test('every alert template has an example and translates it fully to Marathi and Hindi', async () => {
  const seqs = (await t.sql('select seq from app.alert_templates order by seq')).map((r) => r.seq);
  assert.deepEqual(seqs, Object.keys(SAMPLES).map(Number), 'each template needs an example (and each example a template)');
  for (const [seq, en] of Object.entries(SAMPLES)) {
    for (const lang of ['mr', 'hi']) {
      const [{ out }] = await t.sql('select app.localize_alert($1, $2) as out', [en, lang]);
      assert.notEqual(out, en, `${lang} #${seq} not translated: ${en}`);
      assert.match(out, /[ऀ-ॿ]/, `${lang} #${seq} has no Devanagari: ${out}`);
      const leftover = out.replace(ALLOWED, '').match(/[A-Za-z]{3,}/g);
      assert.equal(leftover, null, `${lang} #${seq} leftover English ${leftover}: ${out}`);
    }
  }
  // the right template wins and values are kept, dates in the chosen language
  assert.equal((await t.sql(`select app.localize_alert('No lunch on Thu 03 Dec (Diwali). You will not be charged.', 'mr') as o`))[0].o,
    'गुरु 03 डिसें रोजी दुपारचे जेवण नाही (Diwali). पैसे लागणार नाहीत.');
  assert.equal((await t.sql(`select app.localize_alert('₹2,400 due by 08 Dec (bill AK-202612-00001).', 'hi') as o`))[0].o,
    '08 दिस तक ₹2,400 भरना है (बिल AK-202612-00001)।');
  assert.equal((await t.sql(`select app.localize_alert('Something new', 'mr') as o`))[0].o, 'Something new');   // no template: English
  assert.equal((await t.sql(`select app.localize_alert('Lunch delivered', 'en') as o`))[0].o, 'Lunch delivered');
});

test('the language is saved per person; only en, mr, hi', async () => {
  await t.call(u.custA, 'public.set_my_language($1)', ['mr']);
  await t.call(u.custB, 'public.set_my_language($1)', ['hi']);
  await t.call(u.delivery, 'public.set_my_language($1)', ['hi']);
  await rejects(t.call(u.custA, 'public.set_my_language($1)', ['fr']), 'INVALID_SETTING');
  await rejects(t.as(null, `select public.set_my_language('mr')`), 'permission denied');
  // muting keeps the language
  await t.call(u.custA, 'public.set_notification_prefs($1::text[])', ['{low_balance}']);
  assert.equal((await t.as(u.custA, 'select language from public.notification_prefs'))[0].language, 'mr');
});

test('real alerts arrive in each person\'s language; owner alerts, announcements and chat text stay as written', async () => {
  const latest = (user, kind) => t.as(user, 'select title, body from public.notifications where kind = $1 order by created_at desc limit 1', [kind]);
  // delivered (Marathi customer)
  const oa = await w.order(w.cust.A, '2026-12-01', 'lunch');
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [oa.id, 'delivered']);
  assert.deepEqual(await latest(u.custA, 'meal_delivered'),
    [{ title: 'दुपारचे जेवण पोहोचले', body: 'तुमचे दुपारचे जेवण पोहोचले आहे. जेवणाचा आनंद घ्या!' }]);
  // kitchen closed (both customers, each in their language)
  await t.call(u.owner, 'public.owner_add_closure($1, $2::date, $3, $4)', [w.k1, '2026-12-03', 'lunch', 'Diwali']);
  assert.deepEqual(await latest(u.custA, 'closure'), [{ title: 'किचन बंद गुरु 03 डिसें', body: 'गुरु 03 डिसें रोजी दुपारचे जेवण नाही (Diwali). पैसे लागणार नाहीत.' }]);
  assert.deepEqual(await latest(u.custB, 'closure'), [{ title: 'किचन बंद गुरु 03 दिस', body: 'गुरु 03 दिस को दोपहर का खाना नहीं (Diwali)। पैसा नहीं लगेगा।' }]);
  // route ready (Hindi delivery staff)
  const ob = await w.order(w.cust.B, '2026-12-02', 'lunch');
  await t.call(u.owner, 'public.owner_assign_orders($1, $2::uuid[], $3)', [w.k1, `{${ob.id}}`, w.staff.delivery]);
  assert.equal((await latest(u.delivery, 'route_ready'))[0].title, 'दोपहर का रूट तैयार');
  // payment confirmed (Hindi customer)
  const p = await t.call(u.custB, 'public.customer_submit_payment($1, 50000, $2, $3, $4, null)', [w.k1, 'UTR99887766', '2026-12-01', 'k-lang-0001']);
  await t.call(u.owner, 'public.owner_confirm_payment($1)', [p.payment_id]);
  assert.deepEqual(await latest(u.custB, 'payment_confirmed'), [{ title: 'भुगतान मिला', body: '₹500 मिला। धन्यवाद!' }]);
  // the owner (English) gets English
  assert.match((await latest(u.owner, 'payment_submitted'))[0].title, /^Anil paid ₹500$/);
  // chat: title translated, the kitchen's own words untouched
  await t.call(u.owner, 'public.owner_send_message($1, $2)', [w.cust.A, 'Your lunch has been delivered. Enjoy your meal!']);
  assert.deepEqual(await latest(u.custA, 'chat_message'), [{ title: 'किचनकडून संदेश', body: 'Your lunch has been delivered. Enjoy your meal!' }]);
  // announcements are the owner's own text
  await t.call(u.owner, 'public.owner_send_announcement($1, $2, $3, false)', [w.k1, 'Payment received', 'Diwali menu on Friday']);
  assert.deepEqual(await latest(u.custA, 'announcement'), [{ title: 'Payment received', body: 'Diwali menu on Friday' }]);
});

test('owner alerts in the owner\'s language; the fixed voice-note line is translated, typed chat text never', async () => {
  const latest = (user, kind) => t.as(user, 'select title, body from public.notifications where kind = $1 order by created_at desc limit 1', [kind]);
  await t.call(u.owner, 'public.set_my_language($1)', ['mr']);
  const p = await t.call(u.custA, 'public.customer_submit_payment($1, 25000, $2, $3, $4, null)', [w.k1, 'UTR55443322', '2026-12-01', 'k-lang-0002']);
  assert.ok(p.payment_id);
  const [owner] = await t.as(u.owner, "select title, body from public.notifications where kind = 'payment_submitted' and body like '%UTR55443322%'");   // same server time as earlier alerts
  assert.match(owner.title, /^.+ यांनी ₹250 भरले$/);
  assert.equal(owner.body, 'UPI संदर्भ UTR55443322. तुमचे बँक ॲप तपासा, मग पैसे मध्ये पक्के करा.');
  // voice note to a Marathi customer: the system line is translated
  await t.sql(`select app.notify($1, $2, 'chat_message', 'Voice note from the kitchen', 'Open Message the kitchen to listen.', null, 'voice-lang-1')`, [w.k1, u.custA.id]);
  assert.deepEqual(await t.as(u.custA, "select title, body from public.notifications where dedupe_key = 'voice-lang-1'"), [{ title: 'किचनकडून व्हॉइस नोट', body: "ऐकण्यासाठी 'किचनला संदेश पाठवा' उघडा." }]);
  // typed chat text that merely looks like a template stays exactly as typed
  await t.call(u.custA, 'public.customer_send_message($1, $2)', [w.k1, 'Anil paid ₹500']);
  const [chat] = await t.as(u.owner, "select title, body from public.notifications where kind = 'chat_message' and body = 'Anil paid ₹500'");
  assert.equal(chat.body, 'Anil paid ₹500');
  assert.match(chat.title, / यांचा संदेश$/);
  await t.call(u.owner, 'public.set_my_language($1)', ['en']);
});
