import { useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import type { IngredientUnit } from '@amruta/shared';
import { getSupabase } from '../../../lib/supabase';
import { AppError, run } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useItems, useRefreshAll } from '../../../lib/queries';
import { useIngredients } from '../../../lib/finance';
import { Badge, Body, Button, Card, Chips, Empty, ErrorText, Field, H2, ListRow, Loading, Muted, RowWrap, Screen, useAction } from '../../../ui/kit';
import { useT } from '@amruta/app-core';

const UNITS: { value: IngredientUnit; label: string }[] = [
  { value: 'kg', label: 'kg' }, { value: 'g', label: 'g' }, { value: 'l', label: 'litre' }, { value: 'ml', label: 'ml' }, { value: 'pcs', label: 'pieces' },
];

/**
 * Raw materials and how much of each goes into ONE item (e.g. 1 roti = 0.03 kg atta).
 * Today › Prep list then multiplies by the day's orders to give a shopping list.
 */
export default function Ingredients() {
  const tr = useT();
  const { kitchenId } = useOwner();
  const data = useIngredients();
  const items = useItems();
  const refreshAll = useRefreshAll();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<IngredientUnit>('kg');
  const [itemId, setItemId] = useState<string | null>(null);

  const add = useAction(async () => {
    if (!name.trim()) throw new AppError('INVALID_REQUEST');
    await run(getSupabase().from('ingredients').insert({ kitchen_id: kitchenId, name: name.trim(), unit }).select('id').single());
    setName('');
    await refreshAll();
  });

  if (data.isLoading || items.isLoading) return <Loading />;
  const ingredients = data.data?.ingredients ?? [];
  const links = data.data?.links ?? [];
  const ingName = new Map(ingredients.map((i) => [i.id, `${i.name} (${i.unit})`]));
  return (
    <Screen refreshing={data.isFetching} onRefresh={() => void data.refetch()}>
      <Stack.Screen options={{ title: tr('Ingredients') }} />
      <ErrorText error={data.error} />
      <Card>
        <H2>{tr('What goes into each item')}</H2>
        <Muted>{tr('Tap an item and enter the amount for ONE piece / portion.')}</Muted>
        {(items.data ?? []).filter((i) => i.active).map((i) => {
          const mine = links.filter((l) => l.item_id === i.id);
          return (
            <View key={i.id}>
              <ListRow title={i.name}
                subtitle={mine.length ? mine.map((l) => `${l.qty} ${ingName.get(l.ingredient_id) ?? ''}`).join(' · ') : tr('Not set')}
                onPress={() => setItemId(itemId === i.id ? null : i.id)} />
              {itemId === i.id ? <ItemRecipe itemId={i.id} /> : null}
            </View>
          );
        })}
      </Card>
      <Card>
        <H2>{tr('Ingredients')}</H2>
        {ingredients.length === 0 ? <Empty text={tr('Add atta, rice, dal, oil, eggs...')} /> : null}
        {ingredients.map((g) => <IngredientRow key={g.id} id={g.id} name={g.name} unit={g.unit} active={g.active} />)}
        <Field label={tr('New ingredient')} value={name} onChangeText={setName} maxLength={60} placeholder={tr('Atta')} />
        <Chips value={unit} onChange={setUnit} options={UNITS} />
        <ErrorText error={add.error} />
        <Button small title={tr('Add ingredient')} loading={add.busy} onPress={() => void add.run()} />
      </Card>
    </Screen>
  );
}

function IngredientRow({ id, name, unit, active }: { id: string; name: string; unit: string; active: boolean }) {
  const tr = useT();
  const refreshAll = useRefreshAll();
  const toggle = useAction(async () => {
    await run(getSupabase().from('ingredients').update({ active: !active }).eq('id', id).select('id').single());
    await refreshAll();
  });
  return (
    <ListRow title={`${name} (${unit})`} right={active
      ? <Button small variant="ghost" title={tr('Hide')} loading={toggle.busy} onPress={() => void toggle.run()} />
      : <Badge text={tr('Hidden')} />} onPress={active ? undefined : () => void toggle.run()} />
  );
}

/** Set the per-item amounts; 0 or empty removes the ingredient from the item. */
function ItemRecipe({ itemId }: { itemId: string }) {
  const tr = useT();
  const { kitchenId } = useOwner();
  const data = useIngredients();
  const refreshAll = useRefreshAll();
  const ingredients = (data.data?.ingredients ?? []).filter((g) => g.active);
  const current = new Map((data.data?.links ?? []).filter((l) => l.item_id === itemId).map((l) => [l.ingredient_id, l.qty]));
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries([...current].map(([k, v]) => [k, String(v)])));

  const save = useAction(async () => {
    const db = getSupabase();
    for (const g of ingredients) {
      const raw = (qty[g.id] ?? '').trim();
      const n = raw === '' ? 0 : Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 10000 || !/^\d{0,5}(\.\d{1,3})?$/.test(raw || '0')) throw new AppError('INVALID_QUANTITY');
      const before = current.get(g.id);
      if (n === 0 && before !== undefined) {
        await run(db.from('item_ingredients').delete().eq('item_id', itemId).eq('ingredient_id', g.id).select('item_id').single());
      } else if (n > 0 && before === undefined) {
        await run(db.from('item_ingredients').insert({ kitchen_id: kitchenId, item_id: itemId, ingredient_id: g.id, qty: n }).select('item_id').single());
      } else if (n > 0 && before !== n) {
        await run(db.from('item_ingredients').update({ qty: n }).eq('item_id', itemId).eq('ingredient_id', g.id).select('item_id').single());
      }
    }
    await refreshAll();
  });

  if (ingredients.length === 0) return <Muted>{tr('Add ingredients below first.')}</Muted>;
  return (
    <View style={{ gap: 8, paddingVertical: 8 }}>
      {ingredients.map((g) => (
        <RowWrap key={g.id}>
          <View style={{ flex: 1 }}><Body>{g.name}</Body></View>
          <View style={{ width: 120 }}>
            <Field label={g.unit} value={qty[g.id] ?? ''} onChangeText={(v) => setQty({ ...qty, [g.id]: v })} numeric="quantity" maxLength={10} />
          </View>
        </RowWrap>
      ))}
      <ErrorText error={save.error} />
      <Button small title={tr('Save amounts')} loading={save.busy} onPress={() => void save.run()} />
    </View>
  );
}
