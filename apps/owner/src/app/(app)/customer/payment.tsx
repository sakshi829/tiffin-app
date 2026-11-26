import { useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { isIsoDate, istToday, parseRupeesToPaise } from '@amruta/shared';
import { AppError, newIdempotencyKey, rpc } from '../../../lib/api';
import { useCustomer, useRefreshAll } from '../../../lib/queries';
import { Body, Button, Card, Chips, DateField, ErrorText, Field, Muted, Screen, useAction } from '../../../ui/kit';
import { useT } from '@amruta/app-core';

type Method = 'cash' | 'upi' | 'bank' | 'other';

export default function RecordPayment() {
  const tr = useT();
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const customer = useCustomer(customerId);
  const refreshAll = useRefreshAll();
  // One key per screen visit: double taps / retries record the payment once.
  const [idemKey] = useState(newIdempotencyKey);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [utr, setUtr] = useState('');
  const [paidOn, setPaidOn] = useState(istToday());
  const [note, setNote] = useState('');
  const paise = parseRupeesToPaise(amount);

  const save = useAction(async () => {
    if (paise === null || paise < 100 || !isIsoDate(paidOn) || paidOn > istToday()) throw new AppError('INVALID_AMOUNT');
    await rpc('owner_record_payment', {
      p_customer: customerId, p_amount_paise: paise, p_method: method, p_utr: utr.trim() || null,
      p_paid_on: paidOn, p_note: note.trim() || null, p_idempotency_key: idemKey,
    });
    await refreshAll();
    router.back();
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Record payment') }} />
      <Card>
        <Body bold>{customer.data?.full_name ?? ''}</Body>
        <Field label={tr('Amount (₹)')} value={amount} onChangeText={setAmount} numeric="money"
          error={amount && paise === null ? tr('Enter an amount like 1200 or 1200.50') : null} />
        <Chips label={tr('Paid by')} value={method} onChange={setMethod} options={[
          { value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'bank', label: 'Bank' }, { value: 'other', label: 'Other' },
        ]} />
        {method === 'upi' || method === 'bank' ? (
          <Field label={tr('UTR / reference (optional)')} value={utr} onChangeText={setUtr} autoCapitalize="characters" maxLength={30} />
        ) : null}
        <DateField label={tr('Paid on')} value={paidOn} onChange={setPaidOn} />
        <Field label={tr('Note (optional)')} value={note} onChangeText={setNote} maxLength={300} />
      </Card>
      <Muted>{tr('The payment is added to their account immediately and cannot be deleted. Mistakes are corrected with an adjustment.')}</Muted>
      <ErrorText error={save.error} />
      <Button title={tr('Save payment')} onPress={() => void save.run()} loading={save.busy} disabled={paise === null} />
    </Screen>
  );
}
