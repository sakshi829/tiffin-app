import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Modal, View } from 'react-native';
import { AppError, toAppError } from './api';
import { verifiedTotpFactorId, verifyTotp } from './mfa';
import { Body, Button, Card, ErrorText, Field, H2, Muted } from '../ui/kit';
import { space, useColors } from '../ui/theme';
import { useT } from '@amruta/app-core';

/**
 * Dangerous owner actions (prices, staff, waivers, settings, unlinking) need an
 * authenticator code entered in the last 10 minutes; the DATABASE enforces it.
 * `withStepUp` runs the action; if the database answers STEP_UP_REQUIRED it asks
 * for the code, verifies it, and retries once.
 */
type Runner = <T>(fn: () => Promise<T>) => Promise<T>;
const StepUpContext = createContext<Runner | null>(null);

export function StepUpProvider({ children }: { children: ReactNode }) {
  const tr = useT();
  const c = useColors();
  const [visible, setVisible] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const pending = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);

  const askForCode = useCallback(() => new Promise<void>((resolve, reject) => {
    pending.current = { resolve, reject };
    setCode('');
    setError(null);
    setVisible(true);
  }), []);

  const withStepUp: Runner = useCallback(async (fn) => {
    try {
      return await fn();
    } catch (e) {
      if (toAppError(e).code !== 'STEP_UP_REQUIRED') throw e;
      await askForCode();
      return fn();
    }
  }, [askForCode]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const factorId = await verifiedTotpFactorId();
      if (!factorId) throw new AppError('NOT_ALLOWED');
      await verifyTotp(factorId, code);
      setVisible(false);
      pending.current?.resolve();
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setVisible(false);
    pending.current?.reject(new AppError('STEP_UP_REQUIRED'));
  };

  return (
    <StepUpContext.Provider value={withStepUp}>
      {children}
      <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
        <View style={{ flex: 1, backgroundColor: c.overlay, justifyContent: 'center', padding: space.lg }}>
          <Card>
            <H2>{tr('Confirm it\'s you')}</H2>
            <Body>{tr('Enter the 6-digit code from your authenticator app.')}</Body>
            <Muted>{tr('Needed for prices, staff, waivers and settings. Valid for 10 minutes.')}</Muted>
            <Field label={tr('Authenticator code')} value={code} onChangeText={setCode} keyboardType="number-pad"
              maxLength={6} autoFocus textContentType="oneTimeCode" autoComplete="one-time-code" />
            <ErrorText error={error} />
            <Button title={tr('Confirm')} onPress={submit} loading={busy} disabled={code.replace(/\D/g, '').length !== 6} />
            <Button title={tr('Cancel')} variant="ghost" onPress={cancel} />
          </Card>
        </View>
      </Modal>
    </StepUpContext.Provider>
  );
}

export function useStepUp(): Runner {
  const ctx = useContext(StepUpContext);
  if (!ctx) throw new Error('useStepUp outside StepUpProvider');
  return ctx;
}
