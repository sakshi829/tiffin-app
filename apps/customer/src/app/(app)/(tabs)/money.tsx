import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Badge, Body, Button, Card, Empty, ErrorText, H2, Hero, Icon, ICONS, ListRow, Muted, Screen, shareHtmlAsPdf, Skeleton, space, useAction, useColors, useT } from '@amruta/app-core';
import { addDays, formatDate, formatRupees, istToday, statementHtml } from '@amruta/shared';
import { useMe } from '../../../lib/auth';
import { useBalance, useLedger, useLoyaltyProgress, useMyPayments, useRefreshAll, useSettings } from '../../../lib/queries';

const KIND: Record<string, string> = {
  meal: 'Meal', addon: 'Extra', late_skip: 'Late skip', late_fee: 'Late fee', payment: 'Payment received',
  waiver: 'Waived', discount: 'Discount', adjustment: 'Adjustment', reversal: 'Correction',
};

export default function Money() {
  const tr = useT();
  const c = useColors();
  const balance = useBalance();
  const ledger = useLedger();
  const payments = useMyPayments();
  const loyalty = useLoyaltyProgress();
  const refreshAll = useRefreshAll();
  const b = balance.data;
  const { customer } = useMe();
  const settings = useSettings();
  const pdf = useAction(async () => {
    if (b === undefined) return;
    const from = addDays(istToday(), -30);
    const entries = (ledger.data ?? []).filter((e) => e.entry_date >= from)
      .sort((x, y) => x.entry_date.localeCompare(y.entry_date) || x.created_at.localeCompare(y.created_at));
    const opening = b - entries.reduce((s, e) => s + e.amount_paise, 0);   // balance now minus what happened since
    await shareHtmlAsPdf(statementHtml({
      kitchenName: settings.data?.display_name ?? "Amruta's Kitchen", customerName: customer.full_name, from, to: istToday(),
      openingPaise: opening, entries, upiId: settings.data?.upi_id, contactPhone: settings.data?.contact_phone,
    }, tr), 'My statement');   // labels in the app language; file name stays plain
  });

  return (
    <Screen refreshing={balance.isFetching} onRefresh={() => void refreshAll()}>
      <Hero>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Icon name={ICONS.wallet} size={32} color={c.onAccentSoft} />
          <View style={{ flex: 1, gap: 2 }}>
            {balance.isLoading ? <><Skeleton width="50%" height={28} /><Skeleton width="35%" /></> : null}
            {b !== undefined ? (
              <>
                <Text style={{ color: c.onAccentSoft, fontSize: 32, fontWeight: '800', letterSpacing: -0.4 }}>{b > 0 ? formatRupees(b) : b < 0 ? formatRupees(-b) : '₹0'}</Text>
                <Text style={{ color: c.onAccentSoft, fontSize: 15, fontWeight: '600' }}>{b > 0 ? tr('to pay') : b < 0 ? tr('advance left') : tr('All paid. Thank you!')}</Text>
              </>
            ) : null}
          </View>
        </View>
        <ErrorText error={balance.error} />
        <Button title={tr('Pay by UPI')} onPress={() => router.push('/pay')} />
      </Hero>

      {loyalty.data?.active ? (
        <Card>
          <H2>{tr('Loyalty reward')}</H2>
          <Body>{loyalty.data.to_go === 1
            ? tr('1 more meal to your next reward: {reward}.', { reward: loyalty.data.reward_label })
            : tr('{count} more meals to your next reward: {reward}.', { count: loyalty.data.to_go, reward: loyalty.data.reward_label })}</Body>
          <Muted>{tr('{done} of {every} meals done.', { done: loyalty.data.toward_next, every: loyalty.data.every_n })}</Muted>
        </Card>
      ) : null}

      <Card>
        <H2>{tr('Payments')}</H2>
        {(payments.data ?? []).length === 0 ? <Muted>{tr('No payments yet.')}</Muted> : null}
        {(payments.data ?? []).map((p) => (
          <ListRow key={p.id} title={tr('{formatRupees} · {formatDate}', { formatRupees: formatRupees(p.amount_paise), formatDate: formatDate(p.paid_on) })}
            subtitle={[p.utr ? `UTR ${p.utr}` : p.method.toUpperCase(), p.status === 'rejected' && p.rejected_reason ? tr('Reason: {reason}', { reason: p.rejected_reason }) : '']
              .filter(Boolean).join(' · ')}
            right={<Badge text={p.status === 'submitted' ? tr('Checking') : p.status === 'confirmed' ? tr('Received') : tr('Not received')}
              tone={p.status === 'confirmed' ? 'good' : p.status === 'rejected' ? 'bad' : 'warn'} />} />
        ))}
      </Card>

      <Card>
        <H2>{tr('Last 60 days')}</H2>
        {ledger.isLoading ? <><Skeleton width="80%" /><Skeleton width="60%" /></> : null}
        {(ledger.data ?? []).length === 0 && !ledger.isLoading ? <Empty text={tr('Nothing yet.')} /> : null}
        {(ledger.data ?? []).map((e) => (
          <ListRow key={e.id} title={`${KIND[e.kind] ? tr(KIND[e.kind]!) : e.kind}  ${e.amount_paise < 0 ? '−' : ''}${formatRupees(Math.abs(e.amount_paise))}`}
            subtitle={[formatDate(e.entry_date), e.note ?? ''].filter(Boolean).join(' · ')} />
        ))}
        <Muted>{tr('Meals are added when delivered. Payments by UPI show after the kitchen checks them.')}</Muted>
        <Button small variant="secondary" title={tr('Share statement (PDF, last 30 days)')} loading={pdf.busy} onPress={() => void pdf.run()} />
        <ErrorText error={pdf.error} />
      </Card>
    </Screen>
  );
}
