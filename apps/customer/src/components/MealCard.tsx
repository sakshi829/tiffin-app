import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Badge, Body, Button, Card, ErrorText, H2, Icon, ICONS, InfoPill, Muted, RowWrap, rpc, space, useAction, useColors, VegDot, useT } from '@amruta/app-core';
import { describeLocation, formatCountdown, formatRupees, istClock, istToday, mealActions, type MyOrder } from '@amruta/shared';
import { useRefreshAll, useSettings } from '../lib/queries';

const STATUS: Record<MyOrder['status'], { text: string; tone: 'good' | 'bad' | 'warn' | 'primary' | 'neutral' }> = {
  scheduled: { text: 'Coming', tone: 'primary' },
  delivered: { text: 'Delivered', tone: 'good' },
  not_delivered: { text: 'Not delivered', tone: 'bad' },
  skipped: { text: 'Skipped', tone: 'neutral' },
  skipped_late: { text: 'Skipped late', tone: 'warn' },
  cancelled_closure: { text: 'Kitchen closed', tone: 'neutral' },
};

/** `onDetailScreen`: hide the buttons that would open the screen we're already on. */
export function MealCard({ order, menuText, now, onDetailScreen }: { order: MyOrder; menuText?: string; now: number; onDetailScreen?: boolean }) {
  const tr = useT();
  const c = useColors();
  const refreshAll = useRefreshAll();
  const settings = useSettings();
  const a = mealActions(order, now, istToday());
  const [confirmLate, setConfirmLate] = useState(false);
  const [undoUntil, setUndoUntil] = useState<number | null>(null);

  useEffect(() => {
    if (!undoUntil) return;
    const t = setTimeout(() => setUndoUntil(null), Math.max(0, undoUntil - Date.now()));
    return () => clearTimeout(t);
  }, [undoUntil]);

  const skip = useAction(async () => {
    const r = await rpc<{ status: string }>('customer_skip_meal', { p_order: order.order_id });
    setConfirmLate(false);
    if (r.status === 'skipped') setUndoUntil(Date.now() + 5000);
    await refreshAll();
  });
  const unskip = useAction(async () => {
    await rpc('customer_unskip_meal', { p_order: order.order_id });
    setUndoUntil(null);
    await refreshAll();
  });

  const extrasTotal = order.addons.reduce((s, x) => s + x.qty * x.unit_price_paise, 0);
  const addonCountdown = formatCountdown(order.addon_cutoff_at, now);
  const locationCountdown = formatCountdown(order.location_cutoff_at, now);
  const open = () => router.push({ pathname: '/meal/[id]', params: { id: order.order_id, date: order.order_date } });

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon name={ICONS.meals} size={20} color={c.primary} />
        <View style={{ flex: 1 }}><H2>{order.meal_slot === 'lunch' ? tr('Lunch') : tr('Dinner')}</H2></View>
        <Badge text={tr(STATUS[order.status].text)} tone={STATUS[order.status].tone} />
      </View>
      <RowWrap><VegDot veg={order.is_veg} /><Body bold>{order.tiffin_type_name}</Body></RowWrap>
      {menuText ? <Muted>{tr('Today: {menuText}', { menuText: menuText })}</Muted> : null}
      {order.addons.length > 0 ? (
        <Body>{tr('Extras: {value} ({formatRupees})', { value: order.addons.map((x) => `${x.name} × ${x.qty}`).join(', '), formatRupees: formatRupees(extrasTotal) })}</Body>
      ) : null}

      {order.status === 'scheduled' ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name={ICONS.clock} size={18} color={c.muted} />
            <View style={{ flex: 1 }}><Body>{tr('Delivery around {istClock}', { istClock: istClock(order.delivery_at) })}</Body></View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name={ICONS.pin} size={18} color={order.location_path || order.location_text ? c.muted : c.warning} />
            <View style={{ flex: 1 }}>
              <Body>
                {order.location_path || order.location_text
                  ? tr('To: {place}', { place: describeLocation(order) })
                  : tr('⚠ Tell us where you are today')}
              </Body>
            </View>
          </View>
          {addonCountdown ? <InfoPill icon={ICONS.clock} text={tr('Extras / skip until {istClock} (in {addonCountdown})', { istClock: istClock(order.addon_cutoff_at), addonCountdown: addonCountdown })} /> : null}
          {!addonCountdown && locationCountdown ? <InfoPill icon={ICONS.pin} text={tr('Place can be changed until {istClock} (in {locationCountdown})', { istClock: istClock(order.location_cutoff_at), locationCountdown: locationCountdown })} /> : null}
        </>
      ) : null}
      {order.status === 'delivered' && order.box_kept_at ? <Muted>{tr('Box kept at: {box_kept_at}', { box_kept_at: order.box_kept_at })}</Muted> : null}

      <RowWrap>
        {a.canSetLocation ? (
          <Button small title={tr('Where I am')} onPress={() => router.push({ pathname: '/location', params: { orderId: order.order_id, date: order.order_date } })} />
        ) : null}
        {!onDetailScreen ? <Button small variant="secondary" title={a.canChangeExtras ? tr('Extras') : tr('Details')} onPress={open} /> : null}
        {a.canSkipFree ? <Button small variant="ghost" title={tr('Skip')} loading={skip.busy} onPress={() => void skip.run()} /> : null}
        {a.canSkipLate && !confirmLate ? <Button small variant="ghost" title={tr('Can\'t take it')} onPress={() => setConfirmLate(true)} /> : null}
        {a.canUnskip && !undoUntil ? <Button small variant="ghost" title={tr('I want it back')} loading={unskip.busy} onPress={() => void unskip.run()} /> : null}
        {a.canMarkBox && !order.box_kept_at && !onDetailScreen ? <Button small variant="ghost" title={tr('Where\'s the box?')} onPress={open} /> : null}
      </RowWrap>

      {undoUntil ? (
        <RowWrap>
          <Body>{tr('Skipped.')}</Body>
          <Button small variant="secondary" title={tr('Undo')} loading={unskip.busy} onPress={() => void unskip.run()} />
        </RowWrap>
      ) : null}

      {confirmLate ? (
        <Card>
          <Body>{tr('The cutoff has passed, so your food may already be cooking.')}</Body>
          <Muted>
            {tr('Kitchen rule: {free} late skips a month are free; after that {percent}% of the price is charged. This cannot be undone.', {
              free: settings.data?.free_late_skips_per_month ?? 1, percent: settings.data?.late_skip_charge_percent ?? 100 })}</Muted>
          <RowWrap>
            <Button small variant="danger" title={tr('Skip anyway')} loading={skip.busy} onPress={() => void skip.run()} />
            <Button small variant="ghost" title={tr('Keep my meal')} onPress={() => setConfirmLate(false)} />
          </RowWrap>
        </Card>
      ) : null}
      <ErrorText error={skip.error ?? unskip.error} />
    </Card>
  );
}
