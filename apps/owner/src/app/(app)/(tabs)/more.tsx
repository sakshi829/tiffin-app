import { Platform } from 'react-native';
import { router } from 'expo-router';
import { LanguagePicker, showMessage, SIGN_OUT_PARTIAL, useUnreadCount, useT } from '@amruta/app-core';
import { useAuth, useOwner } from '../../../lib/auth';
import { useAppLock } from '../../../lib/lock';
import { useAllowScreenshots } from '../../../lib/screen-privacy';
import { Button, Card, H2, ListRow, Muted, Screen, SwitchRow } from '../../../ui/kit';

export default function More() {
  const tr = useT();
  const { signOut } = useAuth();
  const { owner, email } = useOwner();
  const { lockNow, available } = useAppLock();
  const [allowShots, setAllowShots] = useAllowScreenshots();
  const unread = useUnreadCount();
  return (
    <Screen>
      <Card>
        <H2>{tr('Messages')}</H2>
        <ListRow title={unread.data ? tr('Alerts ({count} new)', { count: unread.data }) : tr('Alerts')} subtitle={tr('Payments, late skips, daily count')} onPress={() => router.push('/settings/alerts')} />
        <ListRow title={tr('Chats with customers')} subtitle={tr('Replies to customers\' messages')} onPress={() => router.push('/settings/messages')} />
        <ListRow title={tr('Send announcement')} subtitle={tr('Message all customers, now or later')} onPress={() => router.push('/settings/announce')} />
        <ListRow title={tr('Referrals')} subtitle={tr('Friends your customers suggested')} onPress={() => router.push('/settings/referrals')} />
        <ListRow title={tr('Join requests')} subtitle={tr('People without a code who asked to join (when sign-up allows requests)')} onPress={() => router.push('/settings/join-requests')} />
      </Card>
      <Card>
        <H2>{tr('Settings')}</H2>
        <ListRow title={tr('Business & rules')} subtitle={tr('Name, UPI ID, late skips, late fee, sign-ups')} onPress={() => router.push('/settings/business')} />
        <ListRow title={tr('Meal timings')} subtitle={tr('Delivery times and cutoffs, one-day changes')} onPress={() => router.push('/settings/timings')} />
        <ListRow title={tr('Days off')} subtitle={tr('Close for a day or one meal')} onPress={() => router.push('/settings/days-off')} />
        <ListRow title={tr('Locations')} subtitle={tr('Hospitals, offices, wards, labs, desks')} onPress={() => router.push('/settings/locations')} />
        <ListRow title={tr('Staff')} subtitle={tr('Invite, roles, phone access, who is on shift')} onPress={() => router.push('/settings/staff')} />
        <ListRow title={tr('Boxes not back')} subtitle={tr('Where customers left them; mark collected')} onPress={() => router.push('/settings/boxes')} />
        <ListRow title={tr('Loyalty reward')} subtitle={tr('Thank regular customers (off until you switch it on)')} onPress={() => router.push('/settings/loyalty')} />
      </Card>
      <Card>
        <H2>{tr('Language')}</H2>
        <LanguagePicker />
      </Card>
      <Card>
        <H2>{tr('Security')}</H2>
        <Muted>{tr('Signed in as {display_name} ({email}) with your authenticator app.', { display_name: owner.display_name, email: email })}</Muted>
        {Platform.OS !== 'web' && available === false ? (
          <Muted>{tr('This phone has no screen lock or fingerprint set up. Please add one in phone settings: the app lock uses it.')}</Muted>
        ) : null}
        {Platform.OS !== 'web' && available ? <Button variant="secondary" title={tr('Lock app now')} onPress={lockNow} /> : null}
        {Platform.OS !== 'web' ? (
          <SwitchRow label={tr('Allow screenshots on this phone')} value={allowShots} onValueChange={(v) => void setAllowShots(v)}
            hint={tr('Off: screenshots are blocked and the recent-apps preview is blank, so customer details aren\'t left on screen.')} />
        ) : null}
        <Button variant="secondary" title={tr('Sign out')} onPress={() => void signOut(false)} />
        <Button variant="danger" title={tr('Sign out on all my devices')} onPress={() => void signOut(true).then((r) => {
          if (r === 'this-device-only') showMessage(tr('Other devices still signed in'), tr(SIGN_OUT_PARTIAL));
        })} />
        <Muted>{tr('Use "all devices" if you lost a phone or used a shared computer.')}</Muted>
      </Card>
    </Screen>
  );
}
