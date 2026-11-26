import { useState } from 'react';
import { Stack } from 'expo-router';
import { Badge, Body, Button, Card, ErrorText, Field, H2, ListRow, Muted, rpc, Screen, useAction, useT } from '@amruta/app-core';
import { useMe } from '../../lib/auth';
import { useMyReferrals, useRefreshAll } from '../../lib/queries';

const PHONE = /^[0-9+ -]{7,20}$/;

/** Suggest a friend. The kitchen decides and contacts them; nothing is shared with the friend automatically. */
export default function Refer() {
  const tr = useT();
  const { kitchenId } = useMe();
  const mine = useMyReferrals();
  const refreshAll = useRefreshAll();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);
  const send = useAction(async () => {
    await rpc('customer_refer_friend', { p_kitchen: kitchenId, p_name: name.trim(), p_phone: phone.trim(), p_note: note.trim() || null });
    setName(''); setPhone(''); setNote(''); setDone(true);
    await refreshAll();
  });
  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Refer a friend') }} />
      <Card>
        <Body>{tr('Know someone who\'d like home-made tiffins? Tell the kitchen.')}</Body>
        <Muted>{tr('Please ask your friend first: the kitchen will call them.')}</Muted>
        <Field label={tr('Friend\'s name')} value={name} onChangeText={(v) => { setName(v); setDone(false); }} maxLength={100} />
        <Field label={tr('Friend\'s phone')} value={phone} onChangeText={setPhone} numeric="phone" maxLength={20}
          error={phone && !PHONE.test(phone.trim()) ? tr('Check the number') : null} />
        <Field label={tr('Note (optional)')} value={note} onChangeText={setNote} maxLength={300} placeholder={tr('Works in Ward 7, wants lunch')} />
        <ErrorText error={send.error} />
        <Button title={tr('Send to the kitchen')} loading={send.busy} disabled={!name.trim() || !PHONE.test(phone.trim())} onPress={() => void send.run()} />
        {done ? <Body bold>{tr('Thank you! The kitchen will take it from here.')}</Body> : null}
      </Card>
      {(mine.data ?? []).length > 0 ? (
        <Card>
          <H2>{tr('My referrals')}</H2>
          {(mine.data ?? []).map((r) => (
            <ListRow key={r.id} title={r.friend_name} subtitle={r.friend_phone}
              right={<Badge text={r.status === 'pending' ? tr('With the kitchen') : r.status === 'approved' ? tr('Added') : tr('Not now')}
                tone={r.status === 'approved' ? 'good' : 'neutral'} />} />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
