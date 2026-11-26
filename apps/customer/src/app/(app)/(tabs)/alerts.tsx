import { VAPID_PUBLIC_KEY } from '../../../lib/env';
import { InboxScreen } from '@amruta/app-core';

export default function Alerts() {
  return (
    <InboxScreen appLabel="Customer app" webPushKey={VAPID_PUBLIC_KEY} prefs={[
      { kind: 'location_reminder', label: 'Reminder to set where I am' },
      { kind: 'meal_delivered', label: 'Meal delivered' },
      { kind: 'low_balance', label: 'Advance running low' },
      { kind: 'chat_message', label: 'Message from the kitchen' },
      { kind: 'loyalty_reward', label: 'Loyalty reward' },
    ]} />
  );
}
