import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc, run } from '@amruta/app-core';
import {
  addDays, cols, istToday, type AddonMenuItem, type BusinessSettings, type ChatMessage, type Closure, type CustomerSkip,
  type LedgerEntry, type LoyaltyProgress, type ReferralRequest,
  type LocationNode, type MealSlotRow, type MyOrder, type Payment, type Place, type SavedLocation,
} from '@amruta/shared';
import { getSupabase } from './supabase';
import { useMe } from './auth';

const db = () => getSupabase();

function useK() {
  return useMe().kitchenId;
}

/** After any change, refresh this customer's data. */
export function useRefreshAll() {
  const qc = useQueryClient();
  const k = useK();
  return () => qc.invalidateQueries({ queryKey: ['me', k] });
}

/** Current time, ticking every 30 s (for countdowns and enabling buttons). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useMyOrders(from: string, to: string) {
  const k = useK();
  return useQuery({
    queryKey: ['me', k, 'orders', from, to],
    queryFn: async () => (await rpc<MyOrder[]>('customer_my_orders', { p_kitchen: k, p_from: from, p_to: to }))
      .map((o) => ({ ...o, unit_price_paise: Number(o.unit_price_paise) })),
  });
}

/** Today .. today + 7 (the window the kitchen plans). */
export function useUpcomingOrders() {
  const today = istToday();
  return useMyOrders(addDays(today, -1), addDays(today, 7));
}

export function useAddonMenu(orderId: string | undefined) {
  const k = useK();
  return useQuery({
    queryKey: ['me', k, 'addon_menu', orderId],
    enabled: !!orderId,
    queryFn: async () => (await rpc<AddonMenuItem[]>('customer_addon_menu', { p_order: orderId }))
      .map((m) => ({ ...m, price_paise: Number(m.price_paise) })),
  });
}

export function useSettings() {
  const k = useK();
  return useQuery({
    queryKey: ['me', k, 'settings'],
    queryFn: () => run<BusinessSettings>(db().from('business_settings').select(cols('business_settings')).eq('kitchen_id', k).single()),
  });
}

export function useMealSlots() {
  const k = useK();
  return useQuery({
    queryKey: ['me', k, 'meal_slots'],
    queryFn: () => run<MealSlotRow[]>(db().from('meal_slots').select(cols('meal_slots')).eq('kitchen_id', k)),
  });
}

export function useDailyMenus(from: string, to: string) {
  const k = useK();
  return useQuery({
    queryKey: ['me', k, 'daily_menu', from, to],
    queryFn: () => run<{ menu_date: string; meal_slot: string; description: string }[]>(
      db().from('daily_menu').select(cols('daily_menu')).eq('kitchen_id', k).gte('menu_date', from).lte('menu_date', to)),
  });
}

export function useClosures() {
  const k = useK();
  return useQuery({
    queryKey: ['me', k, 'closures'],
    queryFn: () => run<Closure[]>(db().from('closures').select(cols('closures')).eq('kitchen_id', k)
      .is('cancelled_at', null).gte('closure_date', istToday()).order('closure_date')),
  });
}

export function useMySkips() {
  const k = useK();
  return useQuery({
    queryKey: ['me', k, 'skips'],
    queryFn: () => run<CustomerSkip[]>(db().from('customer_skips').select(cols('customer_skips'))
      .is('cancelled_at', null).gte('to_date', istToday()).order('from_date')),
  });
}

export function useBalance() {
  const k = useK();
  return useQuery({
    queryKey: ['me', k, 'balance'],
    queryFn: async () => Number(await rpc<number>('my_balance', { p_kitchen: k })),
  });
}

export function useLedger() {
  const k = useK();
  return useQuery({
    queryKey: ['me', k, 'ledger'],
    queryFn: async () => (await run<LedgerEntry[]>(db().from('ledger_entries').select(cols('ledger_entries'))
      .gte('entry_date', addDays(istToday(), -60)).order('entry_date', { ascending: false }).order('created_at', { ascending: false })))
      .map((e) => ({ ...e, amount_paise: Number(e.amount_paise) })),
  });
}

export function useMyPayments() {
  const k = useK();
  return useQuery({
    queryKey: ['me', k, 'payments'],
    queryFn: () => run<Payment[]>(db().from('payments').select(cols('payments')).order('created_at', { ascending: false }).limit(20)),
  });
}

export function usePlaces() {
  const k = useK();
  return useQuery({
    queryKey: ['me', k, 'places'],
    queryFn: async () => {
      const [places, nodes] = await Promise.all([
        run<Place[]>(db().from('places').select(cols('places')).eq('kitchen_id', k).eq('active', true).order('name')),
        run<LocationNode[]>(db().from('location_nodes').select(cols('location_nodes')).eq('kitchen_id', k).eq('active', true).order('name')),
      ]);
      return { places, nodes };
    },
  });
}

export function useSavedLocations() {
  const k = useK();
  return useQuery({
    queryKey: ['me', k, 'saved_locations'],
    queryFn: () => run<SavedLocation[]>(db().from('customer_saved_locations').select(cols('customer_saved_locations'))
      .order('last_used_at', { ascending: false }).limit(6)),
  });
}

export { nodePath } from '@amruta/shared';

export function useMyChat() {
  const { kitchenId } = useMe();
  return useQuery({
    queryKey: ['me', kitchenId, 'chat'],
    queryFn: async () => (await run<ChatMessage[]>(db().from('chat_messages').select(cols('chat_messages'))
      .order('created_at', { ascending: false }).limit(200))).reverse(),
    refetchInterval: 15_000,
  });
}

export function useMyReferrals() {
  const { kitchenId } = useMe();
  return useQuery({
    queryKey: ['me', kitchenId, 'referrals'],
    queryFn: () => run<ReferralRequest[]>(db().from('referral_requests').select(cols('referral_requests')).order('created_at', { ascending: false })),
  });
}

/** Progress toward the next loyalty reward (only shown while the kitchen has it switched on). */
export function useLoyaltyProgress() {
  const { customer } = useMe();
  return useQuery({
    queryKey: ['me', customer.id, 'loyalty'],
    queryFn: () => rpc<LoyaltyProgress>('loyalty_progress', { p_customer: customer.id }),
  });
}
