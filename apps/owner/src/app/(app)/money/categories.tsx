import { useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { formatRupees, istToday, monthRange, parseRupeesToPaise, type ExpenseCategory, type ExpenseKind } from '@amruta/shared';
import { getSupabase } from '../../../lib/supabase';
import { AppError, run } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useRefreshAll } from '../../../lib/queries';
import { useBudgets, useExpenseCategories, useProfitLoss } from '../../../lib/finance';
import { Badge, Button, Card, Chips, ErrorText, Field, H2, ListRow, Loading, Muted, RowWrap, Screen, useAction } from '../../../ui/kit';
import { useT } from '@amruta/app-core';

/** Expense categories and a monthly budget per category (the insights warn when one is exceeded). */
export default function Categories() {
  const tr = useT();
  const { kitchenId } = useOwner();
  const cats = useExpenseCategories();
  const budgets = useBudgets();
  const month = monthRange(istToday());
  const pl = useProfitLoss(month.from, istToday());
  const refreshAll = useRefreshAll();
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ExpenseKind>('running');

  const add = useAction(async () => {
    if (!name.trim()) throw new AppError('INVALID_REQUEST');
    await run(getSupabase().from('expense_categories').insert({ kitchen_id: kitchenId, name: name.trim(), default_kind: kind }).select('id').single());
    setName('');
    await refreshAll();
  });

  if (cats.isLoading || budgets.isLoading) return <Loading />;
  const budgetOf = new Map((budgets.data ?? []).map((b) => [b.category_id, b.amount_paise]));
  const spentOf = new Map((pl.data?.by_category ?? []).map((c) => [c.name, Number(c.amount_paise)]));
  return (
    <Screen refreshing={cats.isFetching} onRefresh={() => { void cats.refetch(); void budgets.refetch(); void pl.refetch(); }}>
      <Stack.Screen options={{ title: tr('Categories & budgets') }} />
      <Muted>{tr('Tap a category to set a monthly budget or rename it. "Spent" is this month so far.')}</Muted>
      <ErrorText error={cats.error ?? budgets.error} />
      <Card>
        {(cats.data ?? []).map((c) => {
          const budget = budgetOf.get(c.id);
          const spent = spentOf.get(c.name) ?? 0;
          return (
            <View key={c.id}>
              <ListRow title={c.name}
                subtitle={[c.default_kind === 'investment' ? tr('Investment') : tr('Running'), tr('spent {amount}', { amount: formatRupees(spent) }),
                  budget ? tr('budget {amount}', { amount: formatRupees(budget) }) : ''].filter(Boolean).join(' · ')}
                right={!c.active ? <Badge text={tr('Hidden')} /> : budget && spent > budget ? <Badge text={tr('Over')} tone="warn" /> : undefined}
                onPress={() => setOpen(open === c.id ? null : c.id)} />
              {open === c.id ? <CategoryEdit c={c} budget={budget ?? null} onDone={() => setOpen(null)} /> : null}
            </View>
          );
        })}
      </Card>
      <Card>
        <H2>{tr('New category')}</H2>
        <Field label={tr('Name')} value={name} onChangeText={setName} maxLength={60} placeholder={tr('e.g. Sweets, Cleaning')} />
        <Chips value={kind} onChange={setKind} options={[{ value: 'running', label: 'Running cost' }, { value: 'investment', label: 'Investment' }]} />
        <ErrorText error={add.error} />
        <Button small title={tr('Add category')} loading={add.busy} onPress={() => void add.run()} />
      </Card>
    </Screen>
  );
}

function CategoryEdit({ c, budget, onDone }: { c: ExpenseCategory; budget: number | null; onDone: () => void }) {
  const tr = useT();
  const { kitchenId } = useOwner();
  const refreshAll = useRefreshAll();
  const [name, setName] = useState(c.name);
  const [amount, setAmount] = useState(budget ? String(budget / 100) : '');
  const save = useAction(async () => {
    const db = getSupabase();
    if (name.trim() && name.trim() !== c.name) {
      await run(db.from('expense_categories').update({ name: name.trim() }).eq('id', c.id).select('id').single());
    }
    const paise = amount.trim() ? parseRupeesToPaise(amount) : null;
    if (amount.trim() && (paise === null || paise <= 0)) throw new AppError('INVALID_AMOUNT');
    if (paise && budget) await run(db.from('budgets').update({ amount_paise: paise }).eq('category_id', c.id).select('category_id').single());
    else if (paise) await run(db.from('budgets').insert({ kitchen_id: kitchenId, category_id: c.id, amount_paise: paise }).select('category_id').single());
    else if (budget) await run(db.from('budgets').delete().eq('category_id', c.id).select('category_id').single());
    await refreshAll();
    onDone();
  });
  const toggle = useAction(async () => {
    await run(getSupabase().from('expense_categories').update({ active: !c.active }).eq('id', c.id).select('id').single());
    await refreshAll();
    onDone();
  });
  return (
    <View style={{ gap: 8, paddingVertical: 8 }}>
      <Field label={tr('Name')} value={name} onChangeText={setName} maxLength={60} />
      <Field label={tr('Monthly budget ₹ (empty = none)')} value={amount} onChangeText={setAmount} numeric="money" />
      <RowWrap>
        <Button small title={tr('Save')} loading={save.busy} onPress={() => void save.run()} />
        <Button small variant="ghost" title={c.active ? tr('Hide category') : tr('Show again')} loading={toggle.busy} onPress={() => void toggle.run()} />
      </RowWrap>
      <ErrorText error={save.error ?? toggle.error} />
    </View>
  );
}
