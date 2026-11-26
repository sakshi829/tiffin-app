import { VAPID_PUBLIC_KEY } from '../../../lib/env';
import { InboxScreen } from '@amruta/app-core';

export default function Alerts() {
  return (
    <InboxScreen appLabel="Staff app" webPushKey={VAPID_PUBLIC_KEY} prefs={[
      { kind: 'route_ready', label: 'Route ready' },
      { kind: 'location_changed', label: 'Customer changed place' },
      { kind: 'late_skip', label: 'Customer skipped late' },
    ]} />
  );
}
