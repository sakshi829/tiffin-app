import { useState } from 'react';
import { router, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { addDays, cols, formatDate, formatRupees, isIsoDate, istClock, istToday, istToIso, parseTime, type MealSlot, type SpecialMenu } from '@amruta/shared';
import { getSupabase } from '../../../lib/supabase';
import { AppError, rpc, run } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { priceOn, useRefreshAll, useTiffinTypes } from '../../../lib/queries';
import {
  Badge, Body, Button, Card, Chips, DateField, Empty, ErrorText, Field, H2, ListRow, Muted, Screen, useAction,
} from '../../../ui/kit';
import { useT } from '@amruta/app-core';

/** Festival / one-day menus customers can pre-order before a deadline. */
export default function Specials() {
  const tr = useT();
  const { kitchenId } = useOwner();
  const types = useTiffinTypes();
  const refreshAll = useRefreshAll();
  const list = useQuery({
    queryKey: ['owner', kitchenId, 'specials'],
    queryFn: () => run<SpecialMenu[]>(getSupabase().from('special_menus').select(cols('special_menus'))
      .eq('kitchen_id', kitchenId).gte('menu_date', istToday()).order('menu_date')),
  });
  const specialTypes = (types.data ?? []).filter((t) => t.is_special && t.active);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [date, setDate] = useState(addDays(istToday(), 3));
  const [slot, setSlot] = useState<MealSlot>('lunch');
  const [deadlineDate, setDeadlineDate] = useState(addDays(istToday(), 2));
  const [deadlineTime, setDeadlineTime] = useState('8:00 PM');
  const [max, setMax] = useState('');

  const save = useAction(async () => {
    const t = parseTime(deadlineTime);
    const m = max.trim() ? Number(max) : null;
    if (!typeId) throw new AppError('CHOOSE_TIFFIN');
    if (!isIsoDate(date) || !isIsoDate(deadlineDate)) throw new AppError('INVALID_DATES');
    if (!t) throw new AppError('INVALID_TIME');
    if (m !== null && (!Number.isInteger(m) || m < 1)) throw new AppError('CHECK_NUMBERS');
    await rpc('owner_save_special', {
      p_id: null, p_kitchen: kitchenId, p_tiffin_type: typeId, p_date: date, p_meal_slot: slot,
      p_deadline: istToIso(deadlineDate, t), p_max: m, p_active: true,
    });
    await refreshAll();
    await list.refetch();
  });
  const toggle = useAction(async (s: SpecialMenu) => {
    await rpc('owner_save_special', {
      p_id: s.id, p_kitchen: kitchenId, p_tiffin_type: s.tiffin_type_id, p_date: s.menu_date, p_meal_slot: s.meal_slot,
      p_deadline: s.order_deadline, p_max: s.max_orders, p_active: !s.active,
    });
    await list.refetch();
  });

  return (
    <Screen refreshing={list.isFetching} onRefresh={() => void list.refetch()}>
      <Stack.Screen options={{ title: tr('Specials') }} />
      <Card>
        <H2>{tr('Offer a special')}</H2>
        {specialTypes.length === 0 ? (
          <>
            <Muted>{tr('First create a tiffin type with "Special (one-day menu)" switched on and a fixed price.')}</Muted>
            <Button small variant="secondary" title={tr('Create special tiffin type')} onPress={() => router.push('/menu/tiffin')} />
          </>
        ) : (
          <>
            <Chips label={tr('Which special')} value={typeId} onChange={setTypeId} options={specialTypes.map((t) => {
              const p = priceOn(t.prices, date);
              return { value: t.id, label: `${t.name}${p ? ` · ${formatRupees(p.price_paise)}` : ''}` };
            })} />
            <DateField label={tr('Served on')} value={date} onChange={setDate} />
            <Chips value={slot} onChange={setSlot} options={[{ value: 'lunch', label: 'Lunch' }, { value: 'dinner', label: 'Dinner' }]} />
            <DateField label={tr('Orders close on')} value={deadlineDate} onChange={setDeadlineDate} />
            <Field label={tr('Orders close at')} value={deadlineTime} onChangeText={setDeadlineTime} placeholder={tr('8:00 PM')}
              error={deadlineTime && !parseTime(deadlineTime) ? tr('e.g. 8:00 PM') : null} />
            <Field label={tr('Maximum orders (empty = no limit)')} value={max} onChangeText={setMax} numeric="integer" min={1} max={1000} maxLength={4} />
            <Muted>{tr('Customers see it on their Today screen and order with one tap. It appears in your Today lists like any meal and is charged when delivered.')}</Muted>
            <ErrorText error={save.error} />
            <Button title={tr('Offer it')} loading={save.busy} disabled={!typeId} onPress={() => void save.run()} />
          </>
        )}
      </Card>
      <Card>
        <H2>{tr('Upcoming specials')}</H2>
        {(list.data ?? []).length === 0 ? <Empty text={tr('None yet.')} /> : null}
        {(list.data ?? []).map((s) => (
          <ListRow key={s.id} title={`${types.data?.find((t) => t.id === s.tiffin_type_id)?.name ?? tr('Special')} · ${tr(s.meal_slot === 'lunch' ? 'Lunch' : 'Dinner')}`}
            subtitle={((v: { date: string; closeDate: string; time: string }) => s.max_orders
              ? tr('{date} · orders close {closeDate} {time} · max {max}', { ...v, max: s.max_orders })
              : tr('{date} · orders close {closeDate} {time}', v))({ date: formatDate(s.menu_date), closeDate: formatDate(new Date(Date.parse(s.order_deadline) + 330 * 60_000).toISOString().slice(0, 10)), time: istClock(s.order_deadline) })}
            right={<Button small variant="ghost" title={s.active ? tr('Stop') : tr('Restart')} onPress={() => void toggle.run(s)} />} />
        ))}
        {(list.data ?? []).some((s) => !s.active) ? <Badge text={tr('Stopped specials are hidden from customers')} /> : null}
        <ErrorText error={toggle.error ?? list.error} />
        <Body>{tr('See who ordered on Today (choose that date).')}</Body>
      </Card>
    </Screen>
  );
}
