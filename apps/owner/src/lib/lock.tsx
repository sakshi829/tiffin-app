// The owner app lock now lives in shared code (also used, optionally, by the customer app).
// Imported by file path, not from the @amruta/app-core index: the staff app has no
// fingerprint module, and loading it there would crash on a phone.
export { AppLock, markFreshSignIn, useAppLock } from '@amruta/app-core/src/lock';
