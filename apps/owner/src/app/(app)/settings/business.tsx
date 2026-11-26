import { useEffect, useState } from 'react';
import { router, Stack } from 'expo-router';
import { formatRupees, parseRupeesToPaise, type BusinessSettings, type SignupMode } from '@amruta/shared';
import { AppError, rpc } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useStepUp } from '../../../lib/stepup';
import { useRefreshAll, useSettings } from '../../../lib/queries';
import { Button, Card, Chips, ErrorText, Field, H2, Loading, Muted, Screen, SwitchRow, useAction } from '../../../ui/kit';
import { pickAndUploadPhoto, PrivateImage, useT } from '@amruta/app-core';

const UPI = /^[A-Za-z0-9.\-_]{2,64}@[A-Za-z0-9]{2,64}$/;
const PHONE = /^[0-9+ -]{7,20}$/;
const int = (v: string, min: number, max: number) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };

/** Your UPI QR picture, shown to customers on "Pay by UPI". Private: only people of your kitchen can see it. */
function UpiQrCard({ current }: { current: string | null }) {
  const tr = useT();
  const { kitchenId } = useOwner();
  const withStepUp = useStepUp();
  const refreshAll = useRefreshAll();
  const upload = useAction(async () => {
    const path = await pickAndUploadPhoto('library', 'kitchen-media', `${kitchenId}/upi-qr-${Date.now()}.jpg`);
    if (!path) return;
    await withStepUp(() => rpc('owner_update_settings', { p_kitchen: kitchenId, p: { upi_qr_path: path } }));
    await refreshAll();
  });
  return (
    <Card>
      <H2>{tr('UPI QR picture')}</H2>
      <Muted>{tr('Screenshot of your business UPI QR (PhonePe / Paytm / Google Pay for Business). Customers see it when paying.')}</Muted>
      <PrivateImage bucket="kitchen-media" path={current} alt={tr('Current UPI QR code')} />
      <ErrorText error={upload.error} />
      <Button small variant="secondary" title={current ? tr('Change QR picture') : tr('Add QR picture')} loading={upload.busy} onPress={() => void upload.run()} />
    </Card>
  );
}

export default function BusinessSettingsScreen() {
  const tr = useT();
  const { kitchenId } = useOwner();
  const settings = useSettings();
  const refreshAll = useRefreshAll();
  const withStepUp = useStepUp();
  const s = settings.data;

  const [name, setName] = useState('');
  const [upi, setUpi] = useState('');
  const [freeSkips, setFreeSkips] = useState('1');
  const [skipPct, setSkipPct] = useState('100');
  const [horizon, setHorizon] = useState('7');
  const [feeOn, setFeeOn] = useState(false);
  const [feeGrace, setFeeGrace] = useState('7');
  const [feeType, setFeeType] = useState<'flat' | 'percent'>('flat');
  const [feeValue, setFeeValue] = useState('');
  const [lowBal, setLowBal] = useState('200');
  const [signup, setSignup] = useState<SignupMode>('invite_only');
  const [contact, setContact] = useState('');

  useEffect(() => {
    if (!s) return;
    setName(s.display_name); setUpi(s.upi_id ?? ''); setFreeSkips(String(s.free_late_skips_per_month));
    setSkipPct(String(s.late_skip_charge_percent)); setHorizon(String(s.order_horizon_days)); setFeeOn(s.late_fee_enabled);
    setFeeGrace(String(s.late_fee_grace_days)); setFeeType(s.late_fee_type);
    setFeeValue(s.late_fee_type === 'flat' ? String(s.late_fee_value / 100) : String(s.late_fee_value));
    setLowBal(String(Number(s.low_balance_threshold_paise) / 100)); setSignup(s.signup_mode); setContact(s.contact_phone ?? '');
  }, [s]);

  const save = useAction(async () => {
    if (!s) return;
    const fee = feeType === 'flat' ? parseRupeesToPaise(feeValue || '0') : int(feeValue || '0', 0, 100);
    const low = parseRupeesToPaise(lowBal || '0');
    const next: Partial<BusinessSettings> = {
      display_name: name.trim(), upi_id: upi.trim() || null,
      free_late_skips_per_month: int(freeSkips, 0, 31) ?? undefined, late_skip_charge_percent: int(skipPct, 0, 100) ?? undefined,
      order_horizon_days: int(horizon, 1, 31) ?? undefined, late_fee_enabled: feeOn, late_fee_grace_days: int(feeGrace, 0, 90) ?? undefined,
      late_fee_type: feeType, late_fee_value: fee ?? undefined, low_balance_threshold_paise: low ?? undefined, signup_mode: signup,
      contact_phone: contact.trim() || null,
    };
    if (Object.values(next).some((v) => v === undefined) || !name.trim() || (upi.trim() && !UPI.test(upi.trim()))
        || (contact.trim() && !PHONE.test(contact.trim()))) {
      throw new AppError('INVALID_SETTING');
    }
    // Send only what changed.
    const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => (s as unknown as Record<string, unknown>)[k] !== v));
    if (Object.keys(changed).length > 0) {
      await withStepUp(() => rpc('owner_update_settings', { p_kitchen: kitchenId, p: changed }));
      await refreshAll();
    }
    router.back();
  });

  if (settings.isLoading) return <Loading />;
  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Business & rules') }} />
      <Card>
        <Field label={tr('Business name')} value={name} onChangeText={setName} maxLength={100} />
        <Field label={tr('UPI ID for payments')} value={upi} onChangeText={setUpi} autoCapitalize="none" placeholder={tr('name@bank')}
          error={upi.trim() && !UPI.test(upi.trim()) ? tr('Looks wrong, e.g. amrutaskitchen@okaxis') : null} />
        <Field label={tr('Kitchen phone (customers can call / WhatsApp)')} value={contact} onChangeText={setContact} keyboardType="phone-pad"
          maxLength={20} error={contact.trim() && !PHONE.test(contact.trim()) ? tr('Check the number') : null} />
        <Field label={tr('Days of orders to prepare ahead')} value={horizon} onChangeText={setHorizon} keyboardType="number-pad" maxLength={2} />
      </Card>
      <UpiQrCard current={s?.upi_qr_path ?? null} />
      <Card>
        <H2>{tr('Skipping after the cutoff')}</H2>
        <Field label={tr('Free late skips per customer per month')} value={freeSkips} onChangeText={setFreeSkips} keyboardType="number-pad" maxLength={2} />
        <Field label={tr('Charge for a late skip (% of meal price)')} value={skipPct} onChangeText={setSkipPct} keyboardType="number-pad" maxLength={3} />
        <Muted>{tr('You can set a different number of free skips for one customer on their page, and waive any single charge.')}</Muted>
      </Card>
      <Card>
        <H2>{tr('Late payment fee')}</H2>
        <SwitchRow label={tr('Charge a late fee')} value={feeOn} onValueChange={setFeeOn}
          hint={tr('Only for bills made after you switch this on. Customers get a reminder 2 days before the due date; the fee is added once, the day after.')} />
        <Field label={tr('Days after the bill before the fee')} value={feeGrace} onChangeText={setFeeGrace} keyboardType="number-pad" maxLength={2} />
        <Chips value={feeType} onChange={setFeeType} options={[{ value: 'flat', label: 'Fixed ₹' }, { value: 'percent', label: '% of due' }]} />
        <Field label={feeType === 'flat' ? tr('Fee ₹') : tr('Fee %')} value={feeValue} onChangeText={setFeeValue} keyboardType="decimal-pad" />
      </Card>
      <Card>
        <H2>{tr('Advance customers')}</H2>
        <Field label={tr('Warn when advance is below ₹ (now {value})', { value: s ? formatRupees(Number(s.low_balance_threshold_paise)) : '' })}
          value={lowBal} onChangeText={setLowBal} keyboardType="decimal-pad" />
      </Card>
      <Card>
        <H2>{tr('Who can join')}</H2>
        <Chips value={signup} onChange={setSignup} options={[
          { value: 'invite_only', label: 'Invite code only' },
          { value: 'request_to_join', label: 'Request, I approve' },
          { value: 'open', label: 'Anyone (later)' },
        ]} />
        <Muted>{tr('Keep "Invite code only" until you want new people to ask to join.')}</Muted>
      </Card>
      <Muted>{tr('Saving needs your authenticator code.')}</Muted>
      <ErrorText error={save.error} />
      <Button title={tr('Save')} onPress={() => void save.run()} loading={save.busy} />
    </Screen>
  );
}
