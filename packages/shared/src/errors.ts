/**
 * Database functions raise short codes (e.g. CUTOFF_PASSED). This maps them to
 * plain messages. Unknown errors get a generic message: internal details are
 * never shown to users.
 */

export const ERROR_MESSAGES = {
  NOT_ALLOWED: 'You are not allowed to do this.',
  STEP_UP_REQUIRED: 'Please enter your authenticator code to confirm.',
  NOT_FOUND: 'Not found. It may have been removed, or it is not yours.',
  NOT_AUTHENTICATED: 'Please sign in again.',
  CUTOFF_PASSED: 'Too late: the time for changes has passed.',
  TOO_LATE: 'Too late: this meal has already been delivered.',
  ORDER_NOT_ACTIVE: 'This meal can no longer be changed.',
  ARCHIVE_FIRST: 'Archive this customer first, then erase their personal data.',
  TOO_EARLY: 'Too early to mark this delivered: the customer can still skip it until the extras cutoff.',
  ORDER_NOT_DELIVERED: 'This meal has not been delivered yet.',
  CANNOT_UNSKIP: 'A meal skipped after the cutoff cannot be restored.',
  KITCHEN_CLOSED: 'The kitchen is closed for this meal.',
  ACCOUNT_INACTIVE: 'This account is not active.',
  ACCOUNT_PAUSED: 'This account is paused.',
  ITEM_NOT_AVAILABLE: 'This item is not available.',
  INVALID_QUANTITY: 'Please choose a valid quantity.',
  INVALID_LOCATION: 'Please choose a valid location.',
  LOCATION_REQUIRED: 'Please choose or type a location.',
  TEXT_TOO_LONG: 'The text is too long.',
  INVALID_TEXT: 'The text contains characters that are not allowed.',
  INVALID_DATES: 'Please check the dates.',
  PAST_DATE: 'The date cannot be in the past.',
  INVALID_SLOT: 'Please choose lunch or dinner.',
  INVALID_AMOUNT: 'Please enter a valid amount.',
  NAME_REQUIRED: 'Please type a name.',
  LOCATION_IN_USE: 'This is still used (by spots inside it, customers, meal plans or past meals), so it cannot be deleted. Hide it instead.',
  INVALID_EMAIL: 'Please enter a valid email address, like name@gmail.com.',
  INVALID_PHONE: 'Please enter a valid phone number.',
  UNIT_REQUIRED: 'Please type a unit, e.g. piece or plate.',
  CHOOSE_TIFFIN: 'Please choose a tiffin type.',
  CHOOSE_DAYS: 'Please choose at least one day.',
  CHOOSE_CATEGORY: 'Please choose a category.',
  INVALID_TIME: 'Please enter a time like 1:30 PM or 13:30.',
  TIME_REQUIRED: 'Please enter a new delivery time or cutoff time.',
  CHECK_NUMBERS: 'Please correct the numbers marked in red.',
  TIFFIN_NEEDS_ITEMS: 'This tiffin is priced as the sum of its items, so add at least one item inside.',
  INVALID_UTR: 'Please enter a valid UPI reference (UTR) number.',
  UTR_ALREADY_USED: 'Another payment with this UPI reference (UTR) is already confirmed. Check both before confirming.',
  INVALID_REQUEST: 'Something went wrong. Please try again.',
  TOO_MANY_REQUESTS: 'Too many attempts. Please wait a while and try again.',
  TOO_MANY_ATTEMPTS: 'Too many wrong codes. Please wait an hour and try again.',
  INVALID_CODE: 'This code is not valid. Ask for a new one.',
  SIGN_IN_FAILED: 'Google sign-in did not finish. Try again, or use the code by email.',
  WRONG_APP: 'This code is for the other app (staff codes go in the Staff app, customer codes in the customer app). It is still valid.',
  ALREADY_LINKED: 'This person is already linked to an account.',
  CUSTOMER_ARCHIVED: 'This customer is archived.',
  INVALID_VALIDITY: 'Validity must be between 1 and 30 days.',
  INVALID_ROLE: 'Please choose a valid role.',
  CANNOT_CHANGE_OWNER: 'The owner account cannot be changed here.',
  INVALID_STAFF: 'Please choose an active delivery person.',
  INVALID_STATUS: 'This action is not possible in the current state.',
  REASON_REQUIRED: 'Please enter a reason.',
  NOTE_REQUIRED: 'Please enter a note.',
  INVALID_KIND: 'Please choose a valid type.',
  INVALID_SETTING: 'One of the settings is not valid.',
  INVALID_DUE_DAYS: 'Due days must be between 0 and 90.',
  INVALID_ADDONS: 'Please check the extras.',
  PRICE_NOT_SET: 'A price is missing. Set the price first (Menu).',
  TIFFIN_TYPE_HAS_NO_ITEMS: 'Add items to this tiffin type first.',
  TIFFIN_TYPE_NOT_FOUND: 'Tiffin type not found.',
  SLOT_NOT_CONFIGURED: 'Meal timings are not set up.',
  UNKNOWN_BOX: 'Unknown box code.',
  BOX_NOT_DELIVERED: "This box's meal hasn't been delivered yet, so it can't be collected.",
  BOX_NOT_ISSUED: 'This box was not scanned when it was packed, so we don\'t know whose it is. Use the pickup list instead.',
  SOLD_OUT: 'Sorry, this special is sold out.',
  INVALID_PLATFORM: 'This device type is not supported.',
  NOT_TODAY: 'This can only be done on the day of the meal.',
  INVALID_RANGE: 'Please choose a shorter date range.',
  DUPLICATE: 'This already exists.',
  FILE_TOO_LARGE: 'That file is too large. Please try a smaller photo or a shorter recording.',
  NETWORK: 'No internet connection. Please try again.',
  UNKNOWN: 'Something went wrong. Please try again.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

/** Extract our error code from a Supabase/PostgREST error (or any thrown value). */
export function errorCode(err: unknown): ErrorCode {
  const e = (err ?? {}) as { message?: unknown; code?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  const pgCode = typeof e.code === 'string' ? e.code : '';
  const first = message.split(/[\s:]/)[0] ?? '';
  if (first in ERROR_MESSAGES) return first as ErrorCode;
  if (pgCode === '23505' || /duplicate key/i.test(message)) return 'DUPLICATE';
  if (pgCode === '42501' || /permission denied|row-level security/i.test(message)) return 'NOT_ALLOWED';
  if (/network request failed|failed to fetch|network error/i.test(message)) return 'NETWORK';
  return 'UNKNOWN';
}

export function errorMessage(err: unknown): string {
  return ERROR_MESSAGES[errorCode(err)];
}
