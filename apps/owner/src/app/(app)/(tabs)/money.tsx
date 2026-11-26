import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { addDays, formatDate, formatRupees, istToday, monthRange, type PendingPayment } from '@amruta/shared';
import { rpc } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { PrivateImage, useT } from '@amruta/app-core';
import { useBalances, usePendingPayments, useRefreshAll } from '../../../lib/queries';
import { useInsights, useProfitLoss } from '../../../lib/finance';
import { Badge, Body, Button, Card, Empty, ErrorText, Field, H2, ListRow, Loading, Muted, RowWrap, Screen, useAction } from '../../../ui/kit';

export default function Money() {
  const tr = useT();
  const balances = useBalances();
  const pending = usePendingPayments();
  const names = new Map((balances.data ?? []).map((b) => [b.customer_id, b.full_name]));
  const dues = (balances.data ?? []).filter((b) => b.balance_paise > 0).sort((a, b) => b.balance_paise - a.balance_paise);
  const totalDue = dues.reduce((s, d) => s + d.balance_paise, 0);
  const advances = (balances.data ?? []).filter((b) => b.balance_paise < 0).reduce((s, d) => s - d.balance_paise, 0);

  return (
    <Screen refreshing={balances.isFetching || pending.isFetching} onRefresh={() => { void balances.refetch(); void pending.refetch(); }}>
      <Card>
        <H2>{tr('To confirm ({count})', { count: pending.data?.length ?? 0 })}</H2>
        <Muted>{tr('UPI payments customers reported. Check your bank/UPI app for the UTR before confirming.')}</Muted>
        {pending.isLoading ? <Loading /> : null}
        <ErrorText error={pending.error} />
        {(pending.data ?? []).length === 0 && !pending.isLoading ? <Empty text={tr('Nothing to confirm.')} /> : null}
        {(pending.data ?? []).map((p) => <PendingPaymentRow key={p.id} payment={p} name={p.customer_name ?? names.get(p.customer_id) ?? 'Customer'} />)}
      </Card>
      <Card>
        <H2>{tr('Dues')}</H2>
        <Body bold>{tr('Total due: {formatRupees}', { formatRupees: formatRupees(totalDue) })}</Body>
        <Muted>{tr('Advance held: {formatRupees}', { formatRupees: formatRupees(advances) })}</Muted>
        {balances.isLoading ? <Loading /> : null}
        <ErrorText error={balances.error} />
        {dues.length === 0 && !balances.isLoading ? <Empty text={tr('Nobody owes anything.')} /> : null}
        {dues.map((d) => (
          <ListRow key={d.customer_id} title={d.full_name}
            subtitle={d.last_payment_on ? tr('Last paid {formatDate}', { formatDate: formatDate(d.last_payment_on) }) : tr('No payment yet')}
            right={<Badge text={formatRupees(d.balance_paise)} tone="warn" />}
            onPress={() => router.push({ pathname: '/customer/[id]', params: { id: d.customer_id } })} />
        ))}
      </Card>
      <Finance />
      <MonthBills />
    </Screen>
  );
}

/** This month at a glance + the top suggestions; details in Money › Reports. */
function Finance() {
  const tr = useT();
  const month = monthRange(istToday());
  const pl = useProfitLoss(month.from, istToday());
  const insights = useInsights();
  const top = (insights.data ?? []).filter((i) => i.severity === 'warn').concat((insights.data ?? []).filter((i) => i.severity !== 'warn')).slice(0, 3);
  return (
    <Card>
      <H2>{tr('Spending & profit (this month)')}</H2>
      {pl.data ? (
        <>
          <Body>{tr('Billed {formatRupees} · Spent {formatRupees2}', { formatRupees: formatRupees(pl.data.billed_paise), formatRupees2: formatRupees(pl.data.running_expenses_paise) })}</Body>
          <Body bold>{tr('Profit so far: {formatRupees}', { formatRupees: formatRupees(pl.data.profit_paise) })}</Body>
          {pl.data.cost_per_meal_paise !== null ? <Muted>{tr('Cost per meal {formatRupees} · {meals_delivered} meals', { formatRupees: formatRupees(Number(pl.data.cost_per_meal_paise)), meals_delivered: pl.data.meals_delivered })}</Muted> : null}
        </>
      ) : pl.isLoading ? <Loading /> : null}
      <ErrorText error={pl.error ?? insights.error} />
      {top.map((i) => <ListRow key={i.title} title={i.title} subtitle={i.detail}
        right={<Badge text={i.severity === 'warn' ? tr('Check') : tr('Tip')} tone={i.severity === 'warn' ? 'warn' : 'neutral'} />} />)}
      <RowWrap>
        <Button small title={tr('Add expense')} onPress={() => router.push('/money/expense')} />
        <Button small variant="secondary" title={tr('Expenses')} onPress={() => router.push('/money/expenses')} />
        <Button small variant="secondary" title={tr('Reports')} onPress={() => router.push('/money/reports')} />
      </RowWrap>
      <RowWrap>
        <Button small variant="ghost" title={tr('Regular expenses')} onPress={() => router.push('/money/recurring')} />
        <Button small variant="ghost" title={tr('Categories & budgets')} onPress={() => router.push('/money/categories')} />
        <Button small variant="ghost" title={tr('All suggestions ({value})', { value: insights.data?.length ?? 0 })} onPress={() => router.push('/money/insights')} />
      </RowWrap>
    </Card>
  );
}

/** One tap: a bill for every customer for last month (skips bills already made). Customers get "bill ready". */
function MonthBills() {
  const tr = useT();
  const { kitchenId } = useOwner();
  const refreshAll = useRefreshAll();
  const lastMonth = monthRange(addDays(monthRange(istToday()).from, -1));
  const [made, setMade] = useState<number | null>(null);
  const run = useAction(async () => {
    setMade(await rpc<number>('owner_generate_month_bills', { p_kitchen: kitchenId, p_month: lastMonth.from }));
    await refreshAll();
  });
  return (
    <Card>
      <H2>{tr('Monthly bills')}</H2>
      <Muted>{formatDate(lastMonth.from)} – {formatDate(lastMonth.to)}</Muted>
      <Button small variant="secondary" title={tr('Make bills for last month')} loading={run.busy} onPress={() => void run.run()} />
      {made !== null ? <Body>{made === 0 ? tr('All bills for that month already exist.') : tr('{made} bills made; customers were told.', { made: made })}</Body> : null}
      <ErrorText error={run.error} />
    </Card>
  );
}

function PendingPaymentRow({ payment, name }: { payment: PendingPayment; name: string }) {
  const tr = useT();
  const refreshAll = useRefreshAll();
  const [rejecting, setRejecting] = useState(false);
  const [showShot, setShowShot] = useState(false);
  const [reason, setReason] = useState('');
  const confirm = useAction(async () => { await rpc('owner_confirm_payment', { p_payment: payment.id }); await refreshAll(); });
  const reject = useAction(async () => { await rpc('owner_reject_payment', { p_payment: payment.id, p_reason: reason.trim() }); await refreshAll(); });
  return (
    <View style={{ gap: 8, paddingVertical: 8 }}>
      <ListRow title={`${name} · ${formatRupees(payment.amount_paise)}`}
        subtitle={[`UTR ${payment.utr ?? '-'}`, `Paid ${formatDate(payment.paid_on)}`, payment.note ?? ''].filter(Boolean).join(' · ')} />
      {payment.same_utr_count > 0 ? (
        <Badge tone="warn" text={payment.same_utr_count === 1
          ? tr('Same UTR as 1 other payment: check your UPI app before confirming')
          : tr('Same UTR as {count} other payments: check your UPI app before confirming', { count: payment.same_utr_count })} />
      ) : null}
      <RowWrap>
        <Button small title={tr('Confirm')} loading={confirm.busy} onPress={() => void confirm.run()} />
        <Button small variant="secondary" title={tr('Reject')} onPress={() => setRejecting(!rejecting)} />
        {payment.proof_path ? <Button small variant="ghost" title={showShot ? tr('Hide screenshot') : tr('View screenshot')} onPress={() => setShowShot(!showShot)} /> : null}
      </RowWrap>
      {showShot ? <PrivateImage bucket="payment-proofs" path={payment.proof_path} alt={tr('Payment screenshot from the customer')} /> : null}
      {rejecting ? (
        <>
          <Field label={tr('Reason (customer will see it)')} value={reason} onChangeText={setReason} maxLength={200} />
          <Button small variant="danger" title={tr('Reject payment')} disabled={!reason.trim()} loading={reject.busy} onPress={() => void reject.run()} />
        </>
      ) : null}
      <ErrorText error={confirm.error ?? reject.error} />
    </View>
  );
}
