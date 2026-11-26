import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cols, istToday, type Announcement, type BoxOut, type ChatMessage, type ChatThread, type ReferralRequest, type StaffShift, type BusinessSettings, type Closure, type Customer, type CustomerBalance, type DayOrder, type Item,
  type ItemPrice, type LocationNode, type MealSlotRow, type Payment, type PendingPayment, type Place, type PriceRow, type StaffMember,
  type Subscription, type SubscriptionAddon, type TiffinType, type TiffinTypeItem, type TiffinTypePrice,
} from '@amruta/shared';
import { getSupabase } from './supabase';
import { rpc, run } from './api';
import { useOwner } from './auth';

// All owner data lives under ['owner', kitchenId, ...]; after any change we
// refresh that whole tree (the data set of a home kitchen is small).
export function useRefreshAll() {
  const qc = useQueryClient();
  const { kitchenId } = useOwner();
  return () => qc.invalidateQueries({ queryKey: ['owner', kitchenId] });
}

function useK() {
  return useOwner().kitchenId;
}

const db = () => getSupabase();

// ------------------------------------------------------------------ prices
export function priceOn<T extends PriceRow>(prices: readonly T[], date: string): T | undefined {
  return [...prices].filter((p) => p.effective_from <= date).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
}
export function upcomingPrice<T extends PriceRow>(prices: readonly T[], date: string): T | undefined {
  return [...prices].filter((p) => p.effective_from > date).sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];
}

// ------------------------------------------------------------------ queries
export function useSettings() {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'settings'],
    queryFn: () => run<BusinessSettings>(db().from('business_settings').select(cols('business_settings')).eq('kitchen_id', k).single()),
  });
}

export function useMealSlots() {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'meal_slots'],
    queryFn: () => run<MealSlotRow[]>(db().from('meal_slots').select(cols('meal_slots')).eq('kitchen_id', k).order('meal_slot')),
  });
}

export function useSlotOverrides() {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'slot_overrides'],
    queryFn: () => run<{ kitchen_id: string; override_date: string; meal_slot: string; delivery_time: string | null;
      addon_cutoff_time: string | null; location_cutoff_time: string | null; note: string | null }[]>(
      db().from('slot_overrides').select(cols('slot_overrides')).eq('kitchen_id', k).gte('override_date', istToday()).order('override_date')),
  });
}

export interface ItemWithPrices extends Item { prices: ItemPrice[] }
export function useItems() {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'items'],
    queryFn: async (): Promise<ItemWithPrices[]> => {
      const [items, prices] = await Promise.all([
        run<Item[]>(db().from('items').select(cols('items')).eq('kitchen_id', k).order('name')),
        run<ItemPrice[]>(db().from('item_prices').select(cols('item_prices')).eq('kitchen_id', k)),
      ]);
      return items.map((i) => ({ ...i, prices: prices.filter((p) => p.item_id === i.id) }));
    },
  });
}

export interface TiffinWithDetails extends TiffinType { items: TiffinTypeItem[]; prices: TiffinTypePrice[] }
export function useTiffinTypes() {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'tiffin_types'],
    queryFn: async (): Promise<TiffinWithDetails[]> => {
      const [types, items, prices] = await Promise.all([
        run<TiffinType[]>(db().from('tiffin_types').select(cols('tiffin_types')).eq('kitchen_id', k).order('name')),
        run<TiffinTypeItem[]>(db().from('tiffin_type_items').select(cols('tiffin_type_items')).eq('kitchen_id', k)),
        run<TiffinTypePrice[]>(db().from('tiffin_type_prices').select(cols('tiffin_type_prices')).eq('kitchen_id', k)),
      ]);
      return types.map((t) => ({
        ...t,
        items: items.filter((x) => x.tiffin_type_id === t.id),
        prices: prices.filter((p) => p.tiffin_type_id === t.id),
      }));
    },
  });
}

export function useBalances() {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'balances'],
    queryFn: async () => (await rpc<CustomerBalance[]>('owner_customer_balances', { p_kitchen: k }))
      .map((r) => ({ ...r, balance_paise: Number(r.balance_paise) })),
  });
}

export function useCustomer(id: string | undefined) {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'customer', id],
    enabled: !!id,
    queryFn: () => run<Customer>(db().from('customers').select(cols('customers')).eq('id', id!).single()),
  });
}

export interface SubscriptionWithAddons extends Subscription { addons: SubscriptionAddon[] }
export function useSubscriptions(customerId: string | undefined) {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'subscriptions', customerId],
    enabled: !!customerId,
    queryFn: async (): Promise<SubscriptionWithAddons[]> => {
      const subs = await run<Subscription[]>(db().from('subscriptions').select(cols('subscriptions'))
        .eq('customer_id', customerId!).order('start_date', { ascending: false }));
      if (subs.length === 0) return [];
      const addons = await run<SubscriptionAddon[]>(db().from('subscription_addons').select(cols('subscription_addons'))
        .in('subscription_id', subs.map((s) => s.id)));
      return subs.map((s) => ({ ...s, addons: addons.filter((a) => a.subscription_id === s.id) }));
    },
  });
}

export function useDayOrders(date: string) {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'day', date],
    queryFn: async () => (await rpc<DayOrder[]>('owner_day_orders', { p_kitchen: k, p_date: date }))
      .map((o) => ({ ...o, unit_price_paise: Number(o.unit_price_paise) })),
  });
}

export function usePendingPayments() {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'payments', 'submitted'],
    // Includes how many OTHER payments carry the same UTR (a repeated UTR is accepted, then flagged here).
    queryFn: async () => (await rpc<PendingPayment[]>('owner_pending_payments', { p_kitchen: k }))
      .map((p) => ({ ...p, amount_paise: Number(p.amount_paise), same_utr_count: Number(p.same_utr_count) })),
  });
}

export function useRecentPayments(customerId: string | undefined) {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'payments', 'customer', customerId],
    enabled: !!customerId,
    queryFn: () => run<Payment[]>(db().from('payments').select(cols('payments')).eq('customer_id', customerId!)
      .order('created_at', { ascending: false }).limit(10)),
  });
}

export function useClosures() {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'closures'],
    queryFn: () => run<Closure[]>(db().from('closures').select(cols('closures')).eq('kitchen_id', k)
      .is('cancelled_at', null).gte('closure_date', istToday()).order('closure_date')),
  });
}

export function usePlaces() {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'places'],
    queryFn: async () => {
      const [places, nodes] = await Promise.all([
        run<Place[]>(db().from('places').select(cols('places')).eq('kitchen_id', k).order('name')),
        run<LocationNode[]>(db().from('location_nodes').select(cols('location_nodes')).eq('kitchen_id', k).order('name')),
      ]);
      return { places, nodes };
    },
  });
}

export { nodePath } from '@amruta/shared';

export function useStaff() {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'staff'],
    queryFn: () => run<StaffMember[]>(db().from('staff_members').select(cols('staff_members')).eq('kitchen_id', k).order('display_name')),
  });
}

export function useBoxesOut() {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'boxes_out'],
    queryFn: () => rpc<BoxOut[]>('owner_boxes_out', { p_kitchen: k }),
  });
}

/** Open shifts (who is working right now). */
export function useOpenShifts() {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'open_shifts'],
    queryFn: () => run<StaffShift[]>(db().from('staff_shifts').select(cols('staff_shifts')).eq('kitchen_id', k).is('ended_at', null)),
  });
}

export function usePackingInstruction(tiffinTypeId: string | undefined) {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'packing', tiffinTypeId],
    enabled: !!tiffinTypeId,
    queryFn: async () => (await run<{ instructions: string; photo_path: string | null }[]>(db().from('packing_instructions')
      .select('instructions,photo_path').eq('tiffin_type_id', tiffinTypeId!)))[0] ?? null,
  });
}

export function useChatThreads() {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'chat_threads'],
    queryFn: () => rpc<ChatThread[]>('owner_chat_threads', { p_kitchen: k }),
    refetchInterval: 30_000,
  });
}

export function useChat(customerId: string | undefined) {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'chat', customerId],
    enabled: !!customerId,
    queryFn: async () => (await run<ChatMessage[]>(db().from('chat_messages').select(cols('chat_messages'))
      .eq('customer_id', customerId!).order('created_at', { ascending: false }).limit(200))).reverse(),
    refetchInterval: 15_000,
  });
}

export function useReferrals() {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'referrals'],
    queryFn: () => run<ReferralRequest[]>(db().from('referral_requests').select(cols('referral_requests'))
      .eq('kitchen_id', k).order('created_at', { ascending: false }).limit(100)),
  });
}

export function useScheduledAnnouncements() {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'announcements'],
    queryFn: () => run<Announcement[]>(db().from('announcements').select(cols('announcements'))
      .eq('kitchen_id', k).is('sent_at', null).is('cancelled_at', null).order('send_at')),
  });
}

export function usePlaceStaff() {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'place_staff'],
    queryFn: () => run<{ place_id: string; staff_id: string }[]>(db().from('place_delivery_staff').select(cols('place_delivery_staff')).eq('kitchen_id', k)),
  });
}

export function useDailyMenu(date: string) {
  const k = useK();
  return useQuery({
    queryKey: ['owner', k, 'daily_menu', date],
    queryFn: () => run<{ meal_slot: string; description: string }[]>(
      db().from('daily_menu').select(cols('daily_menu')).eq('kitchen_id', k).eq('menu_date', date)),
  });
}
