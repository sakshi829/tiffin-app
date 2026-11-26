import { useState } from 'react';
import { Stack } from 'expo-router';
import { addDays, formatDate, isIsoDate, istClock, istToday, istToIso, parseTime } from '@amruta/shared';
import { AppError, rpc } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useRefreshAll, useScheduledAnnouncements } from '../../../lib/queries';
import {
  Body, Button, Card, Chips, DateField, ErrorText, Field, H2, ListRow, Muted, Screen, SwitchRow, useAction,
} from '../../../ui/kit';
import { useT } from '@amruta/app-core';

/** Message to all customers (and optionally staff): inbox + phone alert, now or at a chosen time. */
export default function Announce() {
  const tr = useT();
  const { kitchenId } = useOwner();
  const scheduled = useScheduledAnnouncements();
  const refreshAll = useRefreshAll();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [staff, setStaff] = useState(false);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [date, setDate] = useState(addDays(istToday(), 1));
  const [time, setTime] = useState('9:00 AM');
  const [result, setResult] = useState<string | null>(null);

  const send = useAction(async () => {
    if (when === 'now') {
      const n = await rpc<number>('owner_send_announcement', { p_kitchen: kitchenId, p_title: title.trim(), p_body: body.trim(), p_include_staff: staff });
      setResult(n === 1 ? tr('Sent to 1 person.') : tr('Sent to {count} people.', { count: n }));
    } else {
      const t = parseTime(time);
      if (!t || !isIsoDate(date)) throw new AppError('INVALID_DATES');
      await rpc('owner_schedule_announcement', {
        p_kitchen: kitchenId, p_title: title.trim(), p_body: body.trim(), p_include_staff: staff, p_send_at: istToIso(date, t),
      });
      setResult(tr('Will be sent {date} at {time}.', { date: formatDate(date), time }));
    }
    setTitle(''); setBody('');
    await refreshAll();
  });
  const cancel = useAction(async (id: string) => { await rpc('owner_cancel_announcement', { p_id: id }); await refreshAll(); });

  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Send announcement') }} />
      <Card>
        <Field label={tr('Title')} value={title} onChangeText={setTitle} maxLength={80} placeholder={tr('Diwali special')} />
        <Field label={tr('Message')} value={body} onChangeText={setBody} maxLength={300} multiline placeholder={tr('Sweets with lunch on Friday!')} />
        <SwitchRow label={tr('Also send to staff')} value={staff} onValueChange={setStaff} />
        <Chips value={when} onChange={setWhen} options={[{ value: 'now', label: 'Send now' }, { value: 'later', label: 'Send later' }]} />
        {when === 'later' ? (
          <>
            <DateField label={tr('Date')} value={date} onChange={setDate} />
            <Field label={tr('Time')} value={time} onChangeText={setTime} placeholder={tr('9:00 AM')} error={time && !parseTime(time) ? tr('e.g. 9:00 AM') : null} />
          </>
        ) : null}
        <Muted>{tr('Goes to every customer who joined the app (active or paused). Days off are announced automatically.')}</Muted>
        <ErrorText error={send.error} />
        <Button title={when === 'now' ? tr('Send') : tr('Schedule')} loading={send.busy} disabled={!title.trim() || !body.trim()} onPress={() => void send.run()} />
        {result ? <Body bold>{result}</Body> : null}
      </Card>
      {(scheduled.data ?? []).length > 0 ? (
        <Card>
          <H2>{tr('Scheduled')}</H2>
          {(scheduled.data ?? []).map((a) => (
            <ListRow key={a.id} title={a.title}
              subtitle={`${formatDate(new Date(Date.parse(a.send_at) + 330 * 60_000).toISOString().slice(0, 10))} ${istClock(a.send_at)} · ${a.body}`}
              right={<Button small variant="ghost" title={tr('Cancel')} onPress={() => void cancel.run(a.id)} />} />
          ))}
          <ErrorText error={cancel.error} />
        </Card>
      ) : null}
    </Screen>
  );
}
