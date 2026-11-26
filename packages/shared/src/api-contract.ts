/**
 * The exact database API the apps use. supabase/tests/11-api-contract.test.mjs
 * checks every function name, parameter name and column below against the real
 * schema, so a typo or schema change fails CI instead of failing on a phone.
 */

export const RPC_PARAMS = {
  // reports
  owner_day_orders: ['p_kitchen', 'p_date'],
  owner_customer_balances: ['p_kitchen'],
  owner_customer_statement: ['p_customer', 'p_from', 'p_to'],
  // invites & staff
  owner_create_customer_invite: ['p_customer', 'p_valid_days'],
  owner_create_staff_invite: ['p_kitchen', 'p_role', 'p_display_name', 'p_valid_days'],
  owner_revoke_invite: ['p_invite'],
  owner_unlink_customer: ['p_customer'],
  owner_set_staff: ['p_staff', 'p_role', 'p_can_see_phone', 'p_active'],
  // menu
  owner_set_item_price: ['p_item', 'p_price_paise', 'p_effective_from'],
  owner_set_tiffin_price: ['p_tiffin_type', 'p_price_paise', 'p_effective_from'],
  // service
  owner_save_subscription: ['p_id', 'p_customer', 'p_meal_slot', 'p_tiffin_type', 'p_start_date', 'p_end_date',
    'p_days_of_week', 'p_location_node', 'p_location_text', 'p_status', 'p_notes', 'p_addons'],
  owner_add_closure: ['p_kitchen', 'p_date', 'p_meal_slot', 'p_reason'],
  owner_cancel_closure: ['p_closure'],
  owner_delete_location: ['p_kind', 'p_id'],
  owner_generate_orders: ['p_kitchen', 'p_from', 'p_to'],
  owner_set_order_status: ['p_order', 'p_status', 'p_reason'],
  owner_assign_orders: ['p_kitchen', 'p_orders', 'p_staff'],
  owner_set_order_addon: ['p_order', 'p_item', 'p_qty'],
  // money
  owner_record_payment: ['p_customer', 'p_amount_paise', 'p_method', 'p_utr', 'p_paid_on', 'p_note', 'p_idempotency_key'],
  owner_confirm_payment: ['p_payment'],
  owner_reject_payment: ['p_payment', 'p_reason'],
  owner_add_ledger_entry: ['p_customer', 'p_kind', 'p_amount_paise', 'p_note', 'p_order'],
  owner_generate_bill: ['p_customer', 'p_period_start', 'p_period_end', 'p_due_days'],
  owner_update_settings: ['p_kitchen', 'p'],
  // ---------------------------------------------------------------- customer app
  redeem_invite: ['p_code', 'p_expected_kind'],
  customer_accept_terms: ['p_kitchen'],
  customer_my_orders: ['p_kitchen', 'p_from', 'p_to'],
  customer_addon_menu: ['p_order'],
  customer_update_food_notes: ['p_kitchen', 'p_food_notes'],
  customer_set_location: ['p_order', 'p_location_node', 'p_location_text'],
  customer_skip_meal: ['p_order'],
  customer_unskip_meal: ['p_order'],
  customer_skip_range: ['p_kitchen', 'p_from', 'p_to', 'p_meal_slot'],
  customer_cancel_skip_range: ['p_skip'],
  customer_request_addon: ['p_order', 'p_item', 'p_qty'],
  customer_cancel_addon: ['p_addon'],
  customer_mark_box_kept: ['p_order', 'p_location_text', 'p_idempotency_key'],
  customer_submit_payment: ['p_kitchen', 'p_amount_paise', 'p_utr', 'p_paid_on', 'p_idempotency_key', 'p_note'],
  my_balance: ['p_kitchen'],
  // ---------------------------------------------------------------- staff app (+ owner box view)
  staff_my_tasks: ['p_kitchen', 'p_date', 'p_meal_slot'],
  staff_mark_delivered: ['p_order'],
  staff_mark_not_delivered: ['p_order', 'p_reason'],
  staff_box_collected: ['p_order', 'p_box_code', 'p_idempotency_key'],
  staff_box_pickups: ['p_kitchen'],
  staff_check_in: ['p_kitchen'],
  staff_check_out: ['p_kitchen'],
  owner_boxes_out: ['p_kitchen'],
  owner_box_collected: ['p_order'],
  // ---------------------------------------------------------------- notifications (all apps)
  register_device: ['p_platform', 'p_expo_push_token', 'p_web_push', 'p_label'],
  unregister_device: ['p_device'],
  forget_other_devices: ['p_keep'],
  owner_set_tiffin_items: ['p_tiffin_type', 'p_items'],
  owner_pending_payments: ['p_kitchen'],
  owner_erase_customer: ['p_customer'],
  record_sign_in: ['p_app', 'p_label'],
  owner_weekday_counts: ['p_kitchen', 'p_from', 'p_to'],
  kitchen_join_info: ['p_kitchen'],
  customer_request_to_join: ['p_kitchen', 'p_full_name', 'p_phone', 'p_location_text', 'p_note'],
  owner_decide_join: ['p_id', 'p_approve'],
  set_my_language: ['p_lang'],
  loyalty_progress: ['p_customer'],
  mark_notifications_read: ['p_ids'],
  set_notification_prefs: ['p_muted'],
  owner_send_announcement: ['p_kitchen', 'p_title', 'p_body', 'p_include_staff'],
  // ---------------------------------------------------------------- phase 5a
  owner_generate_month_bills: ['p_kitchen', 'p_month'],
  owner_schedule_announcement: ['p_kitchen', 'p_title', 'p_body', 'p_include_staff', 'p_send_at'],
  owner_cancel_announcement: ['p_id'],
  owner_set_place_staff: ['p_place', 'p_staff'],
  customer_refer_friend: ['p_kitchen', 'p_name', 'p_phone', 'p_note'],
  owner_decide_referral: ['p_id', 'p_approve'],
  customer_send_message: ['p_kitchen', 'p_body'],
  owner_send_message: ['p_customer', 'p_body'],
  chat_mark_read: ['p_customer'],
  owner_chat_threads: ['p_kitchen'],
  // ---------------------------------------------------------------- phase 5b
  staff_proof_path: ['p_order'],
  staff_attach_proof: ['p_order', 'p_path'],
  customer_attach_payment_proof: ['p_payment', 'p_path'],
  customer_send_voice: ['p_kitchen', 'p_path', 'p_seconds'],
  owner_send_voice: ['p_customer', 'p_path', 'p_seconds'],
  owner_save_special: ['p_id', 'p_kitchen', 'p_tiffin_type', 'p_date', 'p_meal_slot', 'p_deadline', 'p_max', 'p_active'],
  customer_special_menus: ['p_kitchen'],
  customer_order_special: ['p_special'],
  owner_create_boxes: ['p_kitchen', 'p_count'],
  staff_box_issued: ['p_order', 'p_box_code'],
  staff_box_scan_collect: ['p_kitchen', 'p_box_code', 'p_idempotency_key'],
  // phase 6: expenses, reports, insights
  owner_record_recurring: ['p_id'],
  owner_set_loyalty: ['p_kitchen', 'p_active', 'p_every_n_meals', 'p_reward_paise', 'p_reward_label'],
  owner_prep_totals: ['p_kitchen', 'p_date'],
  owner_profit_loss: ['p_kitchen', 'p_from', 'p_to'],
  owner_daily_series: ['p_kitchen', 'p_from', 'p_to'],
  owner_attendance: ['p_kitchen', 'p_from', 'p_to'],
  owner_insights: ['p_kitchen'],
} as const;

export type RpcName = keyof typeof RPC_PARAMS;

/** Columns the apps read or write, per table. */
export const TABLE_COLUMNS = {
  kitchens: ['id', 'name'],
  staff_members: ['id', 'kitchen_id', 'user_id', 'display_name', 'phone', 'role', 'can_see_phone', 'active'],
  business_settings: ['kitchen_id', 'display_name', 'upi_id', 'upi_qr_path', 'signup_mode', 'free_late_skips_per_month',
    'late_skip_charge_percent', 'late_fee_enabled', 'late_fee_grace_days', 'late_fee_type', 'late_fee_value',
    'low_balance_threshold_paise', 'media_retention_days', 'order_horizon_days', 'contact_phone', 'version'],
  customers: ['id', 'kitchen_id', 'user_id', 'full_name', 'phone', 'email', 'food_notes', 'default_location_node_id',
    'default_location_text', 'status', 'billing_mode', 'late_skip_free_override', 'late_skip_charge_percent_override',
    'joined_on', 'terms_accepted_at', 'erased_at', 'version'],
  items: ['id', 'kitchen_id', 'name', 'category', 'is_veg', 'unit', 'customer_orderable', 'max_qty_per_order', 'active', 'version'],
  item_prices: ['item_id', 'price_paise', 'effective_from'],
  tiffin_types: ['id', 'kitchen_id', 'name', 'description', 'is_veg', 'pricing_mode', 'active', 'is_special', 'version'],
  tiffin_type_items: ['kitchen_id', 'tiffin_type_id', 'item_id', 'qty'],
  tiffin_type_prices: ['tiffin_type_id', 'price_paise', 'effective_from'],
  subscriptions: ['id', 'customer_id', 'meal_slot', 'tiffin_type_id', 'start_date', 'end_date', 'days_of_week',
    'default_location_node_id', 'default_location_text', 'status', 'notes'],
  subscription_addons: ['subscription_id', 'item_id', 'qty'],
  meal_slots: ['id', 'kitchen_id', 'meal_slot', 'delivery_time', 'addon_cutoff_mode', 'addon_cutoff_minutes', 'addon_cutoff_time',
    'location_cutoff_mode', 'location_cutoff_minutes', 'location_cutoff_time', 'active', 'version'],
  slot_overrides: ['kitchen_id', 'override_date', 'meal_slot', 'delivery_time', 'addon_cutoff_time', 'location_cutoff_time', 'note'],
  closures: ['id', 'kitchen_id', 'closure_date', 'meal_slot', 'reason', 'cancelled_at'],
  places: ['id', 'kitchen_id', 'name', 'kind', 'active'],
  location_nodes: ['id', 'kitchen_id', 'place_id', 'parent_id', 'name', 'kind', 'directions', 'directions_photo_path', 'active'],
  payments: ['id', 'customer_id', 'amount_paise', 'method', 'utr', 'paid_on', 'status', 'submitted_by_role', 'note', 'rejected_reason', 'proof_path', 'created_at'],
  invites: ['id', 'kind', 'customer_id', 'staff_role', 'staff_display_name', 'expires_at', 'used_at', 'revoked_at', 'created_at'],
  daily_menu: ['kitchen_id', 'menu_date', 'meal_slot', 'description'],
  // customer app (own rows only, enforced by RLS)
  customer_skips: ['id', 'customer_id', 'from_date', 'to_date', 'meal_slot', 'created_by_role', 'cancelled_at', 'created_at'],
  ledger_entries: ['id', 'customer_id', 'entry_date', 'kind', 'amount_paise', 'note', 'created_at'],
  customer_saved_locations: ['id', 'location_node_id', 'location_text', 'last_used_at'],
  // staff app
  staff_shifts: ['id', 'staff_id', 'started_at', 'ended_at'],
  packing_instructions: ['tiffin_type_id', 'kitchen_id', 'instructions', 'photo_path'],
  // notifications
  notifications: ['id', 'kind', 'title', 'body', 'data', 'created_at', 'read_at'],
  notification_prefs: ['user_id', 'muted_kinds'],
  // phase 5a
  announcements: ['id', 'title', 'body', 'include_staff', 'send_at', 'sent_at', 'sent_count', 'cancelled_at'],
  place_delivery_staff: ['place_id', 'staff_id'],
  referral_requests: ['id', 'referrer_customer_id', 'friend_name', 'friend_phone', 'note', 'status', 'created_customer_id', 'created_at'],
  chat_messages: ['id', 'customer_id', 'sender_role', 'body', 'created_at', 'read_at', 'voice_path', 'voice_seconds'],
  // phase 5b
  delivery_proofs: ['order_id', 'customer_id', 'path', 'created_at'],
  special_menus: ['id', 'tiffin_type_id', 'menu_date', 'meal_slot', 'order_deadline', 'max_orders', 'active'],
  // phase 6 (owner only)
  expense_categories: ['id', 'kitchen_id', 'name', 'default_kind', 'active'],
  expenses: ['id', 'kitchen_id', 'expense_date', 'category_id', 'kind', 'amount_paise', 'vendor', 'method', 'note', 'receipt_path',
    'staff_member_id', 'archived_at', 'created_at', 'version'],
  recurring_expenses: ['id', 'kitchen_id', 'title', 'category_id', 'kind', 'amount_paise', 'vendor', 'method', 'every', 'next_due', 'active'],
  budgets: ['kitchen_id', 'category_id', 'amount_paise'],
  ingredients: ['id', 'kitchen_id', 'name', 'unit', 'active'],
  item_ingredients: ['kitchen_id', 'item_id', 'ingredient_id', 'qty'],
  waste_entries: ['id', 'kitchen_id', 'entry_date', 'meal_slot', 'tiffins', 'note', 'created_at'],
  loyalty_rules: ['kitchen_id', 'active', 'every_n_meals', 'reward_paise', 'reward_label'],
  loyalty_rewards: ['customer_id', 'milestone', 'ledger_entry_id', 'created_at'],
  join_requests: ['id', 'kitchen_id', 'user_id', 'full_name', 'phone', 'location_text', 'note', 'status', 'created_customer_id', 'decided_at', 'created_at'],
} as const;

export type TableName = keyof typeof TABLE_COLUMNS;

/** Comma-separated column list for `.select(...)`. */
export function cols<T extends TableName>(table: T): string {
  return TABLE_COLUMNS[table].join(',');
}
