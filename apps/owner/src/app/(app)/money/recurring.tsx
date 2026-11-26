import { useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { formatDate, formatRupees, isIsoDate, istToday, parseRupeesToPaise, type PayMethod, type RecurringExpense } from '@amruta/shared';
import { getSupabase } from '../../../lib/supabase';
import { AppError, rpc, run } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useRefreshAll } from '../../../lib/queries';
import { METHODS, useExpenseCategories, useRecurring } from '../../../lib/finance';
import { Badge, Body, Button, Card, Chips, DateField, Empty, ErrorText, Field, H2, ListRow, Loading, Muted, RowWrap, Screen, useAction } from '../../../ui/kit';
import { useT } from '@amruta/app-core';

/** Rent, gas cylinder, salaries...: a reminder when due, one tap to record. */
export default function Recurring() {
  const tr = useT();
  const { kitchenId } = useOwner();
  const list = useRecurring();
  const cats = useExpenseCategories();
  const refreshAll = useRefreshAll();
  const catName = new Map((cats.data ?? []).map((c) => [c.id, c.name]));
  const today = istToday();

  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [every, setEvery] = useState<'weekly' | 'monthly'>('monthly');
  const [nextDue, setNextDue] = useState(today);
  const [method, setMethod] = useState<PayMethod>('cash');
  const [vendor, setVendor] = useState('');

  const add = useAction(async () => {
    const paise = parseRupeesToPaise(amount);
    if (!title.trim()) throw new AppError('NAME_REQUIRED');
    if (!categoryId) throw new AppError('CHOOSE_CATEGORY');
    if (paise === null || paise <= 0) throw new AppError('INVALID_AMOUNT');
    if (!isIsoDate(nextDue)) throw new AppError('INVALID_DATES');
    const kind = cats.data?.find((c) => c.id === categoryId)?.default_kind ?? 'running';
    await run(getSupabase().from('recurring_expenses').insert({
      kitchen_id: kitchenId, title: title.trim(), category_id: categoryId, kind, amount_paise: paise, every, next_due: nextDue,
      method, vendor: vendor.trim() || null,
    }).select('id').single());
    setTitle(''); setAmount(''); setVendor('');
    await refreshAll();
  });

  if (list.isLoading || cats.isLoading) return <Loading />;
  const rows = list.data ?? [];
  return (
    <Screen refreshing={list.isFetching} onRefresh={() => void list.refetch()}>
      <Stack.Screen options={{ title: tr('Regular expenses') }} />
      <Muted>{tr('You get an alert on the due day. "Record" adds it to this month\'s expenses and moves the due date on.')}</Muted>
      <ErrorText error={list.error} />
      {rows.length === 0 ? <Empty text={tr('Nothing yet. Add rent, gas, salaries...')} /> : null}
      {rows.map((r) => <RecurringRow key={r.id} r={r} category={catName.get(r.category_id) ?? ''} today={today} />)}
      <Card>
        <H2>{tr('Add a regular expense')}</H2>
        <Field label={tr('Name *')} value={title} onChangeText={setTitle} maxLength={80} placeholder={tr('Kitchen rent')} />
        <Chips label={tr('Category *')} value={categoryId} onChange={setCategoryId}
          options={(cats.data ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))} />
        <Field label={tr('Amount ₹ *')} value={amount} onChangeText={setAmount} numeric="money" />
        <Chips label={tr('Every')} value={every} onChange={setEvery} options={[{ value: 'monthly', label: 'Month' }, { value: 'weekly', label: 'Week' }]} />
        <DateField label={tr('Next due date')} value={nextDue} onChange={setNextDue} />
        <Field label={tr('Paid to')} value={vendor} onChangeText={setVendor} maxLength={100} />
        <Chips label={tr('Paid by')} value={method} onChange={setMethod} options={METHODS} />
        <ErrorText error={add.error} />
        <Button title={tr('Add')} loading={add.busy} onPress={() => void add.run()} />
      </Card>
    </Screen>
  );
}

function RecurringRow({ r, category, today }: { r: RecurringExpense; category: string; today: string }) {
  const tr = useT();
  const refreshAll = useRefreshAll();
  const [done, setDone] = useState(false);
  const record = useAction(async () => {
    await rpc('owner_record_recurring', { p_id: r.id });
    setDone(true);
    await refreshAll();
  });
  const toggle = useAction(async () => {
    await run(getSupabase().from('recurring_expenses').update({ active: !r.active }).eq('id', r.id).select('id').single());
    await refreshAll();
  });
  const due = r.next_due <= today;
  return (
    <Card>
      <ListRow title={`${r.title} · ${formatRupees(r.amount_paise)}`}
        subtitle={r.every === 'weekly'
          ? tr('{category} · every week · next {date}', { category, date: formatDate(r.next_due) })
          : tr('{category} · every month · next {date}', { category, date: formatDate(r.next_due) })}
        right={!r.active ? <Badge text={tr('Paused')} /> : due ? <Badge text={tr('Due')} tone="warn" /> : undefined} />
      <View>
        <RowWrap>
          {r.active ? <Button small title={due ? tr('Record payment') : tr('Record early')} loading={record.busy} onPress={() => void record.run()} /> : null}
          <Button small variant="ghost" title={r.active ? tr('Pause') : tr('Resume')} loading={toggle.busy} onPress={() => void toggle.run()} />
        </RowWrap>
        {done ? <Body>{tr('Recorded in today\'s expenses.')}</Body> : null}
        <ErrorText error={record.error ?? toggle.error} />
      </View>
    </Card>
  );
}
