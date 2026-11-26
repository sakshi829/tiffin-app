import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { confirmWithDevice, deviceHasScreenLock, markFreshSignIn, useAppLockSetting } from '@amruta/app-core/src/lock';
import { router } from 'expo-router';
import { Body, Button, Card, ErrorText, Field, H2, LanguagePicker, Muted, RowWrap, rpc, Screen, showMessage, SIGN_OUT_PARTIAL, SwitchRow, useAction, useT } from '@amruta/app-core';
import { formatDate, telLink, whatsappLink } from '@amruta/shared';
import { useAuth, useMe } from '../../../lib/auth';
import { useSettings } from '../../../lib/queries';

export default function Profile() {
  const tr = useT();
  const { customer, kitchenId, email } = useMe();
  const { refresh, signOut } = useAuth();
  // Optional app lock (F13). Turning it on or off needs the phone's fingerprint/PIN.
  const [lockOn, setLockOn] = useAppLockSetting();
  const [hasScreenLock, setHasScreenLock] = useState<boolean | null>(null);
  useEffect(() => { void deviceHasScreenLock().then(setHasScreenLock); }, []);
  const toggleLock = useAction(async (on: boolean) => {
    if (!(await deviceHasScreenLock())) { setHasScreenLock(false); return; }
    if (!(await confirmWithDevice(on ? 'Turn on app lock' : 'Turn off app lock'))) return;
    if (on) markFreshSignIn();   // they just proved it's them: don't ask again at once
    await setLockOn(on);
  });
  // Account deletion request (Google Play rule): goes to the kitchen as a chat message; the owner erases the data.
  const [askDelete, setAskDelete] = useState(false);
  const [deleteSent, setDeleteSent] = useState(false);
  const deletion = useAction(async () => {
    await rpc('customer_send_message', { p_kitchen: kitchenId, p_body: 'Please delete my account and my personal data.' });
    setDeleteSent(true);
  });
  const settings = useSettings();
  const call = telLink(settings.data?.contact_phone);
  const wa = whatsappLink(settings.data?.contact_phone, `Hi, this is ${customer.full_name}.`);
  const [notes, setNotes] = useState(customer.food_notes ?? '');
  const [saved, setSaved] = useState(false);
  const save = useAction(async () => {
    await rpc('customer_update_food_notes', { p_kitchen: kitchenId, p_food_notes: notes.trim() || null });
    setSaved(true);
    await refresh();
  });

  return (
    <Screen>
      <Card>
        <H2>{customer.full_name}</H2>
        {customer.phone ? <Body>{customer.phone}</Body> : null}
        <Muted>{email}</Muted>
        <Muted>{tr('Customer since {date}', { date: formatDate(customer.joined_on) })} · {customer.billing_mode === 'advance' ? tr('pays in advance') : tr('pays monthly')}</Muted>
        <Muted>{tr('Name or phone wrong? Tell the kitchen; they can change it.')}</Muted>
      </Card>
      <Card>
        <H2>{tr('The kitchen')}</H2>
        <Button title={tr('Message the kitchen')} onPress={() => router.push('/chat')} />
        {call || wa ? (
          <RowWrap>
            {call ? <Button small variant="secondary" title={tr('Call')} onPress={() => void Linking.openURL(call)} /> : null}
            {wa ? <Button small variant="secondary" title={tr('WhatsApp')} onPress={() => void Linking.openURL(wa)} /> : null}
          </RowWrap>
        ) : null}
        <Button small variant="ghost" title={tr('Refer a friend')} onPress={() => router.push('/refer')} />
      </Card>
      <Card>
        <H2>{tr('Food notes')}</H2>
        <Field label={tr('Allergies, less spicy, no onion…')} value={notes} onChangeText={(v) => { setNotes(v); setSaved(false); }}
          multiline maxLength={500} />
        <ErrorText error={save.error} />
        <Button small title={saved ? tr('Saved') : tr('Save')} loading={save.busy} onPress={() => void save.run()} />
      </Card>
      <Card>
        <LanguagePicker />
      </Card>
      <Card>
        <H2>{tr('Privacy')}</H2>
        <Muted>{tr('Only the kitchen sees your details. To stop the service, tell the kitchen.')}</Muted>
        <Button variant="secondary" title={tr('Sign out')} onPress={() => void signOut(false)} />
        <Button variant="danger" title={tr('Sign out on all my devices')} onPress={() => void signOut(true).then((r) => {
          if (r === 'this-device-only') showMessage(tr('Other devices still signed in'), tr(SIGN_OUT_PARTIAL));
        })} />
        <Muted>{tr('Use this if you lost a phone.')}</Muted>
      </Card>
      {Platform.OS !== 'web' ? (
        <Card>
          <H2>{tr('App lock')}</H2>
          <SwitchRow label={tr('Lock the app with fingerprint or PIN')} value={lockOn === true} onValueChange={(v) => void toggleLock.run(v)}
            hint={tr('Asks for your phone\'s fingerprint, face or PIN when you open the app after 2 minutes away.')} />
          {hasScreenLock === false ? <Muted>{tr('Set up a screen lock (PIN or fingerprint) in your phone\'s settings first.')}</Muted> : null}
          <ErrorText error={toggleLock.error} />
        </Card>
      ) : null}
      <Card>
        <H2>{tr('Delete my account')}</H2>
        <Muted>{tr('The kitchen erases your name, phone, email, notes, places, messages, voice notes and photos within 30 days. Your bills and payments stay (without your name) because the kitchen must keep its accounts.')}</Muted>
        {deleteSent ? <Body bold>{tr('Request sent. The kitchen will confirm in chat.')}</Body> : (
          <>
            {askDelete ? <Body bold>{tr('Tap again to send the request.')}</Body> : null}
            <Button variant="danger" title={askDelete ? tr('Yes, ask to delete my account') : tr('Ask to delete my account')} loading={deletion.busy}
              onPress={() => { if (!askDelete) setAskDelete(true); else void deletion.run(); }} />
            <ErrorText error={deletion.error} />
          </>
        )}
      </Card>
    </Screen>
  );
}
