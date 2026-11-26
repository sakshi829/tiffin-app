import { useEffect, useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { formatRupees, isIsoDate, istToday, LIMITS, type MealSlot } from '@amruta/shared';
import { AppError, rpc } from '../../../lib/api';
import { nodePath, priceOn, useItems, usePlaces, useRefreshAll, useSubscriptions, useTiffinTypes } from '../../../lib/queries';
import {
  Button, Card, Chips, DateField, ErrorText, Field, H2, Loading, Muted, MultiChips, Screen, Stepper, useAction,
} from '../../../ui/kit';
import { useT } from '@amruta/app-core';

const DAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 7, label: 'Sun' },
] as const;

export default function SubscriptionForm() {
  const tr = useT();
  const { customerId, id } = useLocalSearchParams<{ customerId: string; id?: string }>();
  const subs = useSubscriptions(customerId);
  const types = useTiffinTypes();
  const items = useItems();
  const places = usePlaces();
  const refreshAll = useRefreshAll();
  const today = istToday();

  const [slot, setSlot] = useState<MealSlot>('lunch');
  const [typeId, setTypeId] = useState<string | null>(null);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState('');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [locText, setLocText] = useState('');
  const [status, setStatus] = useState<'active' | 'paused' | 'ended'>('active');
  const [notes, setNotes] = useState('');
  const [extras, setExtras] = useState<Record<string, number>>({});

  const existing = subs.data?.find((s) => s.id === id);
  useEffect(() => {
    if (!existing) return;
    setSlot(existing.meal_slot); setTypeId(existing.tiffin_type_id); setStart(existing.start_date); setEnd(existing.end_date ?? '');
    setDays(existing.days_of_week); setNodeId(existing.default_location_node_id); setLocText(existing.default_location_text ?? '');
    setStatus(existing.status); setNotes(existing.notes ?? '');
    setExtras(Object.fromEntries(existing.addons.map((a) => [a.item_id, a.qty])));
  }, [existing]);

  const save = useAction(async () => {
    if (!typeId || !isIsoDate(start) || (end && (!isIsoDate(end) || end < start)) || days.length === 0) throw new AppError('INVALID_REQUEST');
    await rpc('owner_save_subscription', {
      p_id: id ?? null, p_customer: customerId, p_meal_slot: slot, p_tiffin_type: typeId, p_start_date: start,
      p_end_date: end || null, p_days_of_week: [...days].sort(), p_location_node: nodeId, p_location_text: locText.trim() || null,
      p_status: status, p_notes: notes.trim() || null,
      p_addons: Object.entries(extras).filter(([, q]) => q > 0).map(([item_id, qty]) => ({ item_id, qty })),
    });
    await refreshAll();
    router.back();
  });

  if (subs.isLoading || types.isLoading || items.isLoading) return <Loading />;
  const activeTypes = (types.data ?? []).filter((t) => (t.active && !t.is_special) || t.id === typeId);
  const extraItems = (items.data ?? []).filter((i) => i.active && i.category === 'addon');

  return (
    <Screen>
      <Stack.Screen options={{ title: id ? tr('Edit meal plan') : tr('New meal plan') }} />
      <Card>
        <Chips label={tr('Meal')} value={slot} onChange={setSlot} options={[{ value: 'lunch', label: 'Lunch' }, { value: 'dinner', label: 'Dinner' }]} />
        {activeTypes.length === 0 ? <Muted>{tr('Create a tiffin type in Menu first.')}</Muted> : (
          <Chips label={tr('Tiffin')} value={typeId} onChange={setTypeId} options={activeTypes.map((t) => {
            const p = priceOn(t.prices, start);
            return { value: t.id, label: `${t.name}${t.pricing_mode === 'fixed' && p ? ` · ${formatRupees(p.price_paise)}` : ''}` };
          })} />
        )}
      </Card>
      <Card>
        <DateField label={tr('Starts on')} value={start} onChange={setStart} />
        <DateField label={tr('Ends on (empty = until stopped)')} value={end} onChange={setEnd} allowEmpty />
        <MultiChips label={tr('Days')} values={days} onChange={setDays} options={DAYS} />
      </Card>
      <Card>
        <H2>{tr('Daily extras (charged every day)')}</H2>
        {extraItems.length === 0 ? <Muted>{tr('No extras in the menu yet.')}</Muted> : null}
        {extraItems.map((i) => {
          const p = priceOn(i.prices, start);
          return (
            <Stepper key={i.id} label={`${i.name}${p ? ` (${formatRupees(p.price_paise)})` : ''}`} value={extras[i.id] ?? 0}
              max={i.max_qty_per_order} onChange={(v) => setExtras({ ...extras, [i.id]: v })} />
          );
        })}
      </Card>
      <Card>
        <H2>{tr('Delivery place (empty = customer\'s usual place)')}</H2>
        <Chips value={nodeId ?? ''} onChange={(v) => setNodeId(v === '' ? null : v)} options={[
          { value: '', label: 'Usual place' },
          ...(places.data?.nodes ?? []).filter((n) => n.active).map((n) => ({ value: n.id, label: nodePath(n.id, places.data) ?? n.name })),
        ]} />
        <Field label={tr('Or describe it')} value={locText} onChangeText={setLocText} maxLength={LIMITS.locationTextMax} />
      </Card>
      <Card>
        <Chips label={tr('Status')} value={status} onChange={setStatus} options={[
          { value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'ended', label: 'Ended' },
        ]} />
        <Field label={tr('Notes')} value={notes} onChangeText={setNotes} maxLength={300} />
        <Muted>{tr('Saving updates the next days\' meals that are not yet past their cutoff.')}</Muted>
      </Card>
      <ErrorText error={save.error} />
      <Button title={tr('Save')} onPress={() => void save.run()} loading={save.busy} disabled={!typeId || days.length === 0} />
    </Screen>
  );
}
