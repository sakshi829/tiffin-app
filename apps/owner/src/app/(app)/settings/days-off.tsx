import { useState } from 'react';
import { Stack } from 'expo-router';
import { formatDate, isIsoDate, istToday } from '@amruta/shared';
import { AppError, rpc } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useClosures, useRefreshAll } from '../../../lib/queries';
import { Button, Card, Chips, DateField, Empty, ErrorText, Field, H2, ListRow, Muted, Screen, useAction } from '../../../ui/kit';
import { useT } from '@amruta/app-core';

export default function DaysOff() {
  const tr = useT();
  const { kitchenId } = useOwner();
  const closures = useClosures();
  const refreshAll = useRefreshAll();
  const [date, setDate] = useState(istToday());
  const [slot, setSlot] = useState<'all' | 'lunch' | 'dinner'>('all');
  const [reason, setReason] = useState('');

  const add = useAction(async () => {
    if (!isIsoDate(date) || date < istToday()) throw new AppError('PAST_DATE');
    await rpc('owner_add_closure', { p_kitchen: kitchenId, p_date: date, p_meal_slot: slot === 'all' ? null : slot, p_reason: reason.trim() || null });
    setReason('');
    await refreshAll();
  });
  const cancel = useAction(async (id: string) => { await rpc('owner_cancel_closure', { p_closure: id }); await refreshAll(); });

  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Days off') }} />
      <Card>
        <H2>{tr('Close the kitchen')}</H2>
        <DateField label={tr('Date')} value={date} onChange={setDate} />
        <Chips value={slot} onChange={setSlot} options={[
          { value: 'all', label: 'Whole day' }, { value: 'lunch', label: 'Lunch only' }, { value: 'dinner', label: 'Dinner only' },
        ]} />
        <Field label={tr('Reason (customers will see it)')} value={reason} onChangeText={setReason} maxLength={200} />
        <Muted>{tr('Those meals are cancelled for everyone and nobody is charged. Customers get an alert.')}</Muted>
        <ErrorText error={add.error} />
        <Button title={tr('Add day off')} loading={add.busy} onPress={() => void add.run()} />
      </Card>
      <Card>
        <H2>{tr('Upcoming days off')}</H2>
        {(closures.data ?? []).length === 0 ? <Empty text={tr('None planned.')} /> : null}
        {(closures.data ?? []).map((c) => (
          <ListRow key={c.id} title={`${formatDate(c.closure_date)} · ${c.meal_slot ? tr(c.meal_slot === 'lunch' ? 'lunch' : 'dinner') : tr('whole day')}`} subtitle={c.reason}
            right={<Button small variant="ghost" title={tr('Undo')} onPress={() => void cancel.run(c.id)} />} />
        ))}
        <ErrorText error={cancel.error} />
      </Card>
    </Screen>
  );
}
