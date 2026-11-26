import * as Sentry from '@sentry/react-native';
import { isValidSentryDsn, scrubBreadcrumb, scrubEvent } from '@amruta/shared';

let started = false;

/**
 * Crash and error reports (F7). OFF unless a Sentry DSN is configured
 * (EXPO_PUBLIC_SENTRY_DSN). Nothing personal is sent: no user, no request
 * bodies or headers, no screenshots or screen trees, no console logs; emails,
 * phone-like numbers, tokens and invite codes are blanked (shared/scrub.ts, tested).
 */
export function startErrorReporting(app: 'owner' | 'customer' | 'staff', dsn: string): boolean {
  if (started || !isValidSentryDsn(dsn)) return false;
  Sentry.init({
    dsn,
    environment: app,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
  started = true;
  return true;
}
