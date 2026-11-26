import { Stack } from 'expo-router';
import { InboxScreen, useT } from '@amruta/app-core';
import { VAPID_PUBLIC_KEY } from '../../../lib/env';

export default function OwnerAlerts() {
  const tr = useT();
  return (
    <>
      <Stack.Screen options={{ title: tr('Alerts') }} />
      <InboxScreen appLabel="Owner app" webPushKey={VAPID_PUBLIC_KEY} prefs={[
        { kind: 'daily_summary', label: 'Final count after each cutoff' },
        { kind: 'payment_submitted', label: 'Customer reported a UPI payment' },
        { kind: 'late_skip', label: 'Customer skipped after the cutoff' },
        { kind: 'chat_message', label: 'Customer message' },
        { kind: 'referral_request', label: 'Customer referred a friend' },
        { kind: 'expense_due', label: 'Regular expense is due (rent, gas...)' },
      ]} />
    </>
  );
}
