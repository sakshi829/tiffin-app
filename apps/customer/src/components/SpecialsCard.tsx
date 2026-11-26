import { useQuery } from '@tanstack/react-query';
import { Badge, Body, Button, Card, ErrorText, H2, ListRow, Muted, rpc, useAction, VegDot, useT } from '@amruta/app-core';
import { formatDate, formatRupees, istClock, type SpecialOffer } from '@amruta/shared';
import { useMe } from '../lib/auth';
import { useRefreshAll } from '../lib/queries';

/** Festival / one-day menus the kitchen offers; one tap to pre-order before the deadline. */
export function SpecialsCard() {
  const tr = useT();
  const { kitchenId } = useMe();
  const refreshAll = useRefreshAll();
  const offers = useQuery({
    queryKey: ['me', kitchenId, 'specials'],
    queryFn: async () => (await rpc<SpecialOffer[]>('customer_special_menus', { p_kitchen: kitchenId }))
      .map((o) => ({ ...o, price_paise: Number(o.price_paise) })),
  });
  const order = useAction(async (id: string) => {
    await rpc('customer_order_special', { p_special: id });
    await offers.refetch();
    await refreshAll();
  });
  if (!offers.data || offers.data.length === 0) return null;
  return (
    <Card>
      <H2>{tr('Specials')}</H2>
      {offers.data.map((o) => {
        const closes = `${formatDate(new Date(Date.parse(o.order_deadline) + 330 * 60_000).toISOString().slice(0, 10))} ${istClock(o.order_deadline)}`;
        const open = Date.now() < Date.parse(o.order_deadline);
        return (
          <ListRow key={o.special_id} left={<VegDot veg={o.is_veg} />}
            title={`${o.name} · ${formatRupees(o.price_paise)}`}
            subtitle={[`${o.meal_slot === 'lunch' ? tr('Lunch') : tr('Dinner')} ${formatDate(o.menu_date)}`, o.description ?? '',
              open ? tr('Order by {time}', { time: closes }) : tr('Orders closed'), o.remaining !== null ? tr('{count} left', { count: o.remaining }) : ''].filter(Boolean).join(' · ')}
            right={o.my_order_id ? <Badge text={tr('Ordered')} tone="good" />
              : open && o.remaining !== 0 ? <Button small title={tr('Order')} loading={order.busy} onPress={() => void order.run(o.special_id)} />
              : <Badge text={o.remaining === 0 ? tr('Sold out') : tr('Closed')} />} />
        );
      })}
      <Muted>{tr('A special comes in addition to your usual meal and appears under My meals. You can cancel it like any meal before the cutoff.')}</Muted>
      <ErrorText error={order.error ?? offers.error} />
      {order.error ? <Body>{tr('Please try again.')}</Body> : null}
    </Card>
  );
}
