import { useState } from 'react';
import { View } from 'react-native';
import {
  Badge, Body, Button, Card, Empty, ErrorText, Field, H2, ListRow, Loading, Muted, newIdempotencyKey, rpc, RowWrap, Screen, useAction, useT,
} from '@amruta/app-core';
import { ScanBox } from '../../../components/ScanBox';
import { formatDate, type BoxOut } from '@amruta/shared';
import { isDeliveryRole, useStaffMe } from '../../../lib/auth';
import { useOfflineQueue } from '../../../lib/offline';
import { useBoxPickups } from '../../../lib/queries';

/** Empty boxes to bring back from your deliveries of the last 7 days. */
export default function Boxes() {
  const tr = useT();
  const { staff, kitchenId } = useStaffMe();
  const pickups = useBoxPickups(isDeliveryRole(staff));
  const q = useOfflineQueue();
  const list = (pickups.data ?? []).filter((b) => !q.pending.some((p) => p.kind === 'box_collected' && p.orderId === b.order_id));
  const told = list.filter((b) => b.kept_at);
  const notTold = list.filter((b) => !b.kept_at);

  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const scan = useAction(async (code: string) => {
    const r = await rpc<{ box: string; customer_name: string }>('staff_box_scan_collect', {
      p_kitchen: kitchenId, p_box_code: code, p_idempotency_key: newIdempotencyKey(),
    });
    setLastScan(`${r.box}: ${r.customer_name}'s box collected.`);
    await pickups.refetch();
  });

  return (
    <Screen refreshing={pickups.isFetching} onRefresh={() => void pickups.refetch()}>
      <Card>
        <Button title={tr('Scan a box sticker')} onPress={() => { setLastScan(null); setScanning(true); }} />
        <Muted>{tr('For boxes with an AK-… sticker that were scanned when packed. Needs signal.')}</Muted>
        {lastScan ? <Body bold>{lastScan}</Body> : null}
        <ErrorText error={scan.error} />
      </Card>
      <ScanBox visible={scanning} title={tr('Scan the sticker on the empty box')} onClose={() => setScanning(false)}
        onCode={(code) => { setScanning(false); void scan.run(code); }} />
      {pickups.isLoading ? <Loading /> : null}
      <ErrorText error={pickups.error} />
      <Card>
        <H2>{tr('Customer told us where ({length})', { length: told.length })}</H2>
        {told.length === 0 ? <Empty text={tr('Nothing here.')} /> : told.map((b) => <Pickup key={b.order_id} box={b} />)}
      </Card>
      <Card>
        <H2>{tr('Not told yet ({length})', { length: notTold.length })}</H2>
        <Muted>{tr('Ask at their place, or they may still be using it.')}</Muted>
        {notTold.map((b) => <Pickup key={b.order_id} box={b} />)}
      </Card>
    </Screen>
  );
}

function Pickup({ box }: { box: BoxOut }) {
  const tr = useT();
  const q = useOfflineQueue();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  return (
    <View>
      <ListRow title={box.customer_name}
        subtitle={[box.kept_at ? tr('Kept at: {place}', { place: box.kept_at }) : box.location_path ?? box.location_text ?? '',
          `${box.meal_slot === 'lunch' ? tr('Lunch') : tr('Dinner')} ${formatDate(box.order_date)}`].filter(Boolean).join(' · ')}
        right={box.days_out >= 2 ? <Badge text={tr('{days_out} days', { days_out: box.days_out })} tone="warn" /> : undefined}
        onPress={() => setOpen(!open)} />
      {open ? (
        <View style={{ gap: 8, paddingBottom: 8 }}>
          <Field label={tr('Box sticker code (optional)')} value={code} onChangeText={setCode} autoCapitalize="characters" maxLength={20} placeholder={tr('AK-017')} />
          <RowWrap>
            <Button small title={tr('Collected')} onPress={() => { void q.act('box_collected', box.order_id, { boxCode: code.trim() || undefined }); setOpen(false); }} />
          </RowWrap>
          <Body>{tr('Or use "Scan a box sticker" at the top.')}</Body>
        </View>
      ) : null}
    </View>
  );
}
