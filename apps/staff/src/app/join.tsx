import { useState } from 'react';
import { AppError, Body, Button, Card, ErrorText, Field, H1, Muted, rpc, Screen, useAction, useT } from '@amruta/app-core';
import type { ErrorCode } from '@amruta/shared';
import { useAuth } from '../lib/auth';

export default function Join() {
  const tr = useT();
  const { state, refresh, signOut } = useAuth();
  const [code, setCode] = useState('');
  const join = useAction(async () => {
    // 'staff': a customer code typed here is refused WITHOUT being used up.
    const r = await rpc<{ ok: boolean; error?: ErrorCode }>('redeem_invite', { p_code: code, p_expected_kind: 'staff' });
    if (!r.ok) throw new AppError(r.error ?? 'INVALID_CODE');
    await refresh();
  });
  return (
    <Screen>
      <H1>{tr('Enter your staff code')}</H1>
      <Card>
        <Body>{tr('The kitchen owner gives you a one-time staff code.')}</Body>
        <Field label={tr('Staff code')} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} maxLength={14} />
        <ErrorText error={join.error} />
        <Button title={tr('Join')} onPress={() => void join.run()} loading={join.busy} disabled={code.replace(/[^A-Za-z0-9]/g, '').length !== 10} />
      </Card>
      <Muted>{tr('Signed in as {email}', { email: state.status === 'not-linked' ? state.email : '' })}</Muted>
      <Button title={tr('Sign out')} variant="ghost" onPress={() => void signOut()} />
    </Screen>
  );
}
