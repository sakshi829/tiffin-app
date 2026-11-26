import { router, Stack } from 'expo-router';
import { formatDate } from '@amruta/shared';
import { rpc } from '../../../lib/api';
import { useBalances, useReferrals, useRefreshAll } from '../../../lib/queries';
import { Badge, Button, Card, Empty, ErrorText, H2, ListRow, Loading, Muted, RowWrap, Screen, useAction } from '../../../ui/kit';
import { useT } from '@amruta/app-core';

/** Customers suggest friends; you decide. Approving adds them as a customer (then send them an invite code). */
export default function Referrals() {
  const tr = useT();
  const referrals = useReferrals();
  const balances = useBalances();
  const refreshAll = useRefreshAll();
  const names = new Map((balances.data ?? []).map((b) => [b.customer_id, b.full_name]));
  const decide = useAction(async (id: string, approve: boolean) => {
    const created = await rpc<string | null>('owner_decide_referral', { p_id: id, p_approve: approve });
    await refreshAll();
    if (created) router.push({ pathname: '/customer/[id]', params: { id: created } });
  });
  const pending = (referrals.data ?? []).filter((r) => r.status === 'pending');
  const done = (referrals.data ?? []).filter((r) => r.status !== 'pending');
  return (
    <Screen refreshing={referrals.isFetching} onRefresh={() => void referrals.refetch()}>
      <Stack.Screen options={{ title: tr('Referrals') }} />
      {referrals.isLoading ? <Loading /> : null}
      <ErrorText error={referrals.error ?? decide.error} />
      <Card>
        <H2>{tr('Waiting for you ({length})', { length: pending.length })}</H2>
        {pending.length === 0 ? <Empty text={tr('No new referrals.')} /> : null}
        {pending.map((r) => (
          <Card key={r.id}>
            <ListRow title={`${r.friend_name} · ${r.friend_phone}`}
              subtitle={[`Referred by ${names.get(r.referrer_customer_id) ?? 'a customer'}`, formatDate(r.created_at.slice(0, 10)), r.note ?? ''].filter(Boolean).join(' · ')} />
            <RowWrap>
              <Button small title={tr('Add as customer')} loading={decide.busy} onPress={() => void decide.run(r.id, true)} />
              <Button small variant="ghost" title={tr('Not now')} onPress={() => void decide.run(r.id, false)} />
            </RowWrap>
          </Card>
        ))}
        <Muted>{tr('After adding, open the new customer, set their meals and send an invite code.')}</Muted>
      </Card>
      {done.length > 0 ? (
        <Card>
          <H2>{tr('Earlier')}</H2>
          {done.map((r) => (
            <ListRow key={r.id} title={r.friend_name} subtitle={names.get(r.referrer_customer_id) ? tr('by {name}', { name: names.get(r.referrer_customer_id)! }) : tr('by a customer')}
              right={<Badge text={r.status === 'approved' ? tr('Added') : tr('Not now')} tone={r.status === 'approved' ? 'good' : 'neutral'} />}
              onPress={r.created_customer_id ? () => router.push({ pathname: '/customer/[id]', params: { id: r.created_customer_id! } }) : undefined} />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
