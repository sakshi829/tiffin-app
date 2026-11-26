import { useState } from 'react';
import { Linking, Share } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  formatDate, formatRupees, isIsoDate, istToday, monthRange, parseRupeesToPaise, statementHtml, whatsappLink, type Statement,
} from '@amruta/shared';
import { shareHtmlAsPdf, useT } from '@amruta/app-core';
import { AppError, rpc } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useCustomer, useRefreshAll, useSettings } from '../../../lib/queries';
import { useStepUp } from '../../../lib/stepup';
import {
  Body, Button, Card, Chips, DateField, Empty, ErrorText, Field, H2, ListRow, Loading, Muted, RowWrap, Screen, useAction,
} from '../../../ui/kit';

const KITCHEN_NAME = "Amruta's Kitchen";
const KIND_LABEL: Record<string, string> = {
  meal: 'Meal', addon: 'Extra', late_skip: 'Late skip', late_fee: 'Late fee', payment: 'Payment',
  waiver: 'Waived', discount: 'Discount', adjustment: 'Adjustment', reversal: 'Correction',
};

export default function StatementScreen() {
  const tr = useT();
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const { kitchenId } = useOwner();
  const customer = useCustomer(customerId);
  const settings = useSettings();
  const refreshAll = useRefreshAll();
  const withStepUp = useStepUp();
  const month = monthRange(istToday());
  const [from, setFrom] = useState(month.from);
  const [to, setTo] = useState(istToday());
  const valid = isIsoDate(from) && isIsoDate(to) && from <= to;

  const statement = useQuery({
    queryKey: ['owner', kitchenId, 'statement', customerId, from, to],
    enabled: valid,
    queryFn: async () => {
      const s = await rpc<Statement>('owner_customer_statement', { p_customer: customerId, p_from: from, p_to: to });
      return { ...s, opening_paise: Number(s.opening_paise), closing_paise: Number(s.closing_paise),
        entries: s.entries.map((e) => ({ ...e, amount_paise: Number(e.amount_paise) })) };
    },
  });

  const [billNo, setBillNo] = useState<string | null>(null);
  const bill = useAction(async () => {
    await rpc<string>('owner_generate_bill', { p_customer: customerId, p_period_start: from, p_period_end: to, p_due_days: null });
    setBillNo(tr('Bill saved.'));
    await refreshAll();
  });

  // Correction (waiver / discount / adjustment): needs a note and your authenticator code.
  const [kind, setKind] = useState<'waiver' | 'discount' | 'adjustment'>('waiver');
  const [amt, setAmt] = useState('');
  const [note, setNote] = useState('');
  const addEntry = useAction(async () => {
    const negative = amt.trim().startsWith('-');
    const paise = parseRupeesToPaise(amt.trim().replace(/^-/, ''));
    if (paise === null || paise === 0) throw new AppError('INVALID_AMOUNT');
    await withStepUp(() => rpc('owner_add_ledger_entry', {
      p_customer: customerId, p_kind: kind, p_amount_paise: negative ? -paise : paise, p_note: note.trim(), p_order: null,
    }));
    setAmt(''); setNote('');
    await refreshAll();
    await statement.refetch();
  });

  const s = statement.data;
  const text = s ? [
    tr('{kitchen}: statement for {name}', { kitchen: settings.data?.display_name ?? KITCHEN_NAME, name: s.full_name }),
    tr('{from} to {to}', { from: formatDate(from), to: formatDate(to) }),
    tr('Opening: {amount}', { amount: formatRupees(s.opening_paise) }),
    ...s.entries.map((e) => `${formatDate(e.entry_date)} ${KIND_LABEL[e.kind] ? tr(KIND_LABEL[e.kind]!) : e.kind}: ${formatRupees(e.amount_paise)}`),
    s.closing_paise >= 0 ? tr('Amount due: {amount}', { amount: formatRupees(s.closing_paise) }) : tr('Advance balance: {amount}', { amount: formatRupees(-s.closing_paise) }),
    settings.data?.upi_id ? tr('Pay by UPI to {upi}', { upi: settings.data.upi_id }) : '',
  ].filter(Boolean).join('\n') : '';
  const wa = whatsappLink(customer.data?.phone, text);
  const pdf = useAction(async () => {
    if (!s) return;
    await shareHtmlAsPdf(statementHtml({
      kitchenName: settings.data?.display_name ?? "Amruta's Kitchen", customerName: s.full_name, from, to,
      openingPaise: s.opening_paise, entries: s.entries, upiId: settings.data?.upi_id, contactPhone: settings.data?.contact_phone,
    }, tr), `Statement ${s.full_name}`);
  });

  let running = s?.opening_paise ?? 0;
  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Statement') }} />
      <Card>
        <DateField label={tr('From')} value={from} onChange={setFrom} />
        <DateField label={tr('To')} value={to} onChange={setTo} />
      </Card>
      {statement.isLoading ? <Loading /> : null}
      <ErrorText error={statement.error} />
      {s ? (
        <Card>
          <H2>{s.full_name}</H2>
          <Body>{tr('Opening balance: {formatRupees}', { formatRupees: formatRupees(s.opening_paise) })}</Body>
          {s.entries.length === 0 ? <Empty text={tr('No entries in this period.')} /> : null}
          {s.entries.map((e) => {
            running += e.amount_paise;
            return (
              <ListRow key={e.id} title={`${KIND_LABEL[e.kind] ? tr(KIND_LABEL[e.kind]!) : e.kind}  ${formatRupees(e.amount_paise)}`}
                subtitle={[formatDate(e.entry_date), e.note ?? ''].filter(Boolean).join(' · ')}
                right={<Muted>{formatRupees(running)}</Muted>} />
            );
          })}
          <Body bold>{s.closing_paise >= 0 ? tr('Due: {formatRupees}', { formatRupees: formatRupees(s.closing_paise) }) : tr('Advance: {formatRupees}', { formatRupees: formatRupees(-s.closing_paise) })}</Body>
          <RowWrap>
            <Button small title={tr('Share PDF')} loading={pdf.busy} onPress={() => void pdf.run()} />
            <Button small variant="secondary" title={tr('Share as text')} onPress={() => void Share.share({ message: text })} />
            {wa ? <Button small variant="secondary" title={tr('Send on WhatsApp')} onPress={() => void Linking.openURL(wa)} /> : null}
            <Button small variant="secondary" title={tr('Save as bill')} loading={bill.busy} disabled={to > istToday()} onPress={() => void bill.run()} />
          </RowWrap>
          {billNo ? <Muted>{billNo}</Muted> : null}
          <ErrorText error={bill.error} />
        </Card>
      ) : null}
      <Card>
        <H2>{tr('Correction')}</H2>
        <Chips value={kind} onChange={setKind} options={[
          { value: 'waiver', label: 'Waive' }, { value: 'discount', label: 'Discount' }, { value: 'adjustment', label: 'Adjustment (+/−)' },
        ]} />
        <Field label={kind === 'adjustment' ? tr('Amount ₹ (negative reduces dues)') : tr('Amount ₹ to reduce')} value={amt} onChangeText={setAmt}
          keyboardType="numbers-and-punctuation" />
        <Field label={tr('Note (required)')} value={note} onChangeText={setNote} maxLength={300} />
        <Muted>{tr('Corrections never delete history; they add a visible entry. Needs your authenticator code.')}</Muted>
        <ErrorText error={addEntry.error} />
        <Button small variant="secondary" title={tr('Add correction')} loading={addEntry.busy} disabled={!amt || !note.trim()}
          onPress={() => void addEntry.run()} />
      </Card>
    </Screen>
  );
}
