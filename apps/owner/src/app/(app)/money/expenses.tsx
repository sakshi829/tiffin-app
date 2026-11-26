import { useMemo, useState } from 'react';
import { router, Stack } from 'expo-router';
import { addDays, formatDate, formatRupees, istToday, monthRange, paiseToRupeesNumber, parseQuickExpense, toCsv } from '@amruta/shared';
import { shareCsv, useT } from '@amruta/app-core';
import { useExpenseCategories, useExpenses } from '../../../lib/finance';
import { useStaff } from '../../../lib/queries';
import { Badge, Body, Button, Card, Chips, Empty, ErrorText, Field, H2, ListRow, Loading, Muted, RowWrap, Screen, SwitchRow, useAction } from '../../../ui/kit';
import { setExpensePrefill } from '../../../lib/expense-prefill';

/** Expenses & investments by month, quick entry, CSV export. */
export default function Expenses() {
  const tr = useT();
  const thisMonth = monthRange(istToday());
  const lastMonth = monthRange(addDays(thisMonth.from, -1));
  const [which, setWhich] = useState<'this' | 'last'>('this');
  const [showArchived, setShowArchived] = useState(false);
  const range = which === 'this' ? thisMonth : lastMonth;
  const expenses = useExpenses(range.from, range.to, showArchived);
  const cats = useExpenseCategories();
  const staff = useStaff();
  const catName = new Map((cats.data ?? []).map((c) => [c.id, c.name]));
  const staffName = new Map((staff.data ?? []).map((s) => [s.id, s.display_name]));
  const list = expenses.data ?? [];
  const live = list.filter((e) => !e.archived_at);
  const running = live.filter((e) => e.kind === 'running').reduce((s, e) => s + e.amount_paise, 0);
  const invest = live.filter((e) => e.kind === 'investment').reduce((s, e) => s + e.amount_paise, 0);

  const byDate = useMemo(() => {
    const m = new Map<string, typeof list>();
    for (const e of list) m.set(e.expense_date, [...(m.get(e.expense_date) ?? []), e]);
    return [...m.entries()];
  }, [list]);

  const [quick, setQuick] = useState('');
  const [quickError, setQuickError] = useState<string | null>(null);
  const useQuick = () => {
    const parsed = parseQuickExpense(quick, cats.data ?? []);
    if (!parsed) { setQuickError(tr('Could not find one clear amount. Example: "500 vegetables from Ramesh".')); return; }
    setQuickError(null);
    setQuick('');
    setExpensePrefill({ amountPaise: parsed.amountPaise, categoryId: parsed.categoryId, vendor: parsed.vendor, note: parsed.note });
    router.push('/money/expense');
  };

  const exportCsv = useAction(async () => {
    const rows: (string | number)[][] = [['Date', 'Category', 'Type', 'Amount (Rs)', 'Paid to', 'Method', 'Staff', 'Note', 'Receipt', 'Removed']];
    for (const e of [...list].reverse()) {
      rows.push([e.expense_date, catName.get(e.category_id) ?? '', e.kind === 'investment' ? 'Investment' : 'Running',
        paiseToRupeesNumber(e.amount_paise), e.vendor ?? '', e.method, e.staff_member_id ? staffName.get(e.staff_member_id) ?? '' : '',
        e.note ?? '', e.receipt_path ? 'yes' : '', e.archived_at ? 'yes' : '']);
    }
    await shareCsv(toCsv(rows), `expenses-${range.from.slice(0, 7)}`);
  });

  return (
    <Screen refreshing={expenses.isFetching} onRefresh={() => void expenses.refetch()}>
      <Stack.Screen options={{ title: tr('Expenses') }} />
      <Card>
        <H2>{tr('Quick add')}</H2>
        <Field label={tr('Type or say it (keyboard mic)')} value={quick} onChangeText={setQuick} maxLength={200}
          placeholder={tr('500 vegetables from Ramesh')} onSubmitEditing={useQuick} returnKeyType="next" error={quickError} />
        <RowWrap>
          <Button small title={tr('Next')} disabled={!quick.trim()} onPress={useQuick} />
          <Button small variant="secondary" title={tr('Full form')} onPress={() => router.push('/money/expense')} />
        </RowWrap>
        <Muted>{tr('You always see and confirm the details before saving.')}</Muted>
      </Card>

      <Chips value={which} onChange={setWhich} options={[{ value: 'this', label: 'This month' }, { value: 'last', label: 'Last month' }]} />
      <Card>
        <Body bold>{tr('Running costs: {formatRupees}', { formatRupees: formatRupees(running) })}</Body>
        <Body>{tr('Investments: {formatRupees}', { formatRupees: formatRupees(invest) })}</Body>
        <Muted>{formatDate(range.from)} – {formatDate(range.to)}</Muted>
        <SwitchRow label={tr('Show removed entries')} value={showArchived} onValueChange={setShowArchived} />
        <Button small variant="secondary" title={tr('Export to spreadsheet (CSV)')} loading={exportCsv.busy} disabled={list.length === 0}
          onPress={() => void exportCsv.run()} />
        <ErrorText error={exportCsv.error} />
      </Card>
      {expenses.isLoading ? <Loading /> : null}
      <ErrorText error={expenses.error} />
      {!expenses.isLoading && list.length === 0 ? <Empty text={tr('No expenses in this month yet.')} /> : null}
      {byDate.map(([date, rows]) => (
        <Card key={date}>
          <H2>{formatDate(date)}</H2>
          {rows.map((e) => (
            <ListRow key={e.id}
              title={`${catName.get(e.category_id) ?? tr('Expense')}${e.vendor ? ` · ${e.vendor}` : ''}`}
              subtitle={[e.note, e.staff_member_id ? (staffName.get(e.staff_member_id) ? tr('For {name}', { name: staffName.get(e.staff_member_id)! }) : tr('For staff')) : '', e.receipt_path ? tr('Receipt') : '']
                .filter(Boolean).join(' · ') || null}
              right={e.archived_at ? <Badge text={tr('Removed')} /> : (
                <Badge text={formatRupees(e.amount_paise)} tone={e.kind === 'investment' ? 'primary' : 'neutral'} />)}
              onPress={() => router.push({ pathname: '/money/expense', params: { id: e.id } })} />
          ))}
        </Card>
      ))}
    </Screen>
  );
}
