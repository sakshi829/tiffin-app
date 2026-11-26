import { useState } from 'react';
import { Badge, Body, Button, Card, ErrorText, H2, LanguagePicker, Muted, rpc, Screen, showMessage, SIGN_OUT_PARTIAL, useAction, useT } from '@amruta/app-core';
import { istClock } from '@amruta/shared';
import { useAuth, useStaffMe } from '../../../lib/auth';
import { useOfflineQueue } from '../../../lib/offline';
import { useOpenShift, useRefreshAll } from '../../../lib/queries';

const ROLE: Record<string, string> = { kitchen: 'Kitchen', delivery: 'Delivery', kitchen_delivery: 'Kitchen & delivery' };

export default function Me() {
  const tr = useT();
  const { staff, kitchenId, email } = useStaffMe();
  const { signOut } = useAuth();
  const q = useOfflineQueue();
  const shift = useOpenShift();
  const refreshAll = useRefreshAll();
  const [confirmOut, setConfirmOut] = useState<null | 'local' | 'global'>(null);

  const checkIn = useAction(async () => { await rpc('staff_check_in', { p_kitchen: kitchenId }); await refreshAll(); });
  const checkOut = useAction(async () => { await rpc('staff_check_out', { p_kitchen: kitchenId }); await refreshAll(); });

  const doSignOut = (scope: 'local' | 'global') => {
    if (q.pending.length > 0 && confirmOut !== scope) { setConfirmOut(scope); return; }
    void signOut(scope === 'global').then((r) => {
      if (r === 'this-device-only') showMessage('Other devices still signed in', SIGN_OUT_PARTIAL);
    });
  };

  return (
    <Screen refreshing={shift.isFetching} onRefresh={() => void refreshAll()}>
      <Card>
        <H2>{staff.display_name}</H2>
        <Badge text={ROLE[staff.role] ? tr(ROLE[staff.role]!) : staff.role} tone="primary" />
        <Muted>{email}</Muted>
        <Muted>{staff.can_see_phone ? tr('You can see customer phone numbers for today\'s deliveries.') : tr('Customer phone numbers are hidden (owner\'s choice).')}</Muted>
      </Card>
      <Card>
        <H2>{tr('Shift')}</H2>
        {shift.data ? (
          <>
            <Body>{tr('On shift since {istClock}', { istClock: istClock(shift.data.started_at) })}</Body>
            <Button title={tr('Check out')} variant="secondary" loading={checkOut.busy} onPress={() => void checkOut.run()} />
          </>
        ) : (
          <>
            <Body>{tr('Not on shift.')}</Body>
            <Button title={tr('Check in')} loading={checkIn.busy} onPress={() => void checkIn.run()} />
          </>
        )}
        <ErrorText error={checkIn.error ?? checkOut.error ?? shift.error} />
      </Card>
      <Card>
        <LanguagePicker />
      </Card>
      <Card>
        {confirmOut ? (
          <Body bold>{tr('{length} update(s) are not sent yet and will be lost. Get signal and tap "Send now" first, or tap sign out again.', { length: q.pending.length })}</Body>
        ) : null}
        <Button variant="secondary" title={tr('Sign out')} onPress={() => doSignOut('local')} />
        <Button variant="danger" title={tr('Sign out on all my devices')} onPress={() => doSignOut('global')} />
        <Muted>{tr('Use "all devices" if you lost a phone.')}</Muted>
      </Card>
    </Screen>
  );
}
