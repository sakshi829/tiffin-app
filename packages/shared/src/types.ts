/** Row shapes the apps work with (match TABLE_COLUMNS / report functions). */
import type { IsoDate } from './dates.ts';
import type { MealSlot, OrderStatus, StaffRole, SignupMode } from './constants.ts';

export type Uuid = string;

export interface StaffMember {
  id: Uuid; kitchen_id: Uuid; user_id: Uuid; display_name: string; phone: string | null;
  role: StaffRole; can_see_phone: boolean; active: boolean;
}

export interface BusinessSettings {
  kitchen_id: Uuid; display_name: string; upi_id: string | null; upi_qr_path: string | null; signup_mode: SignupMode;
  free_late_skips_per_month: number; late_skip_charge_percent: number;
  late_fee_enabled: boolean; late_fee_grace_days: number; late_fee_type: 'flat' | 'percent'; late_fee_value: number;
  low_balance_threshold_paise: number; media_retention_days: number; order_horizon_days: number; contact_phone: string | null;
  version: number;
}

// ---------------------------------------------------------------- phase 5a
export interface ChatMessage {
  id: Uuid; customer_id: Uuid; sender_role: 'customer' | 'owner'; body: string; created_at: string; read_at: string | null;
  voice_path: string | null; voice_seconds: number | null;
}

export interface SpecialMenu { id: Uuid; tiffin_type_id: Uuid; menu_date: IsoDate; meal_slot: MealSlot; order_deadline: string; max_orders: number | null; active: boolean }
/** Row of customer_special_menus(). */
export interface SpecialOffer {
  special_id: Uuid; name: string; description: string | null; is_veg: boolean; menu_date: IsoDate; meal_slot: MealSlot;
  price_paise: number; order_deadline: string; my_order_id: Uuid | null; remaining: number | null;
}
export interface ChatThread { customer_id: Uuid; full_name: string; last_body: string; last_at: string; last_from: 'customer' | 'owner'; unread: number }
export interface ReferralRequest {
  id: Uuid; referrer_customer_id: Uuid; friend_name: string; friend_phone: string; note: string | null;
  status: 'pending' | 'approved' | 'rejected'; created_customer_id: Uuid | null; created_at: string;
}
export interface Announcement {
  id: Uuid; title: string; body: string; include_staff: boolean; send_at: string; sent_at: string | null;
  sent_count: number | null; cancelled_at: string | null;
}

export type CustomerStatus = 'active' | 'paused' | 'stopped' | 'archived';

export interface Customer {
  id: Uuid; kitchen_id: Uuid; user_id: Uuid | null; full_name: string; phone: string | null; email: string | null;
  food_notes: string | null; default_location_node_id: Uuid | null; default_location_text: string | null;
  status: CustomerStatus; billing_mode: 'postpaid' | 'advance';
  late_skip_free_override: number | null; late_skip_charge_percent_override: number | null;
  joined_on: IsoDate; terms_accepted_at: string | null; erased_at: string | null; version: number;
}

export interface Item {
  id: Uuid; kitchen_id: Uuid; name: string; category: 'main' | 'addon'; is_veg: boolean; unit: string;
  customer_orderable: boolean; max_qty_per_order: number; active: boolean; version: number;
}

export interface PriceRow { price_paise: number; effective_from: IsoDate }
export interface ItemPrice extends PriceRow { item_id: Uuid }
export interface TiffinTypePrice extends PriceRow { tiffin_type_id: Uuid }

export interface TiffinType {
  id: Uuid; kitchen_id: Uuid; name: string; description: string | null; is_veg: boolean;
  pricing_mode: 'fixed' | 'sum_of_items'; active: boolean; is_special: boolean; version: number;
}

export interface TiffinTypeItem { kitchen_id: Uuid; tiffin_type_id: Uuid; item_id: Uuid; qty: number }

export interface Subscription {
  id: Uuid; customer_id: Uuid; meal_slot: MealSlot; tiffin_type_id: Uuid; start_date: IsoDate; end_date: IsoDate | null;
  days_of_week: number[]; default_location_node_id: Uuid | null; default_location_text: string | null;
  status: 'active' | 'paused' | 'ended'; notes: string | null;
}

export interface SubscriptionAddon { subscription_id: Uuid; item_id: Uuid; qty: number }

export interface MealSlotRow {
  id: Uuid; kitchen_id: Uuid; meal_slot: MealSlot; delivery_time: string;
  addon_cutoff_mode: 'relative' | 'fixed'; addon_cutoff_minutes: number; addon_cutoff_time: string | null;
  location_cutoff_mode: 'relative' | 'fixed'; location_cutoff_minutes: number; location_cutoff_time: string | null;
  active: boolean; version: number;
}

export interface Closure { id: Uuid; kitchen_id: Uuid; closure_date: IsoDate; meal_slot: MealSlot | null; reason: string | null; cancelled_at: string | null }

export interface Place { id: Uuid; kitchen_id: Uuid; name: string; kind: string; active: boolean }
export interface LocationNode {
  id: Uuid; kitchen_id: Uuid; place_id: Uuid; parent_id: Uuid | null; name: string; kind: string; directions: string | null;
  directions_photo_path: string | null; active: boolean;
}

export interface Payment {
  id: Uuid; customer_id: Uuid; amount_paise: number; method: 'cash' | 'upi' | 'bank' | 'other'; utr: string | null;
  paid_on: IsoDate; status: 'submitted' | 'confirmed' | 'rejected'; submitted_by_role: 'customer' | 'owner';
  note: string | null; rejected_reason: string | null; proof_path: string | null; created_at: string;
}

export interface DayOrderAddon { item_id: Uuid; name: string; qty: number; unit_price_paise: number }

/** Row of owner_day_orders(). */
export interface DayOrder {
  order_id: Uuid; meal_slot: MealSlot; status: OrderStatus; customer_id: Uuid; customer_name: string;
  customer_phone: string | null; food_notes: string | null; tiffin_type_id: Uuid; tiffin_type_name: string;
  is_veg: boolean; unit_price_paise: number; addons: DayOrderAddon[]; location_text: string | null;
  location_path: string | null; location_updated_at: string | null; assigned_staff_id: Uuid | null;
  assigned_staff_name: string | null; delivered_at: string | null; not_delivered_reason: string | null;
  late_skip_charged: boolean;
}

/** Row of owner_customer_balances(). */
export interface CustomerBalance {
  customer_id: Uuid; full_name: string; phone: string | null; status: CustomerStatus; billing_mode: 'postpaid' | 'advance';
  linked: boolean; balance_paise: number; last_payment_on: IsoDate | null; pending_payments: number;
}

// ---------------------------------------------------------------- customer app
export interface MyAddon { addon_id: Uuid; item_id: Uuid; name: string; qty: number; unit_price_paise: number; requested_by_role: 'customer' | 'owner' | 'subscription' }

/** Row of customer_my_orders(). Times are ISO timestamps computed by the server. */
export interface MyOrder {
  order_id: Uuid; order_date: IsoDate; meal_slot: MealSlot; status: OrderStatus; tiffin_type_id: Uuid; tiffin_type_name: string;
  is_veg: boolean; unit_price_paise: number; addons: MyAddon[]; location_node_id: Uuid | null; location_text: string | null;
  location_path: string | null; location_updated_at: string | null; delivery_at: string; addon_cutoff_at: string;
  location_cutoff_at: string; late_skip_charged: boolean; delivered_at: string | null; box_kept_at: string | null;
}

/** Row of customer_addon_menu(). */
export interface AddonMenuItem { item_id: Uuid; name: string; is_veg: boolean; unit: string; max_qty: number; price_paise: number }

export interface CustomerSkip {
  id: Uuid; customer_id: Uuid; from_date: IsoDate; to_date: IsoDate; meal_slot: MealSlot | null;
  created_by_role: 'customer' | 'owner'; cancelled_at: string | null; created_at: string;
}

export interface LedgerEntry { id: Uuid; customer_id: Uuid; entry_date: IsoDate; kind: string; amount_paise: number; note: string | null; created_at: string }

export interface SavedLocation { id: Uuid; location_node_id: Uuid | null; location_text: string | null; last_used_at: string }

// ---------------------------------------------------------------- staff app
/** Row of staff_my_tasks(). Phone is null unless the owner allowed it (today's deliveries only). */
export interface StaffTask {
  task: 'pack' | 'deliver'; order_id: Uuid; order_date: IsoDate; meal_slot: MealSlot; status: OrderStatus;
  customer_name: string; customer_phone: string | null; food_notes: string | null; tiffin_type_name: string;
  is_veg: boolean; addons: { name: string; qty: number }[]; location_text: string | null; location_path: string | null;
  location_directions: string | null; location_updated_at: string | null; location_photo_path: string | null;
}

/** Row of staff_box_pickups() / owner_boxes_out(). */
export interface BoxOut {
  order_id: Uuid; order_date: IsoDate; meal_slot: MealSlot; customer_id?: Uuid; customer_name: string;
  location_path: string | null; location_text: string | null; kept_at: string | null; kept_at_time: string | null; days_out: number;
}

export interface StaffShift { id: Uuid; staff_id: Uuid; started_at: string; ended_at: string | null }

export interface StatementEntry { id: Uuid; entry_date: IsoDate; kind: string; amount_paise: number; note: string | null; order_id: Uuid | null; created_at: string }
export interface Statement { customer_id: Uuid; full_name: string; from: IsoDate; to: IsoDate; opening_paise: number; entries: StatementEntry[]; closing_paise: number }

// ---------------------------------------------------------------- phase 6
export type ExpenseKind = 'running' | 'investment';
export type PayMethod = 'cash' | 'upi' | 'bank' | 'card' | 'other';
export interface ExpenseCategory { id: Uuid; kitchen_id: Uuid; name: string; default_kind: ExpenseKind; active: boolean }
export interface Expense {
  id: Uuid; kitchen_id: Uuid; expense_date: IsoDate; category_id: Uuid; kind: ExpenseKind; amount_paise: number;
  vendor: string | null; method: PayMethod; note: string | null; receipt_path: string | null; staff_member_id: Uuid | null;
  archived_at: string | null; created_at: string; version: number;
}
export interface RecurringExpense {
  id: Uuid; kitchen_id: Uuid; title: string; category_id: Uuid; kind: ExpenseKind; amount_paise: number; vendor: string | null;
  method: PayMethod; every: 'weekly' | 'monthly'; next_due: IsoDate; active: boolean;
}
export interface Budget { kitchen_id: Uuid; category_id: Uuid; amount_paise: number }
export type IngredientUnit = 'kg' | 'g' | 'l' | 'ml' | 'pcs';
export interface Ingredient { id: Uuid; kitchen_id: Uuid; name: string; unit: IngredientUnit; active: boolean }
export interface ItemIngredient { kitchen_id: Uuid; item_id: Uuid; ingredient_id: Uuid; qty: number }
export interface WasteEntry { id: Uuid; kitchen_id: Uuid; entry_date: IsoDate; meal_slot: MealSlot; tiffins: number; note: string | null; created_at: string }
export interface LoyaltyRules { kitchen_id: Uuid; active: boolean; every_n_meals: number; reward_paise: number; reward_label: string }
/** Row of owner_prep_totals(). */
export interface PrepRow { kind: 'item' | 'ingredient'; name: string; unit: string; qty: number }
/** Row of owner_daily_series(). */
export interface DailyPoint { day: IsoDate; meals: number; billed_paise: number; expenses_paise: number }
/** Row of owner_attendance(). */
export interface AttendanceRow { staff_id: Uuid; display_name: string; shifts: number; minutes: number }

/** Owner's "to confirm" list (owner_pending_payments). same_utr_count = other non-rejected payments with this UTR. */
export interface PendingPayment {
  id: Uuid; customer_id: Uuid; customer_name: string | null; amount_paise: number; method: string; utr: string | null;
  paid_on: IsoDate; proof_path: string | null; note: string | null; created_at: string; same_utr_count: number;
}

/** owner_weekday_counts: weekday 1 = Monday .. 7 = Sunday; days = how many such weekdays are in the range. */
export interface WeekdayCount { weekday: number; meal_slot: MealSlot; delivered: number; skipped: number; days: number }

/** Someone without an invite who asked to join (owner sees their kitchen's; the person sees their own). */
export interface JoinRequest {
  id: Uuid; kitchen_id: Uuid; user_id: Uuid; full_name: string; phone: string; location_text: string | null; note: string | null;
  status: 'pending' | 'approved' | 'rejected'; created_customer_id: Uuid | null; decided_at: string | null; created_at: string;
}

/** loyalty_progress(): how far a customer is from the next reward. */
export type LoyaltyProgress = { active: false } | {
  active: true; delivered: number; every_n: number; toward_next: number; to_go: number;
  reward_label: string; reward_paise: number; rewards_given: number;
};
