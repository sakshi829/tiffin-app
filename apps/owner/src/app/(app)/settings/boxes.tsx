import { useState } from 'react';
import { Stack } from 'expo-router';
import qrcode from 'qrcode-generator';
import { formatDate, stickerSheetHtml } from '@amruta/shared';
import { shareHtmlAsPdf, useT } from '@amruta/app-core';
import { AppError, rpc } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useBoxesOut, useRefreshAll, useSettings } from '../../../lib/queries';
import { Badge, Button, Card, Empty, ErrorText, Field, H2, ListRow, Loading, Muted, Screen, useAction } from '../../../ui/kit';

/** Delivered meals whose box hasn't come back (last 30 days). */
export default function BoxesOut() {
  const tr = useT();
  const boxes = useBoxesOut();
  const refreshAll = useRefreshAll();
  const collect = useAction(async (orderId: string) => { await rpc('owner_box_collected', { p_order: orderId }); await refreshAll(); });
  const list = boxes.data ?? [];
  const { kitchenId } = useOwner();
  const settings = useSettings();
  const [count, setCount] = useState('12');
  const print = useAction(async () => {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 200) throw new AppError('INVALID_QUANTITY');
    const codes = await rpc<string[]>('owner_create_boxes', { p_kitchen: kitchenId, p_count: n });
    const stickers = codes.map((code) => {
      const qr = qrcode(0, 'M');
      qr.addData(code);
      qr.make();
      return { code, svg: qr.createSvgTag({ cellSize: 4, margin: 2 }) };
    });
    await shareHtmlAsPdf(stickerSheetHtml(settings.data?.display_name ?? "Amruta's Kitchen", stickers, tr), 'Box stickers');
  });
  return (
    <Screen refreshing={boxes.isFetching} onRefresh={() => void boxes.refetch()}>
      <Stack.Screen options={{ title: tr('Boxes not back') }} />
      <Muted>{tr('Customers can say where they left the box; delivery staff mark it collected in the Staff app.')}</Muted>
      <Card>
        <H2>{tr('QR stickers for boxes')}</H2>
        <Muted>{tr('Makes new numbered codes (AK-001, AK-002…) and a printable sheet. Stick one on each box (cover with clear tape: boxes get washed). Kitchen staff scan the box while packing; delivery staff scan it when collecting, so you always know whose box is where.')}</Muted>
        <Field label={tr('How many new stickers')} value={count} onChangeText={setCount} numeric="integer" min={1} max={200} maxLength={3} />
        <ErrorText error={print.error} />
        <Button small variant="secondary" title={tr('Make & print stickers')} loading={print.busy} onPress={() => void print.run()} />
      </Card>
      {boxes.isLoading ? <Loading /> : null}
      <ErrorText error={boxes.error ?? collect.error} />
      <Card>
        <H2>{list.length === 1 ? tr('1 box out') : tr('{count} boxes out', { count: list.length })}</H2>
        {list.length === 0 && !boxes.isLoading ? <Empty text={tr('All boxes are back.')} /> : null}
        {list.map((b) => (
          <ListRow key={b.order_id} title={b.customer_name}
            subtitle={[b.kept_at ? `Kept at: ${b.kept_at}` : 'Customer has not said where', `${b.meal_slot} ${formatDate(b.order_date)}`].join(' · ')}
            right={<>
              {b.days_out >= 3 ? <Badge text={tr('{days_out} days', { days_out: b.days_out })} tone="bad" /> : null}
              <Button small variant="ghost" title={tr('Collected')} onPress={() => void collect.run(b.order_id)} />
            </>} />
        ))}
      </Card>
    </Screen>
  );
}
