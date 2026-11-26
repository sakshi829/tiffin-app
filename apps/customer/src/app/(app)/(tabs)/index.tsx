import { router } from 'expo-router';
import { Body, Button, Card, Empty, ErrorText, H1, H2, Loading, Muted, Screen, useT } from '@amruta/app-core';
import { addDays, formatDate, formatRupees, istToday } from '@amruta/shared';
import { useMe } from '../../../lib/auth';
import { useBalance, useClosures, useDailyMenus, useNow, useUpcomingOrders } from '../../../lib/queries';
import { MealCard } from '../../../components/MealCard';
import { SpecialsCard } from '../../../components/SpecialsCard';

export default function Home() {
  const tr = useT();
  const { customer } = useMe();
  const now = useNow();
  const today = istToday();
  const tomorrow = addDays(today, 1);
  const orders = useUpcomingOrders();
  const menus = useDailyMenus(today, tomorrow);
  const closures = useClosures();
  const balance = useBalance();

  const menuFor = (date: string, slot: string) => menus.data?.find((m) => m.menu_date === date && m.meal_slot === slot)?.description;
  const todays = (orders.data ?? []).filter((o) => o.order_date === today);
  const tomorrows = (orders.data ?? []).filter((o) => o.order_date === tomorrow);
  const nextClosure = closures.data?.[0];

  return (
    <Screen refreshing={orders.isFetching} onRefresh={() => { void orders.refetch(); void balance.refetch(); }}>
      <H1>{tr('Hi {value}', { value: customer.full_name.split(' ')[0] })}</H1>
      {customer.status !== 'active' ? (
        <Card><Body bold>{customer.status === 'paused' ? tr('Your service is paused.') : tr('Your service is stopped.')}</Body><Muted>{tr('Talk to the kitchen to restart it.')}</Muted></Card>
      ) : null}
      {nextClosure ? (
        <Card>
          <Body bold>{tr('Kitchen closed {date}', { date: `${formatDate(nextClosure.closure_date)}${nextClosure.meal_slot ? ` (${tr(nextClosure.meal_slot === 'lunch' ? 'lunch' : 'dinner')})` : ''}` })}</Body>
          {nextClosure.reason ? <Muted>{nextClosure.reason}</Muted> : null}
          <Muted>{tr('No charge for those meals.')}</Muted>
        </Card>
      ) : null}

      <SpecialsCard />

      <H2>{tr('Today · {formatDate}', { formatDate: formatDate(today) })}</H2>
      {orders.isLoading ? <Loading /> : null}
      <ErrorText error={orders.error} />
      {!orders.isLoading && todays.length === 0 ? <Empty text={tr('No meals today.')} /> : null}
      {todays.map((o) => <MealCard key={o.order_id} order={o} now={now} menuText={menuFor(o.order_date, o.meal_slot)} />)}

      <H2>{tr('Tomorrow · {formatDate}', { formatDate: formatDate(tomorrow) })}</H2>
      {!orders.isLoading && tomorrows.length === 0 ? <Empty text={tr('No meals tomorrow.')} /> : null}
      {tomorrows.map((o) => <MealCard key={o.order_id} order={o} now={now} menuText={menuFor(o.order_date, o.meal_slot)} />)}

      <Card>
        {balance.data !== undefined ? (
          <Body bold>{balance.data > 0 ? tr('To pay: {amount}', { amount: formatRupees(balance.data) }) : balance.data < 0 ? tr('Advance left: {amount}', { amount: formatRupees(-balance.data) }) : tr('Nothing to pay')}</Body>
        ) : null}
        <Button small variant="secondary" title={tr('Going on leave?')} onPress={() => router.push('/leave')} />
      </Card>
    </Screen>
  );
}
