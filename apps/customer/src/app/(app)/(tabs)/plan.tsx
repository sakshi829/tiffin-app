import { router } from 'expo-router';
import { Badge, Body, Button, Card, Empty, ErrorText, H2, ListRow, Loading, Muted, rpc, Screen, useAction, VegDot, useT } from '@amruta/app-core';
import { addDays, formatDate, istToday, type MyOrder } from '@amruta/shared';
import { useClosures, useDailyMenus, useMySkips, useRefreshAll, useUpcomingOrders } from '../../../lib/queries';

const LABEL: Record<MyOrder['status'], string> = {
  scheduled: 'Coming', delivered: 'Delivered', not_delivered: 'Not delivered',
  skipped: 'Skipped', skipped_late: 'Skipped late', cancelled_closure: 'Kitchen closed',
};

/** The next week at a glance + leave + days off. */
export default function Plan() {
  const tr = useT();
  const today = istToday();
  const orders = useUpcomingOrders();
  const menus = useDailyMenus(today, addDays(today, 7));
  const skips = useMySkips();
  const closures = useClosures();
  const refreshAll = useRefreshAll();
  const cancelLeave = useAction(async (id: string) => { await rpc('customer_cancel_skip_range', { p_skip: id }); await refreshAll(); });

  const upcoming = (orders.data ?? []).filter((o) => o.order_date >= today);
  const dates = [...new Set(upcoming.map((o) => o.order_date))];

  return (
    <Screen refreshing={orders.isFetching} onRefresh={() => void refreshAll()}>
      <Button title={tr('Going on leave? Pause meals')} onPress={() => router.push('/leave')} />
      {orders.isLoading ? <Loading /> : null}
      <ErrorText error={orders.error} />
      {dates.length === 0 && !orders.isLoading ? <Empty text={tr('No meals planned. Ask the kitchen to start your plan.')} /> : null}
      {dates.map((d) => (
        <Card key={d}>
          <H2>{d === today ? tr('Today') : formatDate(d)}</H2>
          {upcoming.filter((o) => o.order_date === d).map((o) => {
            const menu = menus.data?.find((m) => m.menu_date === d && m.meal_slot === o.meal_slot)?.description;
            return (
              <ListRow key={o.order_id} left={<VegDot veg={o.is_veg} />}
                title={`${tr(o.meal_slot === 'lunch' ? 'Lunch' : 'Dinner')} · ${o.tiffin_type_name}`}
                subtitle={[o.addons.map((x) => `${x.name} × ${x.qty}`).join(', '), menu ?? ''].filter(Boolean).join(' · ')}
                right={<Badge text={tr(LABEL[o.status])} tone={o.status === 'scheduled' ? 'primary' : 'neutral'} />}
                onPress={() => router.push({ pathname: '/meal/[id]', params: { id: o.order_id, date: o.order_date } })} />
            );
          })}
        </Card>
      ))}

      <Card>
        <H2>{tr('My leave')}</H2>
        {(skips.data ?? []).length === 0 ? <Muted>{tr('No leave planned.')}</Muted> : null}
        {(skips.data ?? []).map((s) => (
          <ListRow key={s.id} title={tr('{formatDate} – {formatDate2}', { formatDate: formatDate(s.from_date), formatDate2: formatDate(s.to_date) })}
            subtitle={((slot: string) => s.created_by_role === 'owner' ? tr('{slot} · set by kitchen', { slot }) : slot)(
              s.meal_slot ? tr(s.meal_slot === 'lunch' ? 'Lunch' : 'Dinner') : tr('Lunch & dinner'))}
            right={s.created_by_role === 'customer'
              ? <Button small variant="ghost" title={tr('Cancel')} loading={cancelLeave.busy} onPress={() => void cancelLeave.run(s.id)} />
              : undefined} />
        ))}
        <ErrorText error={cancelLeave.error} />
        <Muted>{tr('Cancelling brings back meals that are still before their cutoff.')}</Muted>
      </Card>

      <Card>
        <H2>{tr('Kitchen days off')}</H2>
        {(closures.data ?? []).length === 0 ? <Muted>{tr('None planned.')}</Muted> : null}
        {(closures.data ?? []).map((c) => (
          <Body key={c.id}>{formatDate(c.closure_date)} · {c.meal_slot ? tr(c.meal_slot === 'lunch' ? 'lunch' : 'dinner') : tr('whole day')}{c.reason ? ` · ${c.reason}` : ''}</Body>
        ))}
      </Card>
    </Screen>
  );
}
