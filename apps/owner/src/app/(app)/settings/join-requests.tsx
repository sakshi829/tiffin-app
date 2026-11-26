import { router, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { cols, formatDate, type JoinRequest } from '@amruta/shared';
import { getSupabase } from '../../../lib/supabase';
import { rpc, run } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useRefreshAll } from '../../../lib/queries';
import { Badge, Button, Card, Empty, ErrorText, H2, ListRow, Loading, Muted, RowWrap, Screen, useAction } from '../../../ui/kit';
import { useT } from '@amruta/app-core';

/**
 * People without an invite code who asked to join (only when Business settings ›
 * Sign-up is "Requests"). Approving makes them a customer, already linked to their
 * login: set their meals next. Their phone isn't verified: call them first if unsure.
 */
export default function JoinRequests() {
  const tr = useT();
  const { kitchenId } = useOwner();
  const refreshAll = useRefreshAll();
  const list = useQuery({
    queryKey: ['owner', kitchenId, 'join_requests'],
    queryFn: () => run<JoinRequest[]>(getSupabase().from('join_requests').select(cols('join_requests'))
      .eq('kitchen_id', kitchenId).order('created_at', { ascending: false }).limit(100)),
  });
  const decide = useAction(async (id: string, approve: boolean) => {
    const created = await rpc<string | null>('owner_decide_join', { p_id: id, p_approve: approve });
    await list.refetch();
    await refreshAll();
    if (created) router.push({ pathname: '/customer/[id]', params: { id: created } });
  });
  const pending = (list.data ?? []).filter((r) => r.status === 'pending');
  const done = (list.data ?? []).filter((r) => r.status !== 'pending');
  return (
    <Screen refreshing={list.isFetching} onRefresh={() => void list.refetch()}>
      <Stack.Screen options={{ title: tr('Join requests') }} />
      {list.isLoading ? <Loading /> : null}
      <ErrorText error={list.error ?? decide.error} />
      <Card>
        <H2>{tr('Waiting for you ({length})', { length: pending.length })}</H2>
        {pending.length === 0 ? <Empty text={tr('No new requests.')} /> : null}
        {pending.map((r) => (
          <Card key={r.id}>
            <ListRow title={`${r.full_name} · ${r.phone}`}
              subtitle={[r.location_text, r.note, formatDate(r.created_at.slice(0, 10))].filter(Boolean).join(' · ')} />
            <RowWrap>
              <Button small title={tr('Approve')} loading={decide.busy} onPress={() => void decide.run(r.id, true)} />
              <Button small variant="ghost" title={tr('Decline')} onPress={() => void decide.run(r.id, false)} />
            </RowWrap>
          </Card>
        ))}
        <Muted>{tr('The phone number is typed by them, not checked: call first if you don\'t know them.')}</Muted>
      </Card>
      {done.length > 0 ? (
        <Card>
          <H2>{tr('Earlier')}</H2>
          {done.map((r) => (
            <ListRow key={r.id} title={r.full_name} subtitle={formatDate(r.created_at.slice(0, 10))}
              right={<Badge text={r.status === 'approved' ? tr('Approved') : tr('Declined')} tone={r.status === 'approved' ? 'good' : 'neutral'} />}
              onPress={r.created_customer_id ? () => router.push({ pathname: '/customer/[id]', params: { id: r.created_customer_id! } }) : undefined} />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
