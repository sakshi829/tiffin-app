import { useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  Body, Button, Card, Empty, ErrorText, Field, H2, Loading, Muted, newIdempotencyKey, PrivateImage, rpc, run, Screen, Stepper, useAction, useT,
} from '@amruta/app-core';
import { getSupabase } from '../../../lib/supabase';
import { formatDate, formatRupees, istClock, istToday, mealActions } from '@amruta/shared';
import { useAddonMenu, useMyOrders, useNow, useRefreshAll } from '../../../lib/queries';
import { MealCard } from '../../../components/MealCard';

export default function MealDetail() {
  const tr = useT();
  const { id, date } = useLocalSearchParams<{ id: string; date: string }>();
  const orders = useMyOrders(date, date);
  const now = useNow();
  const order = orders.data?.find((o) => o.order_id === id);
  const menu = useAddonMenu(order?.status === 'scheduled' ? id : undefined);
  const refreshAll = useRefreshAll();
  const [boxText, setBoxText] = useState('');
  const [boxKey] = useState(newIdempotencyKey);
  const proof = useQuery({
    queryKey: ['me', 'proof', id],
    enabled: order?.status === 'delivered',
    queryFn: async () => (await run<{ path: string }[]>(getSupabase().from('delivery_proofs').select('path').eq('order_id', id)))[0]?.path ?? null,
  });

  const setQty = useAction(async (itemId: string, qty: number) => {
    const existing = order?.addons.find((x) => x.item_id === itemId);
    if (qty === 0 && existing) await rpc('customer_cancel_addon', { p_addon: existing.addon_id });
    else if (qty > 0) await rpc('customer_request_addon', { p_order: id, p_item: itemId, p_qty: qty });
    await refreshAll();
  });
  const markBox = useAction(async () => {
    await rpc('customer_mark_box_kept', { p_order: id, p_location_text: boxText.trim(), p_idempotency_key: boxKey });
    await refreshAll();
  });

  if (orders.isLoading) return <Loading />;
  if (!order) return <Screen><ErrorText error={orders.error ?? { message: 'NOT_FOUND' }} /></Screen>;
  const a = mealActions(order, now, istToday());
  const extrasTotal = order.addons.reduce((s, x) => s + x.qty * x.unit_price_paise, 0);

  return (
    <Screen refreshing={orders.isFetching} onRefresh={() => void refreshAll()}>
      <Stack.Screen options={{ title: `${tr(order.meal_slot === 'lunch' ? 'Lunch' : 'Dinner')} · ${formatDate(order.order_date)}` }} />
      <MealCard order={order} now={now} onDetailScreen />

      <Card>
        <H2>{tr('Extras')}</H2>
        {a.canChangeExtras ? <Muted>{tr('You can change extras until {istClock}.', { istClock: istClock(order.addon_cutoff_at) })}</Muted>
          : <Muted>{tr('Extras can no longer be changed for this meal.')}</Muted>}
        {a.canChangeExtras ? (
          <>
            {menu.isLoading ? <Loading /> : null}
            {(menu.data ?? []).length === 0 && !menu.isLoading ? <Empty text={tr('No extras offered right now.')} /> : null}
            {(menu.data ?? []).map((m) => (
              <Stepper key={m.item_id} label={tr('{name} · {formatRupees}', { name: m.name, formatRupees: formatRupees(m.price_paise) })} max={m.max_qty}
                value={order.addons.find((x) => x.item_id === m.item_id)?.qty ?? 0}
                onChange={(q) => void setQty.run(m.item_id, q)} />
            ))}
            <ErrorText error={setQty.error ?? menu.error} />
          </>
        ) : null}
        <Body>{tr('Tiffin {formatRupees} + extras {formatRupees2} = {formatRupees3}', { formatRupees: formatRupees(order.unit_price_paise), formatRupees2: formatRupees(extrasTotal), formatRupees3: formatRupees(order.unit_price_paise + extrasTotal) })}</Body>
        <Muted>{tr('You pay only if the meal is delivered.')}</Muted>
      </Card>

      {proof.data ? (
        <Card>
          <H2>{tr('Delivery photo')}</H2>
          <PrivateImage bucket="delivery-proofs" path={proof.data} alt={tr('Photo of your delivered tiffin')} />
          <Muted>{tr('Photos are deleted after 30 days.')}</Muted>
        </Card>
      ) : null}

      {a.canMarkBox ? (
        <Card>
          <H2>{tr('Where did you keep the box?')}</H2>
          {order.box_kept_at ? <Body>{tr('Saved: {box_kept_at}', { box_kept_at: order.box_kept_at })}</Body> : null}
          <Field label={tr('Place')} value={boxText} onChangeText={setBoxText} maxLength={120} placeholder={tr('e.g. Nurse station, Ward 5')} />
          <ErrorText error={markBox.error} />
          <Button small title={tr('Save')} loading={markBox.busy} disabled={!boxText.trim()} onPress={() => void markBox.run()} />
        </Card>
      ) : null}
    </Screen>
  );
}
