import { useState } from 'react';
import { AppError, Body, Button, Card, ErrorText, Field, GoogleSignInButton, H1, LanguagePicker, Muted, Screen, useAction, recordSignIn, useT } from '@amruta/app-core';
import { GOOGLE_SIGNIN } from '../lib/env';
import { getSupabase } from '../lib/supabase';
import { markFreshSignIn } from '@amruta/app-core/src/lock';

const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$/;

/** Email -> 6-digit code. New emails get an account, but it sees nothing until an invite code is redeemed. */
export default function SignIn() {
  const tr = useT();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  // Store reviewers (Google Play / Apple) can't receive our email codes: they get a demo login with a password.
  const [reviewer, setReviewer] = useState(false);
  const [password, setPassword] = useState('');
  const pwSignIn = useAction(async () => {
    const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error && error.status === 429) throw new AppError('TOO_MANY_REQUESTS', error);
    if (error) throw new AppError('INVALID_CODE', error);
    void recordSignIn('customer');
    markFreshSignIn();
  });

  const signedIn = () => { void recordSignIn('customer'); markFreshSignIn(); };

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
    void recordSignIn('customer');   // "new sign-in" alert to their other devices
    markFreshSignIn();               // just proved who they are: no app-lock prompt right after
  });

  return (
    <Screen>
      <H1>{tr('Welcome to Amruta\'s Kitchen')}</H1>
      <LanguagePicker />
      {reviewer ? (
        <Card>
          <Body>{tr('Sign-in for app store reviewers (demo account).')}</Body>
          <Field label={tr('Email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Field label={tr('Password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" textContentType="password" />
          <ErrorText error={pwSignIn.error} />
          <Button title={tr('Sign in')} onPress={() => void pwSignIn.run()} loading={pwSignIn.busy} disabled={!email.trim() || !password} />
          <Button title={tr('Back')} variant="ghost" onPress={() => setReviewer(false)} />
        </Card>
      ) : !sentTo ? (
        <Card>
          <Body>{tr('Sign in with your email. We\'ll send you a 6-digit code; no password needed.')}</Body>
          <Field label={tr('Email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email"
            keyboardType="email-address" textContentType="emailAddress" />
          <ErrorText error={send.error} />
          <Button title={tr('Send code')} onPress={() => void send.run()} loading={send.busy} disabled={!email.trim()} />
          {GOOGLE_SIGNIN ? <GoogleSignInButton onSignedIn={signedIn} /> : null}
          <Button small title={tr('App store reviewer? Sign in with a password')} variant="ghost" onPress={() => setReviewer(true)} />
        </Card>
      ) : (
        <Card>
          <Body>{tr('We sent a 6-digit code to {sentTo}.', { sentTo: sentTo })}</Body>
          <Field label={tr('Code from email')} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6}
            autoFocus textContentType="oneTimeCode" autoComplete="one-time-code" />
          <ErrorText error={verify.error} />
          <Button title={tr('Continue')} onPress={() => void verify.run()} loading={verify.busy} disabled={code.replace(/\D/g, '').length !== 6} />
          <Button title={tr('Use a different email')} variant="ghost" onPress={() => { setSentTo(null); setCode(''); }} />
          <Muted>{tr('Didn\'t get it? Check spam, or wait a minute and try again.')}</Muted>
        </Card>
      )}
    </Screen>
  );
}
