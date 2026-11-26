import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { istToday, type MealSlot } from '@amruta/shared';
import { getSupabase } from '../../../lib/supabase';
import { run } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useDailyMenu, useRefreshAll } from '../../../lib/queries';
import { Button, Card, Chips, DateField, ErrorText, Field, Muted, Screen, useAction } from '../../../ui/kit';
import { useT } from '@amruta/app-core';

/** "What's cooking": shown to customers in their app. */
export default function DailyMenu() {
  const tr = useT();
  const { kitchenId } = useOwner();
  const [date, setDate] = useState(istToday());
  const [slot, setSlot] = useState<MealSlot>('lunch');
  const menu = useDailyMenu(date);
  const refreshAll = useRefreshAll();
  const current = menu.data?.find((m) => m.meal_slot === slot);
  const [text, setText] = useState('');
  useEffect(() => { setText(current?.description ?? ''); }, [current?.description, date, slot]);

  const save = useAction(async () => {
    const db = getSupabase();
    const description = text.trim();
    if (!description) {
      await run(db.from('daily_menu').delete().eq('kitchen_id', kitchenId).eq('menu_date', date).eq('meal_slot', slot));
    } else if (current) {
      await run(db.from('daily_menu').update({ description }).eq('kitchen_id', kitchenId).eq('menu_date', date).eq('meal_slot', slot));
    } else {
      await run(db.from('daily_menu').insert({ kitchen_id: kitchenId, menu_date: date, meal_slot: slot, description }));
    }
    await refreshAll();
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Today\'s menu') }} />
      <Card>
        <DateField label={tr('Date')} value={date} onChange={setDate} />
        <Chips value={slot} onChange={setSlot} options={[{ value: 'lunch', label: 'Lunch' }, { value: 'dinner', label: 'Dinner' }]} />
        <Field label={tr('What\'s cooking')} value={text} onChangeText={setText} multiline maxLength={500}
          placeholder={tr('e.g. Bhindi masala, dal tadka, jeera rice, 4 chapati')} />
        <Muted>{tr('Customers see this in their app. Leave empty and save to remove.')}</Muted>
        <ErrorText error={save.error} />
        <Button title={tr('Save')} onPress={() => void save.run()} loading={save.busy} />
      </Card>
    </Screen>
  );
}
