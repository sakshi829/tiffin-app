import { useEffect, useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { formatDate, formatRupees, isIsoDate, istToday, parseRupeesToPaise } from '@amruta/shared';
import { getSupabase } from '../../../lib/supabase';
import { AppError, rpc, run } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useStepUp } from '../../../lib/stepup';
import { priceOn, useItems, usePackingInstruction, useRefreshAll, useTiffinTypes } from '../../../lib/queries';
import {
  Body, Button, Card, Chips, DateField, ErrorText, Field, H2, ListRow, Loading, Muted, RowWrap, Screen, Stepper, SwitchRow, useAction,
} from '../../../ui/kit';
import { pickAndUploadPhoto, PrivateImage, useT } from '@amruta/app-core';

export default function TiffinEdit() {
  const tr = useT();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { kitchenId } = useOwner();
  const types = useTiffinTypes();
  const items = useItems();
  const refreshAll = useRefreshAll();
  const withStepUp = useStepUp();
  const type = types.data?.find((t) => t.id === id);
  const today = istToday();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isVeg, setIsVeg] = useState(true);
  const [mode, setMode] = useState<'fixed' | 'sum_of_items'>('fixed');
  const [active, setActive] = useState(true);
  const [special, setSpecial] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [price, setPrice] = useState('');
  const [from, setFrom] = useState(today);
  const packing = usePackingInstruction(id);
  const [packText, setPackText] = useState('');
  useEffect(() => { setPackText(packing.data?.instructions ?? ''); }, [packing.data]);
  const packPhoto = useAction(async (source: 'camera' | 'library') => {
    const path = await pickAndUploadPhoto(source, 'kitchen-media', `${kitchenId}/pack-${id!.slice(0, 8)}-${Date.now()}.jpg`);
    if (!path) return;
    await run(getSupabase().from('packing_instructions').update({ photo_path: path }).eq('tiffin_type_id', id!).select('tiffin_type_id').single());
    await refreshAll();
  });

  useEffect(() => {
    if (!type) return;
    setName(type.name); setDescription(type.description ?? ''); setIsVeg(type.is_veg); setMode(type.pricing_mode); setActive(type.active);
    setSpecial(type.is_special);
    setQty(Object.fromEntries(type.items.map((i) => [i.item_id, i.qty])));
  }, [type]);

  const sumPrice = Object.entries(qty).reduce((total, [itemId, q]) => {
    const p = priceOn(items.data?.find((i) => i.id === itemId)?.prices ?? [], today);
    return total + (p ? p.price_paise * q : 0);
  }, 0);

  const save = useAction(async () => {
    if (!name.trim()) throw new AppError('INVALID_REQUEST');
    const db = getSupabase();
    const fields = { name: name.trim(), description: description.trim() || null, is_veg: isVeg, pricing_mode: mode, active, is_special: special };
    let typeId = id;
    // Changing how a tiffin in use is priced asks for the authenticator code (database rule).
    if (id) await withStepUp(() => run(db.from('tiffin_types').update(fields).eq('id', id).select('id').single()));
    else typeId = (await run<{ id: string }>(db.from('tiffin_types').insert({ ...fields, kitchen_id: kitchenId }).select('id').single())).id;

    // What goes into it: one all-or-nothing call (safe to retry after the authenticator prompt).
    const wanted = Object.entries(qty).filter(([, q]) => q > 0).map(([item_id, q]) => ({ item_id, qty: q }));
    const before = (type?.items ?? []).map((i) => `${i.item_id}:${i.qty}`).sort().join(',');
    const after = wanted.map((i) => `${i.item_id}:${i.qty}`).sort().join(',');
    if (before !== after) {
      await withStepUp(() => rpc('owner_set_tiffin_items', { p_tiffin_type: typeId, p_items: wanted }));
    }

    // Packing instructions for staff (they can't be deleted, only replaced).
    const pack = packText.trim();
    if (pack && pack !== (packing.data?.instructions ?? '')) {
      if (packing.data) await run(db.from('packing_instructions').update({ instructions: pack }).eq('tiffin_type_id', typeId!));
      else await run(db.from('packing_instructions').insert({ tiffin_type_id: typeId, kitchen_id: kitchenId, instructions: pack }));
    }

    if (mode === 'fixed' && price.trim()) {
      const paise = parseRupeesToPaise(price);
      if (paise === null) throw new AppError('INVALID_AMOUNT');
      if (!isIsoDate(from) || from < today) throw new AppError('PAST_DATE');
      await withStepUp(() => rpc('owner_set_tiffin_price', { p_tiffin_type: typeId, p_price_paise: paise, p_effective_from: from }));
    }
    await refreshAll();
    router.back();
  });

  if (types.isLoading || items.isLoading) return <Loading />;
  const history = [...(type?.prices ?? [])].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const availableItems = (items.data ?? []).filter((i) => i.active || (qty[i.id] ?? 0) > 0);

  return (
    <Screen>
      <Stack.Screen options={{ title: id ? tr('Edit tiffin type') : tr('New tiffin type') }} />
      <Card>
        <Field label={tr('Name *')} value={name} onChangeText={setName} maxLength={80} placeholder={tr('e.g. Veg Standard')} />
        <Field label={tr('Description (shown to customers)')} value={description} onChangeText={setDescription} maxLength={500} multiline />
        <Chips label={tr('Food')} value={isVeg ? 'veg' : 'nonveg'} onChange={(v) => setIsVeg(v === 'veg')} options={[
          { value: 'veg', label: 'Veg' }, { value: 'nonveg', label: 'Non-veg' },
        ]} />
        <SwitchRow label={tr('Available')} value={active} onValueChange={setActive} />
        <SwitchRow label={tr('Special (one-day menu)')} value={special} onValueChange={setSpecial}
          hint={tr('Specials are offered on a chosen date (Menu › Specials) and are not used for regular meal plans. Use a fixed price.')} />
      </Card>
      <Card>
        <H2>{tr('What\'s inside')}</H2>
        {availableItems.length === 0 ? <Muted>{tr('Add items in Menu › Items first.')}</Muted> : null}
        {availableItems.map((i) => (
          <Stepper key={i.id} label={i.category === 'addon' ? tr('{name} (extra)', { name: i.name }) : i.name} value={qty[i.id] ?? 0}
            onChange={(v) => setQty({ ...qty, [i.id]: v })} />
        ))}
      </Card>
      <Card>
        <H2>{tr('How to pack it (for staff)')}</H2>
        <Field label={tr('Packing instructions')} value={packText} onChangeText={setPackText} multiline maxLength={2000}
          placeholder={tr('4 roti in the big box, sabzi in bowl 1, dal in bowl 2, egg in the small box')} />
        <Muted>{tr('Shown in the Staff app\'s packing list. To change it, replace the text.')}</Muted>
        {packing.data ? (
          <>
            <PrivateImage bucket="kitchen-media" path={packing.data.photo_path} alt={tr('Photo of a packed tiffin')} />
            <RowWrap>
              <Button small variant="secondary" title={packing.data.photo_path ? tr('New photo') : tr('Add photo of a packed tiffin')} loading={packPhoto.busy}
                onPress={() => void packPhoto.run('camera')} />
              <Button small variant="ghost" title={tr('From gallery')} loading={packPhoto.busy} onPress={() => void packPhoto.run('library')} />
            </RowWrap>
            <ErrorText error={packPhoto.error} />
          </>
        ) : id ? <Muted>{tr('Save the instructions first, then you can add a photo.')}</Muted> : null}
      </Card>
      <Card>
        <H2>{tr('Price')}</H2>
        <Chips value={mode} onChange={setMode} options={[
          { value: 'fixed', label: 'Fixed price' }, { value: 'sum_of_items', label: 'Sum of items' },
        ]} />
        {mode === 'sum_of_items' ? (
          <Body>{tr('Today this comes to {formatRupees} (changes when item prices change).', { formatRupees: formatRupees(sumPrice) })}</Body>
        ) : (
          <>
            <Field label={id ? tr('New price ₹ (leave empty to keep)') : tr('Price ₹')} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
            {price.trim() ? <DateField label={tr('Price applies from')} value={from} onChange={setFrom} /> : null}
            {history.map((p) => <ListRow key={p.effective_from} title={formatRupees(p.price_paise)} subtitle={tr('From {formatDate}', { formatDate: formatDate(p.effective_from) })} />)}
          </>
        )}
        <Muted>{tr('Old bills never change. Price changes need your authenticator code.')}</Muted>
      </Card>
      <ErrorText error={save.error} />
      <Button title={tr('Save')} onPress={() => void save.run()} loading={save.busy}
        disabled={!name.trim() || (!id && mode === 'fixed' && !price.trim())} />
    </Screen>
  );
}
