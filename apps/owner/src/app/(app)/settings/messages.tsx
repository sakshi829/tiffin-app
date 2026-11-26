import { router, Stack } from 'expo-router';
import { formatDate, istClock } from '@amruta/shared';
import { useChatThreads } from '../../../lib/queries';
import { Badge, Card, Empty, ErrorText, ListRow, Loading, Muted, Screen } from '../../../ui/kit';
import { useT } from '@amruta/app-core';

export default function Messages() {
  const tr = useT();
  const threads = useChatThreads();
  return (
    <Screen refreshing={threads.isFetching} onRefresh={() => void threads.refetch()}>
      <Stack.Screen options={{ title: tr('Messages') }} />
      <Muted>{tr('Customers can message you from their app. To start a chat, open a customer and tap Message.')}</Muted>
      {threads.isLoading ? <Loading /> : null}
      <ErrorText error={threads.error} />
      <Card>
        {(threads.data ?? []).length === 0 && !threads.isLoading ? <Empty text={tr('No messages yet.')} /> : null}
        {(threads.data ?? []).map((th) => (
          <ListRow key={th.customer_id} title={th.full_name}
            subtitle={`${th.last_from === 'owner' ? tr('You: ') : ''}${th.last_body}\n${formatDate(new Date(Date.parse(th.last_at) + 330 * 60_000).toISOString().slice(0, 10))} · ${istClock(th.last_at)}`}
            right={th.unread ? <Badge text={tr('{unread} new', { unread: th.unread })} tone="primary" /> : undefined}
            onPress={() => router.push({ pathname: '/customer/chat', params: { customerId: th.customer_id } })} />
        ))}
      </Card>
    </Screen>
  );
}
