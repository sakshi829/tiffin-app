import { getSupabase } from './supabase';
import { AppError, toAppError } from './api';
import { markFreshSignIn } from './lock';

/** The user's verified authenticator-app factor id, or null. */
export async function verifiedTotpFactorId(): Promise<string | null> {
  const { data, error } = await getSupabase().auth.mfa.listFactors();
  if (error) throw toAppError(error);
  return data.totp[0]?.id ?? null;   // `totp` contains verified factors only
}

export interface Enrollment {
  factorId: string;
  secret: string;
  uri: string;      // otpauth:// link: opens the authenticator app on the same phone
  qrSvg: string;    // data URL (SVG) for scanning from another screen (web)
}

/** Start authenticator setup. Removes abandoned unverified attempts first. */
export async function startEnrollment(): Promise<Enrollment> {
  const mfa = getSupabase().auth.mfa;
  const { data: list, error: listErr } = await mfa.listFactors();
  if (listErr) throw toAppError(listErr);
  for (const f of list.all) {
    if (f.factor_type === 'totp' && f.status === 'unverified') {
      await mfa.unenroll({ factorId: f.id });   // best effort; a leftover only blocks reusing the same name
    }
  }
  const { data, error } = await mfa.enroll({ factorType: 'totp', friendlyName: `Owner ${new Date().toISOString().slice(0, 16)}` });
  if (error) throw toAppError(error);
  return { factorId: data.id, secret: data.totp.secret, uri: data.totp.uri, qrSvg: data.totp.qr_code };
}

/** Verify a 6-digit code against a factor (first-time setup, sign-in, or step-up). */
export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const clean = code.replace(/\D/g, '');
  if (clean.length !== 6) throw new AppError('INVALID_CODE');
  const { error } = await getSupabase().auth.mfa.challengeAndVerify({ factorId, code: clean });
  if (error) throw new AppError('INVALID_CODE', error);
  markFreshSignIn();
  // The library refreshes the session after verification; read it back so the next
  // request carries the new token (aal2 + fresh TOTP timestamp for step-up).
  await getSupabase().auth.getSession();
}
