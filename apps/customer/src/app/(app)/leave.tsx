import { useState } from 'react';
import { router, Stack } from 'expo-router';
import { AppError, Body, Button, Card, Chips, DateField, ErrorText, Muted, rpc, Screen, useAction, useT } from '@amruta/app-core';
import { addDays, isIsoDate, istToday } from '@amruta/shared';
import { useMe } from '../../lib/auth';
import { useRefreshAll } from '../../lib/queries';

/** Pause meals for a date range (leave / vacation). */
export default function Leave() {
  const tr = useT();
  const { kitchenId } = useMe();
  const refreshAll = useRefreshAll();
  const [from, setFrom] = useState(addDays(istToday(), 1));
  const [to, setTo] = useState(addDays(istToday(), 1));
  const [slot, setSlot] = useState<'both' | 'lunch' | 'dinner'>('both');
  const [result, setResult] = useState<number | null>(null);

  const save = useAction(async () => {
    if (!isIsoDate(from) || !isIsoDate(to) || to < from || from < istToday()) throw new AppError('INVALID_DATES');
    const r = await rpc<{ orders_skipped: number }>('customer_skip_range', {
      p_kitchen: kitchenId, p_from: from, p_to: to, p_meal_slot: slot === 'both' ? null : slot,
    });
    setResult(r.orders_skipped);
    await refreshAll();
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Going on leave') }} />
      <Card>
        <DateField label={tr('From')} value={from} onChange={setFrom} />
        <DateField label={tr('To (last day of leave)')} value={to} onChange={setTo} />
        <Chips value={slot} onChange={setSlot} options={[
          { value: 'both', label: tr('Lunch & dinner') }, { value: 'lunch', label: tr('Lunch only') }, { value: 'dinner', label: tr('Dinner only') },
        ]} />
        <Muted>{tr('Free for meals still before their cutoff. Today\'s meals past the cutoff must be skipped one by one.')}</Muted>
        <ErrorText error={save.error} />
        {result === null ? (
          <Button title={tr('Pause these meals')} loading={save.busy} onPress={() => void save.run()} />
        ) : (
          <>
            <Body bold>{result === 1 ? tr('Done: 1 meal paused.') : tr('Done: {count} meals paused.', { count: result })}</Body>
            <Muted>{tr('Meals for later dates are paused automatically when they are planned.')}</Muted>
            <Button title={tr('OK')} onPress={() => router.back()} />
          </>
        )}
      </Card>
    </Screen>
  );
}
