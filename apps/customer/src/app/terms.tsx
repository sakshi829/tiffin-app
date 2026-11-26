import { useQuery } from '@tanstack/react-query';
import { Body, Button, Card, ErrorText, H1, H2, Loading, Muted, rpc, run, Screen, useAction, useT } from '@amruta/app-core';
import { cols, describeSlotTimes, formatRupees, type BusinessSettings, type MealSlotRow } from '@amruta/shared';
import { getSupabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Linking } from 'react-native';
import { PRIVACY_URL } from '../lib/env';

/** The kitchen's rules, accepted once before using the app (PLAN decisions 8, 11 + privacy). */
export default function Terms() {
  const tr = useT();
  const { state, refresh, signOut } = useAuth();
  const kitchenId = state.status === 'needs-terms' ? state.customer.kitchen_id : '';
  const info = useQuery({
    queryKey: ['terms', kitchenId],
    enabled: !!kitchenId,
    queryFn: async () => {
      const db = getSupabase();
      const [settings, slots] = await Promise.all([
        run<BusinessSettings>(db.from('business_settings').select(cols('business_settings')).eq('kitchen_id', kitchenId).single()),
        run<MealSlotRow[]>(db.from('meal_slots').select(cols('meal_slots')).eq('kitchen_id', kitchenId)),
      ]);
      return { settings, slots };
    },
  });
  const accept = useAction(async () => { await rpc('customer_accept_terms', { p_kitchen: kitchenId }); await refresh(); });

  if (info.isLoading) return <Loading />;
  const s = info.data?.settings;
  return (
    <Screen>
      <H1>{tr('Before you start')}</H1>
      <ErrorText error={info.error} />
      {s ? (
        <>
          <Card>
            <H2>{tr('Meal times and changes')}</H2>
            {(info.data?.slots ?? []).filter((x) => x.active).map((x) => (
              <Body key={x.id}>{x.meal_slot === 'lunch' ? tr('Lunch') : tr('Dinner')}: {describeSlotTimes(x)}</Body>
            ))}
            <Muted>{tr('Times can change for a day; the app always shows the current ones.')}</Muted>
          </Card>
          <Card>
            <H2>{tr('Skipping a meal')}</H2>
            <Body>{tr('Skipping before the cutoff is free.')}</Body>
            <Body>
              {s.free_late_skips_per_month === 1
                ? tr('After the cutoff the food is already being made: 1 late skip per month is free, after that {percent}% of the meal price is charged.', { percent: s.late_skip_charge_percent })
                : tr('After the cutoff the food is already being made: {free} late skips per month are free, after that {percent}% of the meal price is charged.', { free: s.free_late_skips_per_month, percent: s.late_skip_charge_percent })}
            </Body>
            <Body>{tr('Days when the kitchen is closed are never charged.')}</Body>
          </Card>
          <Card>
            <H2>{tr('Payments')}</H2>
            <Body>{tr('You pay for meals delivered and extras you asked for.')}</Body>
            {s.late_fee_enabled ? (
              <Body>
                {tr('Bills not paid within {days} days get a late fee of {fee}. You will be reminded before.', {
                  days: s.late_fee_grace_days, fee: s.late_fee_type === 'flat' ? formatRupees(s.late_fee_value) : `${s.late_fee_value}%` })}
              </Body>
            ) : null}
          </Card>
          <Card>
            <H2>{tr('Your data')}</H2>
            <Body>
              {tr('We keep your name, phone, email, food notes, where to deliver, your meals, bills and payments, and the messages, voice notes and screenshots you send. Delivery photos and voice notes are deleted after {days} days, payment screenshots after about 13 months.', { days: s.media_retention_days })}
            </Body>
            <Body>{tr('No GPS, no contacts, no ads or tracking. Only the kitchen sees your data; it is never sold or shared.')}</Body>
            <Body>{tr('You can ask to see or delete it any time (Me › Delete my account). Bills stay, without your name, for the kitchen\'s accounts.')}</Body>
            {PRIVACY_URL ? <Button small variant="ghost" title={tr('Full privacy policy')} onPress={() => void Linking.openURL(PRIVACY_URL)} /> : null}
          </Card>
          <ErrorText error={accept.error} />
          <Button title={tr('I agree')} onPress={() => void accept.run()} loading={accept.busy} />
        </>
      ) : null}
      <Button title={tr('Sign out')} variant="ghost" onPress={() => void signOut()} />
    </Screen>
  );
}
