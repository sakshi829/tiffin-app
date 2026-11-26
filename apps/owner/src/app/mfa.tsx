import { useEffect, useState } from 'react';
import { Image, Linking, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '../lib/auth';
import { startEnrollment, verifiedTotpFactorId, verifyTotp, type Enrollment } from '../lib/mfa';
import { Body, Button, Card, ErrorText, Field, H1, H2, Loading, Muted, Screen, useAction } from '../ui/kit';
import { useT } from '@amruta/app-core';

/**
 * Owner access always needs an authenticator app (Google Authenticator, Microsoft
 * Authenticator, Authy...). First time: set it up. Every sign-in: enter its code.
 */
export default function Mfa() {
  const tr = useT();
  const { state, refresh, signOut } = useAuth();
  const hasFactor = state.status === 'needs-mfa' && state.hasFactor;
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  const start = useAction(async () => setEnrollment(await startEnrollment()));
  useEffect(() => { if (!hasFactor && !enrollment) void start.run(); }, [hasFactor]); // eslint-disable-line react-hooks/exhaustive-deps

  const verify = useAction(async () => {
    const factorId = hasFactor ? await verifiedTotpFactorId() : enrollment?.factorId;
    if (!factorId) return;
    await verifyTotp(factorId, code);
    await refresh();
  });

  const copyKey = async () => {
    if (!enrollment) return;
    await Clipboard.setStringAsync(enrollment.secret, { android: { isSensitive: true } });
    setCopied(true);
  };

  return (
    <Screen>
      <H1>{hasFactor ? tr('Enter authenticator code') : tr('Set up your authenticator')}</H1>
      {!hasFactor && (
        <Card>
          <H2>{tr('One-time setup')}</H2>
          <Body>{tr('1. Install an authenticator app (Google Authenticator or Microsoft Authenticator).')}</Body>
          {start.busy || (!enrollment && !start.error) ? <Loading /> : null}
          <ErrorText error={start.error} />
          {enrollment ? (
            <>
              <Body>{tr('2. Add the account. On this phone, tap the button below. On another device, enter the key by hand.')}</Body>
              <Button title={tr('Open authenticator app')} variant="secondary"
                onPress={() => void Linking.openURL(enrollment.uri)} />
              <Muted>{tr('Setup key: {value}', { value: enrollment.secret.replace(/(.{4})/g, '$1 ').trim() })}</Muted>
              <Button title={copied ? tr('Key copied') : tr('Copy setup key')} variant="ghost" onPress={copyKey} />
              <Muted>{tr('Also save this key in a password manager. If you lose your phone, adding the same key to a new phone restores access.')}</Muted>
              {Platform.OS === 'web' ? (
                <Image accessibilityLabel={tr('QR code for authenticator')} source={{ uri: enrollment.qrSvg }} style={{ width: 200, height: 200, alignSelf: 'center' }} />
              ) : null}
              <Body>{tr('3. Type the 6-digit code the app shows.')}</Body>
            </>
          ) : null}
        </Card>
      )}
      <Card>
        <Field label={tr('6-digit code')} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6}
          textContentType="oneTimeCode" autoComplete="one-time-code" />
        <ErrorText error={verify.error} />
        <Button title={tr('Verify')} onPress={() => verify.run()} loading={verify.busy}
          disabled={code.replace(/\D/g, '').length !== 6 || (!hasFactor && !enrollment)} />
        <Muted>{tr('Lost your phone? The authenticator can be reset from the Supabase dashboard (see setup guide).')}</Muted>
      </Card>
      <Button title={tr('Sign out')} variant="ghost" onPress={() => void signOut()} />
    </Screen>
  );
}
