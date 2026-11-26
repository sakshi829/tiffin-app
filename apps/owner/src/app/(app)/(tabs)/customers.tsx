import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { formatRupees, type CustomerStatus } from '@amruta/shared';
import { useBalances } from '../../../lib/queries';
import { Badge, Button, Card, Chips, Empty, ErrorText, Field, ListRow, Loading, Muted, Screen } from '../../../ui/kit';
import { useT } from '@amruta/app-core';

type Filter = CustomerStatus | 'all';

export default function Customers() {
  const tr = useT();
  const balances = useBalances();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('active');

  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (balances.data ?? [])
      .filter((c) => filter === 'all' || c.status === filter)
      .filter((c) => !s || c.full_name.toLowerCase().includes(s) || (c.phone ?? '').includes(s))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [balances.data, search, filter]);

  return (
    <Screen refreshing={balances.isFetching} onRefresh={() => void balances.refetch()}>
      <Button title={tr('Add customer')} onPress={() => router.push('/customer/edit')} />
      <Field label={tr('Search name or phone')} value={search} onChangeText={setSearch} autoCapitalize="none" />
      <Chips value={filter} onChange={setFilter} options={[
        { value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' },
        { value: 'stopped', label: 'Stopped' }, { value: 'all', label: 'All' },
      ]} />
      {balances.isLoading ? <Loading /> : null}
      <ErrorText error={balances.error} />
      <Card>
        {list.length === 0 && !balances.isLoading ? <Empty text={tr('No customers here yet.')} /> : null}
        {list.map((c) => (
          <ListRow key={c.customer_id} title={c.full_name}
            subtitle={[c.phone, c.linked ? tr('App linked') : tr('Not linked yet'), c.pending_payments ? (c.pending_payments === 1 ? tr('1 payment to confirm') : tr('{count} payments to confirm', { count: c.pending_payments })) : '']
              .filter(Boolean).join(' · ')}
            right={c.balance_paise > 0 ? <Badge text={tr('Due {formatRupees}', { formatRupees: formatRupees(c.balance_paise) })} tone="warn" />
              : c.balance_paise < 0 ? <Badge text={tr('Advance {formatRupees}', { formatRupees: formatRupees(-c.balance_paise) })} tone="good" /> : undefined}
            onPress={() => router.push({ pathname: '/customer/[id]', params: { id: c.customer_id } })} />
        ))}
      </Card>
      <Muted>{tr('Archived customers are hidden. Balances update when meals are delivered and payments confirmed.')}</Muted>
    </Screen>
  );
}
