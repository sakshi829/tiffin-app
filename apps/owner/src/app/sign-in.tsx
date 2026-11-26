import { useState } from 'react';
import { getSupabase } from '../lib/supabase';
import { AppError } from '../lib/api';
import { markFreshSignIn } from '../lib/lock';
import { GoogleSignInButton, LanguagePicker, recordSignIn, useT } from '@amruta/app-core';
import { GOOGLE_SIGNIN } from '../lib/env';
import { Body, Button, Card, ErrorText, Field, H1, Muted, Screen, useAction } from '../ui/kit';

const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$/;

/** Owner sign-in: email -> 6-digit code. No passwords. Only existing accounts (no sign-ups here). */
export default function SignIn() {
  const tr = useT();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);

  const send = useAction(async () => {
    const clean = email.trim().toLowerCase();
    if (!EMAIL.test(clean)) throw new AppError('INVALID_REQUEST');
    const { error } = await getSupabase().auth.signInWithOtp({ email: clean, options: { shouldCreateUser: false } });
    // Same screen whether or not the account exists (no account discovery).
    if (error && error.status === 429) throw new AppError('TOO_MANY_REQUESTS', error);
    setSentTo(clean);
  });

  const verify = useAction(async () => {
    if (!sentTo) return;
    const token = code.replace(/\D/g, '');
    const { error } = await getSupabase().auth.verifyOtp({ email: sentTo, token, type: 'email' });
    if (error) throw new AppError('INVALID_CODE', error);
    markFreshSignIn();   // proved who they are here: no fingerprint prompt needed right after
    void recordSignIn('owner');
    // AuthProvider moves on to the authenticator step automatically.
  });

  return (
    <Screen>
      <H1>{tr('Owner sign-in')}</H1>
      <LanguagePicker />
      {!sentTo ? (
        <Card>
          <Field label={tr('Email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email"
            keyboardType="email-address" textContentType="emailAddress" />
          <ErrorText error={send.error} />
          <Button title={tr('Send code')} onPress={() => send.run()} loading={send.busy} disabled={!email.trim()} />
          {GOOGLE_SIGNIN ? <GoogleSignInButton onSignedIn={() => { markFreshSignIn(); void recordSignIn('owner'); }} /> : null}
        </Card>
      ) : (
        <Card>
          <Body>{tr('If {sentTo} is an owner account, a 6-digit code has been emailed to it.', { sentTo: sentTo })}</Body>
          <Field label={tr('Code from email')} value={code} onChangeText={setCode} numeric="integer" maxLength={6}
            autoFocus textContentType="oneTimeCode" autoComplete="one-time-code" />
          <ErrorText error={verify.error} />
          <Button title={tr('Continue')} onPress={() => verify.run()} loading={verify.busy} disabled={code.replace(/\D/g, '').length !== 6} />
          <Button title={tr('Use a different email')} variant="ghost" onPress={() => { setSentTo(null); setCode(''); }} />
          <Muted>{tr('Codes expire quickly. You can ask for a new one after a minute.')}</Muted>
        </Card>
      )}
    </Screen>
  );
}
