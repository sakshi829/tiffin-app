/**
 * Values that must match the database enums/CHECK constraints in supabase/migrations.
 * The database is authoritative; these exist so the UI can render labels and pickers.
 */

export const BUSINESS_TIMEZONE = 'Asia/Kolkata';

export const MEAL_SLOTS = ['lunch', 'dinner'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const STAFF_ROLES = ['owner', 'kitchen', 'delivery', 'kitchen_delivery'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ORDER_STATUSES = [
  'scheduled',
  'delivered',
  'not_delivered',
  'skipped',
  'skipped_late',
  'cancelled_closure',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const SIGNUP_MODES = ['invite_only', 'request_to_join', 'open'] as const;
export type SignupMode = (typeof SIGNUP_MODES)[number];

export const LIMITS = {
  locationTextMax: 120,
  noteTextMax: 500,
  addonQtyMax: 10,
  voiceNoteSecondsMax: 30,
} as const;
