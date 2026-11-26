import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KITCHEN_ID } from '../lib/env';
import { AppError, Body, Button, Card, ErrorText, Field, H1, Muted, rpc, Screen, useAction, useT } from '@amruta/app-core';
import type { ErrorCode } from '@amruta/shared';
import { useAuth } from '../lib/auth';

/** Signed in, but not yet linked to the kitchen: enter the invite code from the kitchen. */
export default function Join() {
  const tr = useT();
  const { state, refresh, signOut } = useAuth();
  const [code, setCode] = useState('');
  const join = useAction(async () => {
    // 'customer': a staff code typed here is refused WITHOUT being used up.
    const r = await rpc<{ ok: boolean; error?: ErrorCode }>('redeem_invite', { p_code: code, p_expected_kind: 'customer' });
    if (!r.ok) throw new AppError(r.error ?? 'INVALID_CODE');
    await refresh();
  });
  return (
    <Screen>
      <H1>{tr('Enter your invite code')}</H1>
      <Card>
        <Body>{tr('Amruta\'s Kitchen gives each customer a one-time code, like ABCDE-FGH23.')}</Body>
        <Field label={tr('Invite code')} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} maxLength={14} />
        <ErrorText error={join.error} />
        <Button title={tr('Join')} onPress={() => void join.run()} loading={join.busy} disabled={code.replace(/[^A-Za-z0-9]/g, '').length !== 10} />
        <Muted>{tr('No code? Ask the kitchen to send you one on WhatsApp.')}</Muted>
      </Card>
      {KITCHEN_ID ? <AskToJoin onApproved={() => void refresh()} /> : null}
      <Muted>{tr('Signed in as {email}', { email: state.status === 'not-linked' ? state.email : '' })}</Muted>
      <Button title={tr('Sign out')} variant="ghost" onPress={() => void signOut()} />
    </Screen>
  );
}

const PHONE = /^[0-9+ -]{7,20}$/;

/** No invite code? If the kitchen accepts requests, ask to join; the owner approves. */
function AskToJoin({ onApproved }: { onApproved: () => void }) {
  const tr = useT();
  const info = useQuery({
    queryKey: ['join-info', KITCHEN_ID],
    queryFn: async () => (await rpc<{ name: string; signup_mode: string; my_request_status: string | null }[]>('kitchen_join_info', { p_kitchen: KITCHEN_ID }))[0] ?? null,
  });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [place, setPlace] = useState('');
  const [note, setNote] = useState('');
  const send = useAction(async () => {
    if (!name.trim()) throw new AppError('NAME_REQUIRED');
    if (!PHONE.test(phone.trim())) throw new AppError('INVALID_PHONE');
    const r = await rpc<{ status: string }>('customer_request_to_join', {
      p_kitchen: KITCHEN_ID, p_full_name: name.trim(), p_phone: phone.trim(), p_location_text: place.trim() || null, p_note: note.trim() || null,
    });
    if (r.status === 'approved') onApproved();
    await info.refetch();
  });
  const i = info.data;
  if (!i || i.signup_mode === 'invite_only') return null;
  if (i.my_request_status === 'pending') {
    return <Card><H1>{tr('Request sent')}</H1><Body>{tr('{name} will look at your request and let you know here.', { name: i.name })}</Body></Card>;
  }
  return (
    <Card>
      <H1>{tr('No code? Ask to join')}</H1>
      <Body>{tr('Tell {name} who you are and where you\'d like your tiffin.', { name: i.name })}</Body>
      <Field label={tr('Your name')} value={name} onChangeText={setName} maxLength={100} />
      <Field label={tr('Phone')} value={phone} onChangeText={setPhone} numeric="phone" maxLength={20}
        error={phone && !PHONE.test(phone.trim()) ? tr('Numbers only, like 98200 12345') : null} />
      <Field label={tr('Where to deliver (optional)')} value={place} onChangeText={setPlace} maxLength={120} />
      <Field label={tr('Anything else (optional)')} value={note} onChangeText={setNote} maxLength={300} multiline />
      {i.my_request_status === 'rejected' ? <Muted>{tr('Your last request wasn\'t accepted. You can ask again or contact the kitchen.')}</Muted> : null}
      <ErrorText error={send.error} />
      <Button title={tr('Send request')} loading={send.busy} disabled={!name.trim() || !phone.trim()} onPress={() => void send.run()} />
    </Card>
  );
}
