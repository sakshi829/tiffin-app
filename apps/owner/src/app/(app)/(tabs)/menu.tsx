import { useState } from 'react';
import { router } from 'expo-router';
import { formatDate, formatRupees, istToday } from '@amruta/shared';
import { priceOn, upcomingPrice, useItems, useTiffinTypes } from '../../../lib/queries';
import { Badge, Button, Card, Chips, Empty, ErrorText, H2, ListRow, Loading, Muted, Screen, VegDot } from '../../../ui/kit';
import { useT } from '@amruta/app-core';

export default function Menu() {
  const tr = useT();
  const [tab, setTab] = useState<'tiffins' | 'items'>('tiffins');
  const items = useItems();
  const types = useTiffinTypes();
  const today = istToday();

  const priceText = (prices: { price_paise: number; effective_from: string }[]) => {
    const now = priceOn(prices, today);
    const next = upcomingPrice(prices, today);
    return [now ? formatRupees(now.price_paise) : tr('No price'), next ? tr('→ {price} from {date}', { price: formatRupees(next.price_paise), date: formatDate(next.effective_from) }) : '']
      .filter(Boolean).join(' ');
  };

  return (
    <Screen refreshing={items.isFetching || types.isFetching} onRefresh={() => { void items.refetch(); void types.refetch(); }}>
      <Chips value={tab} onChange={setTab} options={[{ value: 'tiffins', label: 'Tiffin types' }, { value: 'items', label: 'Items & extras' }]} />
      <Button small variant="secondary" title={tr('Today\'s menu (what\'s cooking)')} onPress={() => router.push('/menu/daily')} />
      <Button small variant="secondary" title={tr('Specials (festival / one-day menus)')} onPress={() => router.push('/menu/specials')} />
      <Button small variant="secondary" title={tr('Ingredients (for the shopping list)')} onPress={() => router.push('/menu/ingredients')} />
      {items.isLoading || types.isLoading ? <Loading /> : null}
      <ErrorText error={items.error ?? types.error} />

      {tab === 'tiffins' ? (
        <Card>
          <H2>{tr('Tiffin types')}</H2>
          <Muted>{tr('A tiffin type is made of items, e.g. "Veg Standard = 4 roti + sabzi + dal + rice".')}</Muted>
          {(types.data ?? []).length === 0 ? <Empty text={tr('No tiffin types yet. Add items first, then build a tiffin.')} /> : null}
          {(types.data ?? []).map((t) => (
            <ListRow key={t.id} left={<VegDot veg={t.is_veg} />} title={t.name}
              subtitle={t.pricing_mode === 'fixed'
                ? `${priceText(t.prices)} · ${t.items.length === 1 ? tr('1 item') : tr('{count} items', { count: t.items.length })}`
                : (t.items.length === 1 ? tr('Price = sum of its items · 1 item') : tr('Price = sum of its items · {count} items', { count: t.items.length }))}
              right={t.active ? undefined : <Badge text={tr('Hidden')} />}
              onPress={() => router.push({ pathname: '/menu/tiffin', params: { id: t.id } })} />
          ))}
          <Button title={tr('Add tiffin type')} onPress={() => router.push('/menu/tiffin')} />
        </Card>
      ) : (
        <Card>
          <H2>{tr('Items & extras')}</H2>
          <Muted>{tr('Main items go inside tiffins. Extras (egg, salad, bhakri...) can also be added to a meal.')}</Muted>
          {(items.data ?? []).length === 0 ? <Empty text={tr('No items yet.')} /> : null}
          {(items.data ?? []).map((i) => (
            <ListRow key={i.id} left={<VegDot veg={i.is_veg} />} title={i.name}
              subtitle={[priceText(i.prices), i.category === 'addon' ? tr('Extra') : tr('Main'), i.customer_orderable ? tr('Customers can request') : '']
                .filter(Boolean).join(' · ')}
              right={i.active ? undefined : <Badge text={tr('Hidden')} />}
              onPress={() => router.push({ pathname: '/menu/item', params: { id: i.id } })} />
          ))}
          <Button title={tr('Add item')} onPress={() => router.push('/menu/item')} />
        </Card>
      )}
    </Screen>
  );
}
