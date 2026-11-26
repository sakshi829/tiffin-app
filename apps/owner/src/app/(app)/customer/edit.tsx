import { useEffect, useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { istToday, isIsoDate, LIMITS } from '@amruta/shared';
import { getSupabase } from '../../../lib/supabase';
import { AppError, run } from '../../../lib/api';
import { useStepUp } from '../../../lib/stepup';
import { useOwner } from '../../../lib/auth';
import { nodePath, useCustomer, usePlaces, useRefreshAll } from '../../../lib/queries';
import { Button, Card, Chips, DateField, ErrorText, Field, H2, Loading, Muted, Screen, useAction } from '../../../ui/kit';
import { useT } from '@amruta/app-core';

const PHONE = /^[0-9+ -]{7,20}$/;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,255}$/;

export default function CustomerEdit() {
  const tr = useT();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { kitchenId } = useOwner();
  const existing = useCustomer(id);
  const places = usePlaces();
  const refreshAll = useRefreshAll();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [locText, setLocText] = useState('');
  const [billing, setBilling] = useState<'postpaid' | 'advance'>('postpaid');
  const [joined, setJoined] = useState(istToday());
  const [freeSkips, setFreeSkips] = useState('');

  useEffect(() => {
    const c = existing.data;
    if (!c) return;
    setName(c.full_name); setPhone(c.phone ?? ''); setEmail(c.email ?? ''); setNotes(c.food_notes ?? '');
    setNodeId(c.default_location_node_id); setLocText(c.default_location_text ?? ''); setBilling(c.billing_mode);
    setJoined(c.joined_on); setFreeSkips(c.late_skip_free_override === null ? '' : String(c.late_skip_free_override));
  }, [existing.data]);

  const withStepUp = useStepUp();
  const save = useAction(async () => {
    if (!name.trim() || (phone && !PHONE.test(phone.trim())) || (email && !EMAIL.test(email.trim())) || !isIsoDate(joined)) {
      throw new AppError('INVALID_REQUEST');
    }
    const skips = freeSkips.trim() === '' ? null : Number(freeSkips);
    if (skips !== null && (!Number.isInteger(skips) || skips < 0 || skips > 31)) throw new AppError('INVALID_REQUEST');
    const fields = {
      full_name: name.trim(), phone: phone.trim() || null, email: email.trim().toLowerCase() || null,
      food_notes: notes.trim() || null, default_location_node_id: nodeId, default_location_text: locText.trim() || null,
      billing_mode: billing, joined_on: joined, late_skip_free_override: skips,
    };
    const db = getSupabase();
    // Changing free late skips asks for the authenticator code (database rule); other fields don't.
    const saved = await withStepUp(() => id
      ? run<{ id: string }>(db.from('customers').update(fields).eq('id', id).select('id').single())
      : run<{ id: string }>(db.from('customers').insert({ ...fields, kitchen_id: kitchenId }).select('id').single()));
    await refreshAll();
    router.replace({ pathname: '/customer/[id]', params: { id: saved.id } });
  });

  if (id && existing.isLoading) return <Loading />;
  const activeNodes = (places.data?.nodes ?? []).filter((n) => n.active);

  return (
    <Screen>
      <Stack.Screen options={{ title: id ? tr('Edit customer') : tr('New customer') }} />
      <Card>
        <Field label={tr('Full name *')} value={name} onChangeText={setName} maxLength={100} />
        <Field label={tr('Phone')} value={phone} onChangeText={setPhone} numeric="phone" maxLength={20}
          error={phone && !PHONE.test(phone.trim()) ? tr('Check the number') : null} />
        <Field label={tr('Email (optional)')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"
          error={email && !EMAIL.test(email.trim()) ? tr('Check the email') : null} />
        <Field label={tr('Food notes (allergies, less spicy...)')} value={notes} onChangeText={setNotes} multiline maxLength={LIMITS.noteTextMax} />
      </Card>
      <Card>
        <H2>{tr('Usual place')}</H2>
        {activeNodes.length === 0 ? <Muted>{tr('Add places in More › Locations to pick from a list.')}</Muted> : (
          <Chips value={nodeId ?? ''} onChange={(v) => setNodeId(v === '' ? null : v)} options={[
            { value: '', label: 'None' },
            ...activeNodes.map((n) => ({ value: n.id, label: nodePath(n.id, places.data) ?? n.name })),
          ]} />
        )}
        <Field label={tr('Or describe it')} value={locText} onChangeText={setLocText} maxLength={LIMITS.locationTextMax} />
      </Card>
      <Card>
        <H2>{tr('Billing')}</H2>
        <Chips value={billing} onChange={setBilling} options={[
          { value: 'postpaid', label: 'Pays monthly' }, { value: 'advance', label: 'Pays in advance' },
        ]} />
        <DateField label={tr('Joined on')} value={joined} onChange={setJoined} />
        <Field label={tr('Free late skips per month (empty = kitchen default)')} value={freeSkips} onChangeText={setFreeSkips}
          numeric="integer" min={0} max={31} maxLength={2} />
      </Card>
      <ErrorText error={save.error} />
      <Button title={tr('Save')} onPress={() => void save.run()} loading={save.busy} disabled={!name.trim()} />
    </Screen>
  );
}
