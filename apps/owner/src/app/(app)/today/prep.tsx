import { useState } from 'react';
import { Share } from 'react-native';
import { router, Stack } from 'expo-router';
import { addDays, formatDate, istToday, quantityWithUnit, type MealSlot } from '@amruta/shared';
import { getSupabase } from '../../../lib/supabase';
import { AppError, run } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useRefreshAll } from '../../../lib/queries';
import { usePrepTotals, useWaste } from '../../../lib/finance';
import { Body, Button, Card, Chips, Empty, ErrorText, Field, H2, ListRow, Loading, Muted, Screen, useAction } from '../../../ui/kit';
import { useT } from '@amruta/app-core';


/** What to cook and what to buy for a day (lunch + dinner, including extras), and leftovers. */
export default function Prep() {
  const tr = useT();
  const today = istToday();
  const [date, setDate] = useState(today);
  const prep = usePrepTotals(date);
  const items = (prep.data ?? []).filter((r) => r.kind === 'item');
  const ingredients = (prep.data ?? []).filter((r) => r.kind === 'ingredient');

  const share = useAction(async () => {
    const lines = [tr('Shopping list for {date}', { date: formatDate(date) }), ...ingredients.map((r) => `- ${r.name}: ${quantityWithUnit(r.qty, r.unit)}`)];
    await Share.share({ message: lines.join('\n') });
  });

  return (
    <Screen refreshing={prep.isFetching} onRefresh={() => void prep.refetch()}>
      <Stack.Screen options={{ title: tr('Prep & shopping list') }} />
      <Chips value={date} onChange={setDate} options={[
        { value: today, label: 'Today' }, { value: addDays(today, 1), label: 'Tomorrow' }, { value: addDays(today, 2), label: 'Day after' },
      ]} />
      <Muted>{tr('{formatDate} · lunch and dinner, from meals not skipped. Changes until each cutoff.', { formatDate: formatDate(date) })}</Muted>
      {prep.isLoading ? <Loading /> : null}
      <ErrorText error={prep.error} />
      <Card>
        <H2>{tr('To cook')}</H2>
        {items.length === 0 && !prep.isLoading ? <Empty text={tr('No items: tiffin types have no items set, or no meals.')} /> : null}
        {items.map((r) => <ListRow key={r.name} title={r.name} right={<Body bold>{quantityWithUnit(r.qty, r.unit)}</Body>} />)}
      </Card>
      <Card>
        <H2>{tr('Shopping list')}</H2>
        {ingredients.length === 0 ? (
          <Muted>{tr('Set how much atta, rice, oil... goes into each item to get a shopping list.')}</Muted>
        ) : ingredients.map((r) => <ListRow key={r.name} title={r.name} right={<Body bold>{quantityWithUnit(r.qty, r.unit)}</Body>} />)}
        {ingredients.length > 0 ? <Button small variant="secondary" title={tr('Share list (WhatsApp...)')} loading={share.busy} onPress={() => void share.run()} /> : null}
        <Button small variant="ghost" title={tr('Set ingredients')} onPress={() => router.push('/menu/ingredients')} />
        <ErrorText error={share.error} />
      </Card>
      <Leftovers date={date} />
    </Screen>
  );
}

function Leftovers({ date }: { date: string }) {
  const tr = useT();
  const { kitchenId } = useOwner();
  const waste = useWaste(date, date);
  const refreshAll = useRefreshAll();
  const [slot, setSlot] = useState<MealSlot>('lunch');
  const [count, setCount] = useState('');
  const [note, setNote] = useState('');
  const add = useAction(async () => {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 1000) throw new AppError('INVALID_QUANTITY');
    if (date > istToday()) throw new AppError('INVALID_DATES');
    await run(getSupabase().from('waste_entries').insert({ kitchen_id: kitchenId, entry_date: date, meal_slot: slot, tiffins: n, note: note.trim() || null })
      .select('id').single());
    setCount(''); setNote('');
    await refreshAll();
  });
  const remove = useAction(async (id: string) => {
    await run(getSupabase().from('waste_entries').delete().eq('id', id).select('id').single());
    await refreshAll();
  });
  return (
    <Card>
      <H2>{tr('Left over (extra food)')}</H2>
      <Muted>{tr('Note how many tiffins were extra. Suggestions tell you when cooking a little less would save money.')}</Muted>
      {(waste.data ?? []).map((w) => (
        <ListRow key={w.id} title={w.meal_slot === 'lunch'
          ? (w.tiffins === 1 ? tr('Lunch: 1 tiffin') : tr('Lunch: {count} tiffins', { count: w.tiffins }))
          : (w.tiffins === 1 ? tr('Dinner: 1 tiffin') : tr('Dinner: {count} tiffins', { count: w.tiffins }))}
          subtitle={w.note} right={<Button small variant="ghost" title={tr('Remove')} loading={remove.busy} onPress={() => void remove.run(w.id)} />} />
      ))}
      {date <= istToday() ? (
        <>
          <Chips value={slot} onChange={setSlot} options={[{ value: 'lunch', label: 'Lunch' }, { value: 'dinner', label: 'Dinner' }]} />
          <Field label={tr('Extra tiffins')} value={count} onChangeText={setCount} numeric="integer" min={1} max={1000} maxLength={4} />
          <Field label={tr('Why (optional)')} value={note} onChangeText={setNote} maxLength={200} placeholder={tr('Rain, office holiday...')} />
          <Button small title={tr('Save')} loading={add.busy} onPress={() => void add.run()} />
        </>
      ) : <Muted>{tr('You can note leftovers on the day.')}</Muted>}
      <ErrorText error={add.error ?? remove.error} />
    </Card>
  );
}
