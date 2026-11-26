import { useEffect, useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { formatRupees, isIsoDate, istToday, parseRupeesToPaise, type ExpenseKind, type PayMethod } from '@amruta/shared';
import { newIdempotencyKey, pickAndUploadPhoto, PrivateImage, useT } from '@amruta/app-core';
import { getSupabase } from '../../../lib/supabase';
import { AppError, run } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useRefreshAll, useStaff } from '../../../lib/queries';
import { METHODS, useExpense, useExpenseCategories } from '../../../lib/finance';
import { takeExpensePrefill } from '../../../lib/expense-prefill';
import { Button, Card, Chips, DateField, ErrorText, Field, H2, Loading, Muted, RowWrap, Screen, useAction } from '../../../ui/kit';

/**
 * Add or edit one expense / investment. Entries are never deleted: "Remove"
 * hides them (archived) and keeps the history (the database forbids deletes).
 */
export default function ExpenseForm() {
  const tr = useT();
  const p = useLocalSearchParams<{ id?: string }>();   // only the expense id: a prefill never comes from a link (F40)
  const [pre] = useState(() => takeExpensePrefill());
  const { kitchenId } = useOwner();
  const cats = useExpenseCategories();
  const staff = useStaff();
  const existing = useExpense(p.id);
  const refreshAll = useRefreshAll();

  const [date, setDate] = useState(istToday());
  const [categoryId, setCategoryId] = useState<string>(pre?.categoryId ?? '');
  const [kind, setKind] = useState<ExpenseKind>('running');
  const [amount, setAmount] = useState(pre ? String(pre.amountPaise / 100) : '');
  const [vendor, setVendor] = useState(pre?.vendor ?? '');
  const [method, setMethod] = useState<PayMethod>('cash');
  const [staffId, setStaffId] = useState<string>('');
  const [note, setNote] = useState(pre?.note ?? '');
  const [receipt, setReceipt] = useState<string | null>(null);

  useEffect(() => {
    const e = existing.data;
    if (!e) return;
    setDate(e.expense_date); setCategoryId(e.category_id); setKind(e.kind); setAmount(String(e.amount_paise / 100));
    setVendor(e.vendor ?? ''); setMethod(e.method); setStaffId(e.staff_member_id ?? ''); setNote(e.note ?? ''); setReceipt(e.receipt_path);
  }, [existing.data]);

  const pickCategory = (id: string) => {
    setCategoryId(id);
    const c = cats.data?.find((x) => x.id === id);
    if (c && !p.id) setKind(c.default_kind);
  };

  const addReceipt = useAction(async (source: 'camera' | 'library') => {
    const path = await pickAndUploadPhoto(source, 'receipts', `${kitchenId}/${newIdempotencyKey().toLowerCase()}.jpg`);
    if (path) setReceipt(path);
  });

  const save = useAction(async () => {
    const paise = parseRupeesToPaise(amount);
    if (paise === null || paise <= 0) throw new AppError('INVALID_AMOUNT');
    if (!categoryId) throw new AppError('INVALID_KIND');
    if (!isIsoDate(date) || date > istToday()) throw new AppError('INVALID_DATES');
    const row = {
      expense_date: date, category_id: categoryId, kind, amount_paise: paise, vendor: vendor.trim() || null, method,
      note: note.trim() || null, receipt_path: receipt, staff_member_id: staffId || null,
    };
    const db = getSupabase();
    if (p.id) await run(db.from('expenses').update(row).eq('id', p.id).select('id').single());
    else await run(db.from('expenses').insert({ ...row, kitchen_id: kitchenId }).select('id').single());
    await refreshAll();
    router.back();
  });

  const archive = useAction(async (removed: boolean) => {
    await run(getSupabase().from('expenses').update({ archived_at: removed ? new Date().toISOString() : null }).eq('id', p.id!).select('id').single());
    await refreshAll();
    router.back();
  });

  if (cats.isLoading || (p.id && existing.isLoading)) return <Loading />;
  const activeCats = (cats.data ?? []).filter((c) => c.active || c.id === categoryId);
  const isSalary = cats.data?.find((c) => c.id === categoryId)?.name === 'Staff salary';
  const team = (staff.data ?? []).filter((s) => s.role !== 'owner' && (s.active || s.id === staffId));
  const paise = parseRupeesToPaise(amount);

  return (
    <Screen>
      <Stack.Screen options={{ title: p.id ? tr('Edit expense') : tr('Add expense') }} />
      <Card>
        <Field label={tr('Amount ₹ *')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" autoFocus={!p.id && !amount}
          error={amount && (paise === null || paise <= 0) ? tr('Enter an amount like 450 or 450.50') : null}
          hint={paise ? formatRupees(paise) : undefined} />
        <Chips label={tr('Category *')} value={categoryId} onChange={pickCategory}
          options={activeCats.map((c) => ({ value: c.id, label: c.name }))} />
        <Chips label={tr('Type')} value={kind} onChange={setKind} options={[
          { value: 'running', label: 'Running cost' }, { value: 'investment', label: 'Investment (one-time)' },
        ]} />
        <Muted>{tr('Investments (boxes, mixer, fridge) are kept apart from monthly costs, so the report shows when they are paid back.')}</Muted>
        <DateField label={tr('Date')} value={date} onChange={setDate} />
        <Field label={tr('Paid to (shop / person)')} value={vendor} onChangeText={setVendor} maxLength={100} />
        <Chips label={tr('Paid by')} value={method} onChange={setMethod} options={METHODS} />
        {isSalary || staffId ? (
          <Chips label={tr('Staff member (salary / advance)')} value={staffId} onChange={setStaffId}
            options={[{ value: '', label: 'Not for one person' }, ...team.map((s) => ({ value: s.id, label: s.display_name }))]} />
        ) : null}
        <Field label={tr('Note')} value={note} onChangeText={setNote} maxLength={500} multiline placeholder={tr('e.g. 5 kg onions, 2 kg tomatoes')} />
      </Card>
      <Card>
        <H2>{tr('Receipt / bill photo')}</H2>
        <Muted>{tr('Private: only you can see it. Kept with your accounts (not deleted after 30 days).')}</Muted>
        <PrivateImage bucket="receipts" path={receipt} alt={tr('Receipt photo')} />
        <RowWrap>
          <Button small variant="secondary" title={tr('Take photo')} loading={addReceipt.busy} onPress={() => void addReceipt.run('camera')} />
          <Button small variant="secondary" title={tr('From gallery')} loading={addReceipt.busy} onPress={() => void addReceipt.run('library')} />
          {receipt ? <Button small variant="ghost" title={tr('No receipt')} onPress={() => setReceipt(null)} /> : null}
        </RowWrap>
        <ErrorText error={addReceipt.error} />
      </Card>
      <ErrorText error={save.error} />
      <Button title={tr('Save')} loading={save.busy} onPress={() => void save.run()} />
      {p.id && existing.data ? (
        existing.data.archived_at
          ? <Button variant="secondary" title={tr('Restore this entry')} loading={archive.busy} onPress={() => void archive.run(false)} />
          : <Button variant="danger" title={tr('Remove (kept in history)')} loading={archive.busy} onPress={() => void archive.run(true)} />
      ) : null}
      <ErrorText error={archive.error} />
    </Screen>
  );
}
