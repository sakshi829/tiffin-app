import { useEffect, useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { formatDate, formatRupees, isIsoDate, istToday, parseRupeesToPaise } from '@amruta/shared';
import { getSupabase } from '../../../lib/supabase';
import { AppError, rpc, run } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useStepUp } from '../../../lib/stepup';
import { useItems, useRefreshAll } from '../../../lib/queries';
import {
  Button, Card, Chips, DateField, ErrorText, Field, H2, ListRow, Loading, Muted, Screen, SwitchRow, useAction,
} from '../../../ui/kit';
import { useT } from '@amruta/app-core';

export default function ItemEdit() {
  const tr = useT();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { kitchenId } = useOwner();
  const items = useItems();
  const refreshAll = useRefreshAll();
  const withStepUp = useStepUp();
  const item = items.data?.find((i) => i.id === id);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<'main' | 'addon'>('addon');
  const [isVeg, setIsVeg] = useState(true);
  const [unit, setUnit] = useState('piece');
  const [orderable, setOrderable] = useState(false);
  const [maxQty, setMaxQty] = useState('5');
  const [active, setActive] = useState(true);
  const [price, setPrice] = useState('');
  const [from, setFrom] = useState(istToday());

  useEffect(() => {
    if (!item) return;
    setName(item.name); setCategory(item.category); setIsVeg(item.is_veg); setUnit(item.unit);
    setOrderable(item.customer_orderable); setMaxQty(String(item.max_qty_per_order)); setActive(item.active);
  }, [item]);

  const save = useAction(async () => {
    const max = Number(maxQty);
    if (!name.trim()) throw new AppError('NAME_REQUIRED');
    if (!unit.trim()) throw new AppError('UNIT_REQUIRED');
    if (!Number.isInteger(max) || max < 1 || max > 20) throw new AppError('CHECK_NUMBERS');
    const fields = { name: name.trim(), category, is_veg: isVeg, unit: unit.trim(), customer_orderable: orderable, max_qty_per_order: max, active };
    const db = getSupabase();
    let itemId = id;
    if (id) await run(db.from('items').update(fields).eq('id', id).select('id').single());
    else itemId = (await run<{ id: string }>(db.from('items').insert({ ...fields, kitchen_id: kitchenId }).select('id').single())).id;

    const paise = price.trim() ? parseRupeesToPaise(price) : null;
    if (price.trim() && paise === null) throw new AppError('INVALID_AMOUNT');
    if (paise !== null) {
      if (!isIsoDate(from) || from < istToday()) throw new AppError('PAST_DATE');
      await withStepUp(() => rpc('owner_set_item_price', { p_item: itemId, p_price_paise: paise, p_effective_from: from }));
    }
    await refreshAll();
    router.back();
  });

  if (id && items.isLoading) return <Loading />;
  const history = [...(item?.prices ?? [])].sort((a, b) => b.effective_from.localeCompare(a.effective_from));

  return (
    <Screen>
      <Stack.Screen options={{ title: id ? tr('Edit item') : tr('New item') }} />
      <Card>
        <Field label={tr('Name *')} value={name} onChangeText={setName} maxLength={80} placeholder={tr('e.g. Egg, Salad, Bhakri, Roti')} />
        <Chips label={tr('Type')} value={category} onChange={setCategory} options={[
          { value: 'main', label: 'Main (inside tiffin)' }, { value: 'addon', label: 'Extra' },
        ]} />
        <Chips label={tr('Food')} value={isVeg ? 'veg' : 'nonveg'} onChange={(v) => setIsVeg(v === 'veg')} options={[
          { value: 'veg', label: 'Veg' }, { value: 'nonveg', label: 'Non-veg' },
        ]} />
        <Field label={tr('Unit')} value={unit} onChangeText={setUnit} maxLength={20} placeholder={tr('piece, bowl, plate')} />
        <SwitchRow label={tr('Customers can request it')} value={orderable} onValueChange={setOrderable}
          hint={tr('Shown in the customer app as an extra they can add before the cutoff.')} />
        <Field label={tr('Max per meal')} value={maxQty} onChangeText={setMaxQty} numeric="integer" min={1} max={20} maxLength={2} />
        <SwitchRow label={tr('Available')} value={active} onValueChange={setActive} />
      </Card>
      <Card>
        <H2>{tr('Price')}</H2>
        <Field label={id ? tr('New price ₹ (leave empty to keep)') : tr('Price ₹')} value={price} onChangeText={setPrice} numeric="money" />
        {price.trim() ? <DateField label={tr('Price applies from')} value={from} onChange={setFrom} /> : null}
        <Muted>{tr('Old bills never change. Meals before their cutoff get the new price from this date. Needs your authenticator code.')}</Muted>
        {history.map((p) => (
          <ListRow key={p.effective_from} title={formatRupees(p.price_paise)} subtitle={tr('From {formatDate}', { formatDate: formatDate(p.effective_from) })} />
        ))}
      </Card>
      <ErrorText error={save.error} />
      <Button title={tr('Save')} onPress={() => void save.run()} loading={save.busy} disabled={!name.trim() || (!id && !price.trim())} />
    </Screen>
  );
}
