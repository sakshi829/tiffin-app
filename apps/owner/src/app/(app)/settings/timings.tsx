import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { describeSlotTimes, formatDate, formatTime, isIsoDate, istToday, parseTime, type MealSlotRow } from '@amruta/shared';
import { getSupabase } from '../../../lib/supabase';
import { AppError, run } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useMealSlots, useRefreshAll, useSlotOverrides } from '../../../lib/queries';
import {
  Body, Button, Card, Chips, DateField, ErrorText, Field, H2, ListRow, Loading, Muted, Screen, SwitchRow, useAction,
} from '../../../ui/kit';
import { useT } from '@amruta/app-core';

export default function Timings() {
  const tr = useT();
  const slots = useMealSlots();
  const overrides = useSlotOverrides();
  if (slots.isLoading) return <Loading />;
  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Meal timings') }} />
      <Muted>{tr('Customers see these times in their app. The server enforces every cutoff, so phone clocks don\'t matter.')}</Muted>
      <ErrorText error={slots.error} />
      {(slots.data ?? []).map((s) => <SlotEditor key={s.id} slot={s} />)}
      <OneDayChange existing={overrides.data ?? []} />
    </Screen>
  );
}

function SlotEditor({ slot }: { slot: MealSlotRow }) {
  const tr = useT();
  const refreshAll = useRefreshAll();
  const [delivery, setDelivery] = useState('');
  const [addonMode, setAddonMode] = useState<'relative' | 'fixed'>('relative');
  const [addonMinutes, setAddonMinutes] = useState('');
  const [addonTime, setAddonTime] = useState('');
  const [locMinutes, setLocMinutes] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    setDelivery(formatTime(slot.delivery_time)); setAddonMode(slot.addon_cutoff_mode);
    setAddonMinutes(String(slot.addon_cutoff_minutes)); setAddonTime(slot.addon_cutoff_time ? formatTime(slot.addon_cutoff_time) : '');
    setLocMinutes(String(slot.location_cutoff_minutes)); setActive(slot.active);
  }, [slot]);

  const save = useAction(async () => {
    const d = parseTime(delivery);
    const am = Number(addonMinutes);
    const lm = Number(locMinutes);
    const at = addonMode === 'fixed' ? parseTime(addonTime) : null;
    if (!d || (addonMode === 'fixed' && !at)) throw new AppError('INVALID_TIME');
    if (!Number.isInteger(am) || am < 0 || am > 720 || !Number.isInteger(lm) || lm < 0 || lm > 720) throw new AppError('CHECK_NUMBERS');
    // Optimistic locking: if someone else changed it meanwhile, nothing is overwritten.
    const rows = await run<{ id: string }[]>(getSupabase().from('meal_slots').update({
      delivery_time: d, addon_cutoff_mode: addonMode, addon_cutoff_minutes: am, addon_cutoff_time: at,
      location_cutoff_mode: 'relative', location_cutoff_minutes: lm, location_cutoff_time: null, active,
    }).eq('id', slot.id).eq('version', slot.version).select('id'));
    if (rows.length === 0) throw new AppError('INVALID_STATUS');
    await refreshAll();
  });

  return (
    <Card>
      <H2>{slot.meal_slot === 'lunch' ? tr('Lunch') : tr('Dinner')}</H2>
      <Muted>{tr('Now: {describeSlotTimes}', { describeSlotTimes: describeSlotTimes(slot) })}</Muted>
      <Field label={tr('Delivery time')} value={delivery} onChangeText={setDelivery} placeholder={tr('1:30 PM')}
        error={delivery && !parseTime(delivery) ? tr('e.g. 1:30 PM or 13:30') : null} />
      <Chips label={tr('Extras / skip cutoff')} value={addonMode} onChange={setAddonMode} options={[
        { value: 'relative', label: 'Minutes before delivery' }, { value: 'fixed', label: 'Fixed time' },
      ]} />
      {addonMode === 'relative' ? (
        <Field label={tr('Minutes before delivery')} value={addonMinutes} onChangeText={setAddonMinutes} numeric="integer" min={0} max={720} maxLength={3}
          hint={tr('150 = 2½ hours')} />
      ) : (
        <Field label={tr('Cutoff time')} value={addonTime} onChangeText={setAddonTime} placeholder={tr('11:00 AM')} />
      )}
      <Field label={tr('Location changes until (minutes before delivery)')} value={locMinutes} onChangeText={setLocMinutes}
        numeric="integer" min={0} max={720} maxLength={3} />
      <SwitchRow label={tr('Serving this meal')} value={active} onValueChange={setActive} />
      <ErrorText error={save.error} />
      <Button small title={tr('Save')} loading={save.busy} onPress={() => void save.run()} />
    </Card>
  );
}

function OneDayChange({ existing }: { existing: { override_date: string; meal_slot: string; delivery_time: string | null; addon_cutoff_time: string | null; note: string | null }[] }) {
  const tr = useT();
  const { kitchenId } = useOwner();
  const refreshAll = useRefreshAll();
  const [date, setDate] = useState(istToday());
  const [slot, setSlot] = useState<'lunch' | 'dinner'>('lunch');
  const [delivery, setDelivery] = useState('');
  const [cutoff, setCutoff] = useState('');
  const [note, setNote] = useState('');

  const add = useAction(async () => {
    const d = delivery.trim() ? parseTime(delivery) : null;
    const c = cutoff.trim() ? parseTime(cutoff) : null;
    if (!isIsoDate(date)) throw new AppError('INVALID_DATES');
    if (date < istToday()) throw new AppError('PAST_DATE');
    if ((delivery.trim() && !d) || (cutoff.trim() && !c)) throw new AppError('INVALID_TIME');
    if (!d && !c) throw new AppError('TIME_REQUIRED');
    await run(getSupabase().from('slot_overrides').insert({
      kitchen_id: kitchenId, override_date: date, meal_slot: slot, delivery_time: d, addon_cutoff_time: c, note: note.trim() || null,
    }));
    setDelivery(''); setCutoff(''); setNote('');
    await refreshAll();
  });
  const remove = useAction(async (d: string, s: string) => {
    await run(getSupabase().from('slot_overrides').delete().eq('kitchen_id', kitchenId).eq('override_date', d).eq('meal_slot', s));
    await refreshAll();
  });

  return (
    <Card>
      <H2>{tr('Change timing for one day')}</H2>
      {existing.map((o) => (
        <ListRow key={`${o.override_date}-${o.meal_slot}`} title={`${formatDate(o.override_date)} · ${o.meal_slot}`}
          subtitle={[o.delivery_time ? tr('Delivery {time}', { time: formatTime(o.delivery_time) }) : '', o.addon_cutoff_time ? tr('Cutoff {time}', { time: formatTime(o.addon_cutoff_time) }) : '', o.note ?? '']
            .filter(Boolean).join(' · ')}
          right={<Button small variant="ghost" title={tr('Remove')} onPress={() => void remove.run(o.override_date, o.meal_slot)} />} />
      ))}
      <DateField label={tr('Date')} value={date} onChange={setDate} />
      <Chips value={slot} onChange={setSlot} options={[{ value: 'lunch', label: 'Lunch' }, { value: 'dinner', label: 'Dinner' }]} />
      <Field label={tr('Delivery time that day (optional)')} value={delivery} onChangeText={setDelivery} placeholder={tr('2:15 PM')} />
      <Field label={tr('Extras/skip cutoff that day (optional)')} value={cutoff} onChangeText={setCutoff} placeholder={tr('10:00 AM')} />
      <Field label={tr('Note')} value={note} onChangeText={setNote} maxLength={200} />
      <Body>{tr('Only that one day changes.')}</Body>
      <ErrorText error={add.error ?? remove.error} />
      <Button small title={tr('Add change')} loading={add.busy} onPress={() => void add.run()} />
    </Card>
  );
}
