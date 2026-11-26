// Phase 6 data: expenses, recurring, budgets, ingredients, waste, loyalty, reports, insights.
// Everything is owner-only in the database (RLS + owner_* functions); these hooks only read.
import { useQuery } from '@tanstack/react-query';
import {
  cols, type AttendanceRow, type Budget, type DailyPoint, type Expense, type ExpenseCategory, type Ingredient, type Insight,
  type ItemIngredient, type LoyaltyRules, type PrepRow, type ProfitLoss, type RecurringExpense, type WasteEntry, type WeekdayCount,
} from '@amruta/shared';
import { getSupabase } from './supabase';
import { rpc, run } from './api';
import { useOwner } from './auth';

const db = () => getSupabase();
const n = (v: unknown) => Number(v ?? 0);

export function useExpenseCategories() {
  const k = useOwner().kitchenId;
  return useQuery({
    queryKey: ['owner', k, 'expense_categories'],
    queryFn: () => run<ExpenseCategory[]>(db().from('expense_categories').select(cols('expense_categories')).eq('kitchen_id', k).order('name')),
  });
}

/** Expenses in a date range (archived ones hidden unless asked). */
export function useExpenses(from: string, to: string, includeArchived = false) {
  const k = useOwner().kitchenId;
  return useQuery({
    queryKey: ['owner', k, 'expenses', from, to, includeArchived],
    queryFn: async () => {
      let q = db().from('expenses').select(cols('expenses')).eq('kitchen_id', k).gte('expense_date', from).lte('expense_date', to);
      if (!includeArchived) q = q.is('archived_at', null);
      return (await run<Expense[]>(q.order('expense_date', { ascending: false }).order('created_at', { ascending: false }).limit(1000)))
        .map((e) => ({ ...e, amount_paise: n(e.amount_paise) }));
    },
  });
}

export function useExpense(id: string | undefined) {
  const k = useOwner().kitchenId;
  return useQuery({
    queryKey: ['owner', k, 'expense', id],
    enabled: !!id,
    queryFn: async () => {
      const e = await run<Expense>(db().from('expenses').select(cols('expenses')).eq('id', id!).single());
      return { ...e, amount_paise: n(e.amount_paise) };
    },
  });
}

export function useRecurring() {
  const k = useOwner().kitchenId;
  return useQuery({
    queryKey: ['owner', k, 'recurring'],
    queryFn: async () => (await run<RecurringExpense[]>(db().from('recurring_expenses').select(cols('recurring_expenses'))
      .eq('kitchen_id', k).order('next_due'))).map((r) => ({ ...r, amount_paise: n(r.amount_paise) })),
  });
}

export function useBudgets() {
  const k = useOwner().kitchenId;
  return useQuery({
    queryKey: ['owner', k, 'budgets'],
    queryFn: async () => (await run<Budget[]>(db().from('budgets').select(cols('budgets')).eq('kitchen_id', k)))
      .map((b) => ({ ...b, amount_paise: n(b.amount_paise) })),
  });
}

export function useIngredients() {
  const k = useOwner().kitchenId;
  return useQuery({
    queryKey: ['owner', k, 'ingredients'],
    queryFn: async () => {
      const [ingredients, links] = await Promise.all([
        run<Ingredient[]>(db().from('ingredients').select(cols('ingredients')).eq('kitchen_id', k).order('name')),
        run<ItemIngredient[]>(db().from('item_ingredients').select(cols('item_ingredients')).eq('kitchen_id', k)),
      ]);
      return { ingredients, links: links.map((l) => ({ ...l, qty: n(l.qty) })) };
    },
  });
}

export function useWaste(from: string, to: string) {
  const k = useOwner().kitchenId;
  return useQuery({
    queryKey: ['owner', k, 'waste', from, to],
    queryFn: () => run<WasteEntry[]>(db().from('waste_entries').select(cols('waste_entries')).eq('kitchen_id', k)
      .gte('entry_date', from).lte('entry_date', to).order('entry_date', { ascending: false })),
  });
}

export function useLoyaltyRules() {
  const k = useOwner().kitchenId;
  return useQuery({
    queryKey: ['owner', k, 'loyalty_rules'],
    queryFn: async () => {
      const rows = await run<LoyaltyRules[]>(db().from('loyalty_rules').select(cols('loyalty_rules')).eq('kitchen_id', k));
      return rows[0] ? { ...rows[0], reward_paise: n(rows[0].reward_paise) } : null;
    },
  });
}

export function usePrepTotals(date: string) {
  const k = useOwner().kitchenId;
  return useQuery({
    queryKey: ['owner', k, 'prep', date],
    queryFn: async () => (await rpc<PrepRow[]>('owner_prep_totals', { p_kitchen: k, p_date: date })).map((r) => ({ ...r, qty: n(r.qty) })),
  });
}

export function useProfitLoss(from: string, to: string) {
  const k = useOwner().kitchenId;
  return useQuery({
    queryKey: ['owner', k, 'pl', from, to],
    queryFn: () => rpc<ProfitLoss>('owner_profit_loss', { p_kitchen: k, p_from: from, p_to: to }),
  });
}

export function useWeekdayCounts(from: string, to: string) {
  const k = useOwner().kitchenId;
  return useQuery({
    queryKey: ['owner', k, 'weekday', from, to],
    queryFn: async () => (await rpc<WeekdayCount[]>('owner_weekday_counts', { p_kitchen: k, p_from: from, p_to: to }))
      .map((r) => ({ ...r, weekday: n(r.weekday), delivered: n(r.delivered), skipped: n(r.skipped), days: n(r.days) })),
  });
}

export function useDailySeries(from: string, to: string) {
  const k = useOwner().kitchenId;
  return useQuery({
    queryKey: ['owner', k, 'series', from, to],
    queryFn: async () => (await rpc<DailyPoint[]>('owner_daily_series', { p_kitchen: k, p_from: from, p_to: to }))
      .map((d) => ({ ...d, meals: n(d.meals), billed_paise: n(d.billed_paise), expenses_paise: n(d.expenses_paise) })),
  });
}

export function useAttendance(from: string, to: string) {
  const k = useOwner().kitchenId;
  return useQuery({
    queryKey: ['owner', k, 'attendance', from, to],
    queryFn: () => rpc<AttendanceRow[]>('owner_attendance', { p_kitchen: k, p_from: from, p_to: to }),
  });
}

export function useInsights() {
  const k = useOwner().kitchenId;
  return useQuery({
    queryKey: ['owner', k, 'insights'],
    queryFn: () => rpc<Insight[]>('owner_insights', { p_kitchen: k }),
    staleTime: 10 * 60_000,
  });
}

export const METHODS = [
  { value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'bank', label: 'Bank' },
  { value: 'card', label: 'Card' }, { value: 'other', label: 'Other' },
] as const;
