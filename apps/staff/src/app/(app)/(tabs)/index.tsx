import { useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import * as Speech from 'expo-speech';
import {
  Badge, Body, Button, Card, Chips, Empty, ErrorText, Field, H2, ListRow, Loading, Muted, pickAndUploadPhoto, PrivateImage, rpc, RowWrap,
  Screen, useAction, VegDot, useT,
} from '@amruta/app-core';
import { ScanBox } from '../../../components/ScanBox';
import { addDays, formatDate, istToday, telLink, type MealSlot, type QueuedAction, type StaffTask } from '@amruta/shared';
import { isDeliveryRole, isKitchenRole, useStaffMe } from '../../../lib/auth';
import { useOfflineQueue } from '../../../lib/offline';
import { usePackingInstructions, useTasks } from '../../../lib/queries';

function defaultSlot(): MealSlot {
  return new Date(Date.now() + 330 * 60_000).getUTCHours() < 16 ? 'lunch' : 'dinner';
}

const STATUS: Record<string, string> = {
  scheduled: 'To deliver', delivered: 'Delivered', not_delivered: 'Not found',
};

export default function Work() {
  const tr = useT();
  const { staff } = useStaffMe();
  const kitchen = isKitchenRole(staff);
  const delivery = isDeliveryRole(staff);
  const today = istToday();
  const [mode, setMode] = useState<'pack' | 'deliver'>(kitchen ? 'pack' : 'deliver');
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<MealSlot>(defaultSlot);
  const tasks = useTasks(mode === 'deliver' ? today : date, slot);
  const list = (tasks.data ?? []).filter((t) => t.task === mode);

  return (
    <Screen refreshing={tasks.isFetching} onRefresh={() => void tasks.refetch()}>
      <QueueBanner />
      {kitchen && delivery ? (
        <Chips value={mode} onChange={setMode} options={[{ value: 'pack', label: tr('Packing') }, { value: 'deliver', label: tr('Delivery') }]} />
      ) : null}
      {mode === 'pack' ? (
        <Chips value={date} onChange={setDate} options={[{ value: today, label: tr('Today') }, { value: addDays(today, 1), label: tr('Tomorrow') }]} />
      ) : <Muted>{tr('Deliveries for today, {formatDate}', { formatDate: formatDate(today) })}</Muted>}
      <Chips value={slot} onChange={setSlot} options={[{ value: 'lunch', label: tr('Lunch') }, { value: 'dinner', label: tr('Dinner') }]} />
      {tasks.isLoading ? <Loading /> : null}
      <ErrorText error={tasks.error} />
      {mode === 'pack' ? <PackingView tasks={list} /> : <RouteView tasks={list} />}
    </Screen>
  );
}

function QueueBanner() {
  const tr = useT();
  const q = useOfflineQueue();
  if (q.pending.length === 0 && q.problems.length === 0) return null;
  return (
    <Card>
      {q.pending.length > 0 ? (
        <>
          <Body bold>{q.pending.length === 1 ? tr('1 update waiting for signal') : tr('{count} updates waiting for signal', { count: q.pending.length })}</Body>
          <Muted>{tr('They are saved on this phone and will be sent automatically.')}</Muted>
          <Button small variant="secondary" title={tr('Send now')} onPress={() => void q.flushNow()} />
        </>
      ) : null}
      {q.problems.map((p, i) => <ErrorText key={i} error={{ message: p }} />)}
      {q.problems.length > 0 ? <Button small variant="ghost" title={tr('OK')} onPress={q.clearProblems} /> : null}
    </Card>
  );
}

function ReadAloud({ text }: { text: string }) {
  const tr = useT();
  const [speaking, setSpeaking] = useState(false);
  const toggle = () => {
    if (speaking) { void Speech.stop(); setSpeaking(false); return; }
    setSpeaking(true);
    Speech.speak(text, { language: 'en-IN', rate: 0.95, onDone: () => setSpeaking(false), onStopped: () => setSpeaking(false), onError: () => setSpeaking(false) });
  };
  return <Button small variant="secondary" title={speaking ? tr('Stop reading') : tr('Read aloud')} onPress={toggle} disabled={!text} />;
}

// ------------------------------------------------------------------ packing
function PackingView({ tasks }: { tasks: StaffTask[] }) {
  const tr = useT();
  const instructions = usePackingInstructions();
  const [scanFor, setScanFor] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<Record<string, string>>({});
  const issue = useAction(async (orderId: string, code: string) => {
    await rpc('staff_box_issued', { p_order: orderId, p_box_code: code });
    setBoxes((b) => ({ ...b, [orderId]: code }));
  });
  const totals = useMemo(() => {
    const types = new Map<string, { veg: boolean; n: number }>();
    const extras = new Map<string, number>();
    for (const t of tasks) {
      types.set(t.tiffin_type_name, { veg: t.is_veg, n: (types.get(t.tiffin_type_name)?.n ?? 0) + 1 });
      for (const a of t.addons) extras.set(a.name, (extras.get(a.name) ?? 0) + a.qty);
    }
    return { types: [...types.entries()], extras: [...extras.entries()] };
  }, [tasks]);
  const speech = [
    `${tasks.length} tiffins.`,
    ...totals.types.map(([name, v]) => `${v.n} ${name}.`),
    ...totals.extras.map(([name, n]) => `${n} ${name}.`),
  ].join(' ');

  if (tasks.length === 0) return <Empty text={tr('Nothing to pack for this meal.')} />;
  return (
    <>
      <Card>
        <H2>{tasks.length === 1 ? tr('1 tiffin') : tr('{length} tiffins', { length: tasks.length })}</H2>
        {totals.types.map(([name, v]) => <RowWrap key={name}><VegDot veg={v.veg} /><Body>{name}: <Body bold>{v.n}</Body></Body></RowWrap>)}
        {totals.extras.length ? <Body>{tr('Extras: {value}', { value: totals.extras.map(([n, q]) => `${n} ${q}`).join(', ') })}</Body> : <Muted>{tr('No extras.')}</Muted>}
        <ReadAloud text={speech} />
      </Card>
      {totals.types.map(([name]) => {
        const how = instructions.data?.get(name);
        return how ? (
          <Card key={`i-${name}`}>
            <H2>{tr('How to pack: {name}', { name: name })}</H2>
            <Body>{how.text}</Body>
            {how.photo ? <PhotoToggle bucketPath={how.photo} label={tr('packed tiffin')} /> : null}
          </Card>
        ) : null;
      })}
      <Card>
        <H2>{tr('Per person')}</H2>
        <Muted>{tr('Boxes with an AK-… sticker: tap "Box" and scan it while packing, so we know whose box it is.')}</Muted>
        {[...tasks].sort((a, b) => a.customer_name.localeCompare(b.customer_name)).map((t) => (
          <ListRow key={t.order_id} left={<VegDot veg={t.is_veg} />} title={t.customer_name}
            subtitle={[t.tiffin_type_name, t.addons.map((a) => `${a.name} × ${a.qty}`).join(', '), t.food_notes ? tr('Note: {note}', { note: t.food_notes }) : '',
              boxes[t.order_id] ? tr('Box {code}', { code: boxes[t.order_id] }) : ''].filter(Boolean).join(' · ')}
            right={t.status === 'delivered' ? <Badge text={tr('Delivered')} tone="good" />
              : <Button small variant="ghost" title={boxes[t.order_id] ? tr('Box ✓') : tr('Box')} onPress={() => setScanFor(t.order_id)} />} />
        ))}
        <ErrorText error={issue.error} />
      </Card>
      <ScanBox visible={scanFor !== null} title={tr('Scan the sticker on this person\'s box')} onClose={() => setScanFor(null)}
        onCode={(code) => { const id = scanFor; setScanFor(null); if (id) void issue.run(id, code); }} />
    </>
  );
}

/** Delivery photo (optional): needs signal; only one per meal. */
function AddPhoto({ orderId }: { orderId: string }) {
  const tr = useT();
  const [done, setDone] = useState(false);
  const add = useAction(async () => {
    const path = await rpc<string>('staff_proof_path', { p_order: orderId });
    const uploaded = await pickAndUploadPhoto('camera', 'delivery-proofs', path);
    if (!uploaded) return;
    await rpc('staff_attach_proof', { p_order: orderId, p_path: uploaded });
    setDone(true);
  });
  if (done) return <Badge text={tr('Photo added')} tone="good" />;
  return (
    <>
      <Button small variant="secondary" title={tr('Add photo')} loading={add.busy} onPress={() => void add.run()} />
      <ErrorText error={add.error} />
    </>
  );
}

// ------------------------------------------------------------------ route
function RouteView({ tasks }: { tasks: StaffTask[] }) {
  const tr = useT();
  const q = useOfflineQueue();
  const groups = useMemo(() => {
    const map = new Map<string, StaffTask[]>();
    for (const t of tasks) {
      const key = t.location_path ?? t.location_text ?? '';
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return [...map.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }, [tasks]);
  const left = tasks.filter((t) => t.status === 'scheduled' && !q.pending.some((p) => p.orderId === t.order_id));
  const speech = groups.map(([loc, list]) =>
    `${loc || 'Place not set'}. ${list.filter((t) => t.status === 'scheduled').map((t) =>
      `${t.customer_name}, ${t.tiffin_type_name}${t.addons.length ? `, plus ${t.addons.map((a) => `${a.qty} ${a.name}`).join(', ')}` : ''}.`).join(' ')}`).join(' ');

  if (tasks.length === 0) return <Empty text={tr('No deliveries assigned to you for this meal.')} />;
  return (
    <>
      <Card>
        <Body bold>{tr('{length} of {length2} left to deliver', { length: left.length, length2: tasks.length })}</Body>
        <ReadAloud text={speech} />
      </Card>
      {groups.map(([loc, list]) => (
        <Card key={loc}>
          <H2>{loc || tr('Place not set: call the customer')}</H2>
          {list[0]?.location_directions ? <Muted>{tr('Directions: {location_directions}', { location_directions: list[0].location_directions })}</Muted> : null}
          {list[0]?.location_photo_path ? <PhotoToggle bucketPath={list[0].location_photo_path} label={tr('the way in')} /> : null}
          {list.map((t) => <Stop key={t.order_id} task={t} pending={q.pending.find((p) => p.orderId === t.order_id && p.kind !== 'box_collected')} />)}
        </Card>
      ))}
    </>
  );
}

/** Kitchen photos load only when asked (saves mobile data on the route). */
function PhotoToggle({ bucketPath, label }: { bucketPath: string; label: string }) {
  const tr = useT();
  const [show, setShow] = useState(false);
  return (
    <>
      <Button small variant="ghost" title={show ? tr('Hide photo') : tr('Photo of {label}', { label: label })} onPress={() => setShow(!show)} />
      {show ? <PrivateImage bucket="kitchen-media" path={bucketPath} alt={tr('Photo of {label}', { label: label })} /> : null}
    </>
  );
}

function Stop({ task, pending }: { task: StaffTask; pending?: QueuedAction }) {
  const tr = useT();
  const q = useOfflineQueue();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const call = telLink(task.customer_phone);
  const shown = pending ? (pending.kind === 'delivered' ? tr('Delivered (sending…)') : tr('Not found (sending…)')) : STATUS[task.status] ? tr(STATUS[task.status]!) : task.status;
  return (
    <View>
      <ListRow left={<VegDot veg={task.is_veg} />} title={task.customer_name}
        subtitle={[task.tiffin_type_name, task.addons.map((a) => `${a.name} × ${a.qty}`).join(', '),
          task.location_text && task.location_path ? task.location_text : '', task.food_notes ? tr('Note: {note}', { note: task.food_notes }) : '']
          .filter(Boolean).join(' · ')}
        right={<Badge text={shown} tone={pending ? 'warn' : task.status === 'delivered' ? 'good' : task.status === 'not_delivered' ? 'bad' : 'primary'} />}
        onPress={() => setOpen(!open)} />
      {open ? (
        <View style={{ gap: 8, paddingBottom: 8 }}>
          <RowWrap>
            {task.status !== 'delivered' ? (
              <Button small title={tr('Delivered')} onPress={() => { void q.act('delivered', task.order_id); setOpen(false); }} />
            ) : null}
            {call ? <Button small variant="secondary" title={tr('Call')} onPress={() => void Linking.openURL(call)} /> : null}
            <AddPhoto orderId={task.order_id} />
          </RowWrap>
          {task.status === 'scheduled' ? (
            <>
              <Field label={tr('Not found? Reason')} value={reason} onChangeText={setReason} maxLength={200} placeholder={tr('Not at ward, phone off')} />
              <Button small variant="danger" title={tr('Mark not found')} disabled={!reason.trim()}
                onPress={() => { void q.act('not_delivered', task.order_id, { reason: reason.trim() }); setOpen(false); }} />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
