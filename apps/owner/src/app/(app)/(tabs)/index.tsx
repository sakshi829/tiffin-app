import { useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { PrivateImage, useT } from '@amruta/app-core';
import { getSupabase } from '../../../lib/supabase';
import {
  addDays, describeLocation, describeSlotTimes, formatDate, groupByLocation, istToday, summarizeDay, telLink,
  whatsappLink, type DayOrder, type MealSlot,
} from '@amruta/shared';
import { useOwner } from '../../../lib/auth';
import { rpc, run } from '../../../lib/api';
import { useStepUp } from '../../../lib/stepup';
import { useDayOrders, useMealSlots, useRefreshAll, useSettings, useSlotOverrides, useStaff } from '../../../lib/queries';
import {
  Badge, Body, Button, Card, Chips, Empty, ErrorText, Field, H2, ListRow, Loading, Muted, RowWrap, Screen, useAction, VegDot,
} from '../../../ui/kit';

type View3 = 'kitchen' | 'packing' | 'delivery';

const STATUS_LABEL: Record<DayOrder['status'], string> = {
  scheduled: 'To deliver', delivered: 'Delivered', not_delivered: 'Not delivered',
  skipped: 'Skipped', skipped_late: 'Skipped late', cancelled_closure: 'Closed',
};

function defaultSlot(): MealSlot {
  const istHour = new Date(Date.now() + 330 * 60_000).getUTCHours();
  return istHour < 16 ? 'lunch' : 'dinner';
}

export default function Today() {
  const tr = useT();
  const today = istToday();
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<MealSlot>(defaultSlot);
  const [view, setView] = useState<View3>('kitchen');
  const orders = useDayOrders(date);
  const slots = useMealSlots();
  const overrides = useSlotOverrides();

  const slotOrders = useMemo(() => (orders.data ?? []).filter((o) => o.meal_slot === slot), [orders.data, slot]);
  const summary = useMemo(() => summarizeDay(orders.data ?? []).find((s) => s.meal_slot === slot), [orders.data, slot]);
  const slotRow = slots.data?.find((s) => s.meal_slot === slot);
  const override = overrides.data?.find((o) => o.override_date === date && o.meal_slot === slot);

  return (
    <Screen refreshing={orders.isFetching} onRefresh={() => void orders.refetch()}>
      <Chips value={date} onChange={setDate} options={[
        { value: addDays(today, -1), label: 'Yesterday' }, { value: today, label: 'Today' }, { value: addDays(today, 1), label: 'Tomorrow' },
      ]} />
      <Muted>{formatDate(date)}</Muted>
      <Chips value={slot} onChange={setSlot} options={[{ value: 'lunch', label: 'Lunch' }, { value: 'dinner', label: 'Dinner' }]} />
      {slotRow ? <Muted>{describeSlotTimes(slotRow, override)}{override ? tr(' (changed for this day)') : ''}</Muted> : null}
      <Chips value={view} onChange={setView} options={[
        { value: 'kitchen', label: 'Kitchen' }, { value: 'packing', label: 'Packing' }, { value: 'delivery', label: 'Delivery' },
      ]} />

      {orders.isLoading ? <Loading /> : null}
      <ErrorText error={orders.error} />
      {summary && view === 'kitchen' ? <KitchenView summary={summary} /> : null}
      {view === 'packing' ? <PackingView orders={slotOrders} /> : null}
      {view === 'delivery' ? <DeliveryView orders={slotOrders} date={date} /> : null}
      <RegenerateOrders />
    </Screen>
  );
}

function KitchenView({ summary }: { summary: ReturnType<typeof summarizeDay>[number] }) {
  const tr = useT();
  return (
    <>
      <Card>
        <H2>{tr('{total} tiffins to make', { total: summary.total })}</H2>
        <Body>{tr('Veg {veg} · Non-veg {nonVeg}', { veg: summary.veg, nonVeg: summary.nonVeg })}</Body>
        {summary.byType.map((t) => (
          <RowWrap key={t.name}><VegDot veg={t.is_veg} /><Body>{t.name}: <Body bold>{t.count}</Body></Body></RowWrap>
        ))}
        {summary.total === 0 ? <Muted>{tr('No meals for this slot.')}</Muted> : null}
      </Card>
      <Button small variant="secondary" title={tr('Prep & shopping list, leftovers')} onPress={() => router.push('/today/prep')} />
      <Card>
        <H2>{tr('Extras')}</H2>
        {summary.addons.length === 0 ? <Muted>{tr('No extras.')}</Muted> : summary.addons.map((a) => <Body key={a.name}>{a.name}: {a.qty}</Body>)}
      </Card>
      <Card>
        <H2>{tr('Status')}</H2>
        <Body>{tr('Delivered {delivered} · To deliver {scheduled}', { delivered: summary.status.delivered, scheduled: summary.status.scheduled })}</Body>
        <Muted>{tr('Skipped {skipped} · Skipped late {skipped_late} · Not delivered {not_delivered} · Closed {cancelled_closure}', { skipped: summary.status.skipped, skipped_late: summary.status.skipped_late, not_delivered: summary.status.not_delivered, cancelled_closure: summary.status.cancelled_closure })}</Muted>
      </Card>
    </>
  );
}

function PackingView({ orders }: { orders: DayOrder[] }) {
  const tr = useT();
  const toPack = orders.filter((o) => o.status === 'scheduled' || o.status === 'delivered');
  if (toPack.length === 0) return <Empty text={tr('Nothing to pack.')} />;
  return (
    <Card>
      {toPack.sort((a, b) => a.customer_name.localeCompare(b.customer_name)).map((o) => (
        <ListRow key={o.order_id} left={<VegDot veg={o.is_veg} />} title={o.customer_name}
          subtitle={[o.tiffin_type_name, o.addons.map((a) => `${a.name} × ${a.qty}`).join(', '), o.food_notes ? tr('Note: {note}', { note: o.food_notes }) : '']
            .filter(Boolean).join(' · ')}
          right={o.status === 'delivered' ? <Badge text={tr('Delivered')} tone="good" /> : undefined} />
      ))}
    </Card>
  );
}

function DeliveryView({ orders, date }: { orders: DayOrder[]; date: string }) {
  const tr = useT();
  const { kitchenId } = useOwner();
  const refreshAll = useRefreshAll();
  const staff = useStaff();
  const [open, setOpen] = useState<string | null>(null);
  const active = orders.filter((o) => ['scheduled', 'delivered', 'not_delivered'].includes(o.status));
  const others = orders.filter((o) => !active.includes(o));
  const groups = groupByLocation(active);
  const deliveryStaff = (staff.data ?? []).filter((s) => s.active && (s.role === 'delivery' || s.role === 'kitchen_delivery'));
  const unassigned = active.filter((o) => o.status === 'scheduled' && !o.assigned_staff_id);

  const assign = useAction(async (staffId: string) => {
    await rpc('owner_assign_orders', { p_kitchen: kitchenId, p_orders: unassigned.map((o) => o.order_id), p_staff: staffId });
    await refreshAll();
  });

  return (
    <>
      {unassigned.length > 0 && deliveryStaff.length > 0 && date >= istToday() ? (
        <Card>
          <Body>{tr('{length} deliveries not assigned. Assign all to:', { length: unassigned.length })}</Body>
          <RowWrap>
            {deliveryStaff.map((s) => (
              <Button key={s.id} small variant="secondary" title={s.display_name} loading={assign.busy} onPress={() => void assign.run(s.id)} />
            ))}
          </RowWrap>
          <ErrorText error={assign.error} />
        </Card>
      ) : null}
      {groups.length === 0 ? <Empty text={tr('No deliveries.')} /> : null}
      {groups.map((g) => (
        <Card key={g.location}>
          <H2>{g.location} ({g.orders.length})</H2>
          {g.orders.map((o) => (
            <View key={o.order_id}>
              <ListRow left={<VegDot veg={o.is_veg} />} title={o.customer_name}
                subtitle={[o.tiffin_type_name, o.addons.map((a) => `${a.name} × ${a.qty}`).join(', '),
                  o.location_text && o.location_path ? describeLocation(o) : '', o.assigned_staff_name ? `By ${o.assigned_staff_name}` : '']
                  .filter(Boolean).join(' · ')}
                right={<Badge text={tr(STATUS_LABEL[o.status])} tone={o.status === 'delivered' ? 'good' : o.status === 'not_delivered' ? 'bad' : 'primary'} />}
                onPress={() => setOpen(open === o.order_id ? null : o.order_id)} />
              {open === o.order_id ? <OrderActions order={o} onDone={() => setOpen(null)} /> : null}
            </View>
          ))}
        </Card>
      ))}
      {others.length > 0 ? (
        <Card>
          <H2>{tr('Not cooking ({length})', { length: others.length })}</H2>
          {others.map((o) => (
            <View key={o.order_id}>
              <ListRow title={o.customer_name} subtitle={o.tiffin_type_name} right={<Badge text={tr(STATUS_LABEL[o.status])} />}
                onPress={() => setOpen(open === o.order_id ? null : o.order_id)} />
              {open === o.order_id && o.status !== 'cancelled_closure' ? <OrderActions order={o} onDone={() => setOpen(null)} /> : null}
            </View>
          ))}
        </Card>
      ) : null}
    </>
  );
}

/** Owner corrections. The database reverses and re-applies charges so the ledger always matches. */
function OrderActions({ order, onDone }: { order: DayOrder; onDone: () => void }) {
  const tr = useT();
  const refreshAll = useRefreshAll();
  const [reason, setReason] = useState('');
  const withStepUp = useStepUp();
  const setStatus = useAction(async (status: string, why: string | null) => {
    // Undoing a delivered meal refunds it, so the database asks for the authenticator code.
    await withStepUp(() => rpc('owner_set_order_status', { p_order: order.order_id, p_status: status, p_reason: why }));
    await refreshAll();
    onDone();
  });
  const call = telLink(order.customer_phone);
  const wa = whatsappLink(order.customer_phone);
  return (
    <View style={{ gap: 8, paddingVertical: 8 }}>
      {order.food_notes ? <Muted>{tr('Note: {food_notes}', { food_notes: order.food_notes })}</Muted> : null}
      {order.not_delivered_reason ? <Muted>{tr('Reason: {not_delivered_reason}', { not_delivered_reason: order.not_delivered_reason })}</Muted> : null}
      <RowWrap>
        {order.status !== 'delivered' ? <Button small title={tr('Delivered')} loading={setStatus.busy} onPress={() => void setStatus.run('delivered', null)} /> : null}
        {order.status !== 'scheduled' ? <Button small variant="secondary" title={tr('Back to \'to deliver\'')} loading={setStatus.busy}
          onPress={() => void setStatus.run('scheduled', reason.trim() || null)} /> : null}
        {order.status !== 'skipped' ? <Button small variant="secondary" title={tr('Skip (no charge)')} loading={setStatus.busy}
          onPress={() => void setStatus.run('skipped', reason.trim() || null)} /> : null}
      </RowWrap>
      {order.status !== 'not_delivered' ? (
        <>
          <Field label={tr('Reason (needed for \'Not delivered\')')} value={reason} onChangeText={setReason} maxLength={200} />
          <Button small variant="danger" title={tr('Not delivered')} disabled={!reason.trim()} loading={setStatus.busy}
            onPress={() => void setStatus.run('not_delivered', reason.trim())} />
        </>
      ) : null}
      {order.status === 'delivered' ? <DeliveryPhoto orderId={order.order_id} /> : null}
      <RowWrap>
        {call ? <Button small variant="ghost" title={tr('Call')} onPress={() => void Linking.openURL(call)} /> : null}
        {wa ? <Button small variant="ghost" title={tr('WhatsApp')} onPress={() => void Linking.openURL(wa)} /> : null}
      </RowWrap>
      <ErrorText error={setStatus.error} />
    </View>
  );
}

/** Photo the delivery person took at the spot (kept 30 days). */
function DeliveryPhoto({ orderId }: { orderId: string }) {
  const tr = useT();
  const [show, setShow] = useState(false);
  const proof = useQuery({
    queryKey: ['delivery_proof', orderId],
    queryFn: async () => (await run<{ path: string }[]>(getSupabase().from('delivery_proofs').select('path').eq('order_id', orderId)))[0]?.path ?? null,
  });
  if (!proof.data) return proof.isLoading ? null : <Muted>{tr('No delivery photo.')}</Muted>;
  return (
    <>
      <Button small variant="ghost" title={show ? tr('Hide delivery photo') : tr('See delivery photo')} onPress={() => setShow(!show)} />
      {show ? <PrivateImage bucket="delivery-proofs" path={proof.data} alt={tr('Delivery photo')} /> : null}
    </>
  );
}

/** Orders are created automatically every night; this re-checks now (e.g. after adding customers). */
function RegenerateOrders() {
  const tr = useT();
  const { kitchenId } = useOwner();
  const settings = useSettings();
  const refreshAll = useRefreshAll();
  const [result, setResult] = useState<string | null>(null);
  const gen = useAction(async () => {
    const today = istToday();
    const n = await rpc<number>('owner_generate_orders', {
      p_kitchen: kitchenId, p_from: today, p_to: addDays(today, settings.data?.order_horizon_days ?? 7),
    });
    setResult(n === 0 ? tr('All orders are already up to date.') : n === 1 ? tr('1 new order created.') : tr('{count} new orders created.', { count: n }));
    await refreshAll();
  });
  return (
    <Card>
      <Muted>{tr('Orders for the next {days} days are created automatically every night.', { days: settings.data?.order_horizon_days ?? 7 })}</Muted>
      <Button small variant="secondary" title={tr('Check orders now')} loading={gen.busy} onPress={() => void gen.run()} />
      {result ? <Muted>{result}</Muted> : null}
      <ErrorText error={gen.error} />
    </Card>
  );
}
