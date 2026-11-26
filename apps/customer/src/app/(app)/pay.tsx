import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  AppError, Body, Button, Card, DateField, ErrorText, Field, H2, isIosBrowser, Muted, newIdempotencyKey, pickAndUploadPhoto, PrivateImage,
  rpc, Screen, useAction, useT,
} from '@amruta/app-core';
import { formatRupees, isIsoDate, istToday, parseRupeesToPaise, upiPayLink } from '@amruta/shared';
import { useMe } from '../../lib/auth';
import { useBalance, useRefreshAll, useSettings } from '../../lib/queries';

/**
 * Pay with any UPI app, then tell the kitchen the UTR (UPI reference) so they
 * can match it. The balance changes only after the kitchen confirms it.
 */
export default function Pay() {
  const tr = useT();
  const { customer, kitchenId } = useMe();
  const settings = useSettings();
  const balance = useBalance();
  // "Open UPI app" works on Android. On iPhone only if a UPI app has registered upi: links,
  // and never in iPhone Safari (it just shows "address invalid").
  const onIphone = Platform.OS === 'ios' || isIosBrowser();
  const [canOpenUpi, setCanOpenUpi] = useState(!onIphone);
  const refreshAll = useRefreshAll();
  const [idemKey] = useState(newIdempotencyKey);
  const [amount, setAmount] = useState('');
  const [utr, setUtr] = useState('');
  const [paidOn, setPaidOn] = useState(istToday());
  const [copied, setCopied] = useState(false);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [shotAdded, setShotAdded] = useState(false);
  const paise = parseRupeesToPaise(amount);

  useEffect(() => {
    if (balance.data && balance.data > 0 && amount === '') setAmount((balance.data / 100).toFixed(2).replace(/\.00$/, ''));
  }, [balance.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const upiId = settings.data?.upi_id ?? null;
  const link = upiId && paise ? upiPayLink({
    upiId, payeeName: settings.data?.display_name ?? "Amruta's Kitchen", amountPaise: paise, note: `Tiffin ${customer.full_name}`,
  }) : null;
  useEffect(() => {
    if (Platform.OS !== 'ios' || !link) return;
    Linking.canOpenURL(link).then(setCanOpenUpi).catch(() => setCanOpenUpi(false));   // needs LSApplicationQueriesSchemes "upi"
  }, [link]);

  const submit = useAction(async () => {
    if (paise === null || paise < 100 || !isIsoDate(paidOn)) throw new AppError('INVALID_AMOUNT');
    const r = await rpc<{ payment_id: string }>('customer_submit_payment', {
      p_kitchen: kitchenId, p_amount_paise: paise, p_utr: utr.replace(/\s/g, ''), p_paid_on: paidOn,
      p_idempotency_key: idemKey, p_note: null,
    });
    setPaymentId(r.payment_id);
    await refreshAll();
  });

  const screenshot = useAction(async () => {
    if (!paymentId) return;
    const path = await pickAndUploadPhoto('library', 'payment-proofs', `${kitchenId}/${customer.id}/${paymentId}.jpg`);
    if (!path) return;
    await rpc('customer_attach_payment_proof', { p_payment: paymentId, p_path: path });
    setShotAdded(true);
  });

  if (paymentId) {
    return (
      <Screen>
        <Stack.Screen options={{ title: tr('Payment sent') }} />
        <Card>
          <H2>{tr('Sent to the kitchen')}</H2>
          <Body>{tr('Your balance updates when the kitchen confirms the payment. You\'ll get an alert.')}</Body>
          <Muted>{tr('Optional: add a screenshot of the payment to help them find it.')}</Muted>
          {shotAdded ? <Body bold>{tr('Screenshot added. Thank you!')}</Body> : (
            <Button variant="secondary" title={tr('Add screenshot')} loading={screenshot.busy} onPress={() => void screenshot.run()} />
          )}
          <ErrorText error={screenshot.error} />
          <Button title={tr('Done')} onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Pay by UPI') }} />
      <Card>
        <H2>{tr('1. Pay')}</H2>
        <Field label={tr('Amount (₹)')} value={amount} onChangeText={setAmount} numeric="money"
          error={amount && paise === null ? tr('Enter an amount like 1200') : null} />
        <PrivateImage bucket="kitchen-media" path={settings.data?.upi_qr_path} alt={tr('UPI QR code to pay the kitchen')} />
        {upiId ? (
          <>
            <Body>{tr('UPI ID: {upiId}', { upiId: upiId })}</Body>
            <Button small variant="secondary" title={copied ? tr('Copied') : tr('Copy UPI ID')}
              onPress={() => { void Clipboard.setStringAsync(upiId); setCopied(true); }} />
            {link && canOpenUpi ? <Button title={tr('Open UPI app to pay {value}', { value: paise ? formatRupees(paise) : '' })} onPress={() => void Linking.openURL(link)} /> : null}
            {onIphone ? (
              <Muted>{tr('Paying from this iPhone: copy the UPI ID and use "Pay to UPI ID" in your UPI app (Google Pay, PhonePe, Paytm…), or take a screenshot of the QR and pick it from your photos in the app\'s scanner.')}</Muted>
            ) : <Muted>{tr('If your UPI app doesn\'t open, scan the QR above or pay to the UPI ID from any UPI app.')}</Muted>}
          </>
        ) : <Muted>{tr('The kitchen hasn\'t added its UPI ID yet. Please ask them how to pay.')}</Muted>}
      </Card>
      <Card>
        <H2>{tr('2. Tell us the UTR')}</H2>
        <Muted>{tr('After paying, your UPI app shows a 12-digit UTR / UPI reference number.')}</Muted>
        <Field label={tr('UTR / UPI reference')} value={utr} onChangeText={setUtr} autoCapitalize="characters" maxLength={30}
          error={utr && !/^[A-Za-z0-9]{6,30}$/.test(utr.replace(/\s/g, '')) ? tr('Letters and numbers only') : null} />
        <DateField label={tr('Paid on')} value={paidOn} onChange={setPaidOn} />
        <ErrorText error={submit.error} />
        <Button title={tr('Send to kitchen')} loading={submit.busy} disabled={paise === null || utr.replace(/\s/g, '').length < 6}
          onPress={() => void submit.run()} />
      </Card>
    </Screen>
  );
}
