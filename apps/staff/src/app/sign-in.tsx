import { useState } from 'react';
import { GoogleSignInButton, AppError, Body, Button, Card, ErrorText, Field, H1, LanguagePicker, Muted, Screen, useAction, recordSignIn, useT } from '@amruta/app-core';
import { GOOGLE_SIGNIN } from '../lib/env';
import { getSupabase } from '../lib/supabase';

const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$/;

export default function SignIn() {
  const tr = useT();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);

  const send = useAction(async () => {
    const clean = email.trim().toLowerCase();
    if (!EMAIL.test(clean)) throw new AppError('INVALID_REQUEST');
    const { error } = await getSupabase().auth.signInWithOtp({ email: clean, options: { shouldCreateUser: true } });
    if (error && error.status === 429) throw new AppError('TOO_MANY_REQUESTS', error);
    if (error) throw new AppError('UNKNOWN', error);
    setSentTo(clean);
  });
  const verify = useAction(async () => {
    if (!sentTo) return;
    const { error } = await getSupabase().auth.verifyOtp({ email: sentTo, token: code.replace(/\D/g, ''), type: 'email' });
    if (error) throw new AppError('INVALID_CODE', error);
    void recordSignIn('staff');   // "new sign-in" alert to their other devices
  });

  return (
    <Screen>
      <H1>{tr('Amruta\'s Kitchen · Staff')}</H1>
      <LanguagePicker />
      {!sentTo ? (
        <Card>
          <Field label={tr('Email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <ErrorText error={send.error} />
          <Button title={tr('Send code')} onPress={() => void send.run()} loading={send.busy} disabled={!email.trim()} />
          {GOOGLE_SIGNIN ? <GoogleSignInButton onSignedIn={() => void recordSignIn('staff')} /> : null}
        </Card>
      ) : (
        <Card>
          <Body>{tr('We sent a 6-digit code to {sentTo}.', { sentTo: sentTo })}</Body>
          <Field label={tr('Code from email')} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6}
            autoFocus textContentType="oneTimeCode" autoComplete="one-time-code" />
          <ErrorText error={verify.error} />
          <Button title={tr('Continue')} onPress={() => void verify.run()} loading={verify.busy} disabled={code.replace(/\D/g, '').length !== 6} />
          <Button title={tr('Use a different email')} variant="ghost" onPress={() => { setSentTo(null); setCode(''); }} />
          <Muted>{tr('Check spam if it doesn\'t arrive.')}</Muted>
        </Card>
      )}
    </Screen>
  );
}
