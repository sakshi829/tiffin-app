import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import {
  addDays, formatDate, formatRupees, isIsoDate, istToday, monthlyReportHtml, monthRange, paiseToRupeesNumber, toCsv,
  heatColors, HEAT_STEPS, type DailyPoint, type ProfitLoss, type WeekdayCount,
} from '@amruta/shared';
import { shareCsv, shareHtmlAsPdf, useColors, useT } from '@amruta/app-core';
import { useSettings } from '../../../lib/queries';
import { useAttendance, useDailySeries, useInsights, useProfitLoss, useWeekdayCounts } from '../../../lib/finance';
import { Badge, Body, Button, Card, Chips, DateField, Empty, ErrorText, H2, ListRow, Loading, Muted, RowWrap, Screen, SwitchRow, useAction } from '../../../ui/kit';

type Period = 'this' | 'last' | 'three' | 'custom';
const money = (p: number | null | undefined) => (p === null || p === undefined ? '-' : formatRupees(Math.round(Number(p))));

export default function Reports() {
  const tr = useT();
  const today = istToday();
  const thisMonth = monthRange(today);
  const lastMonth = monthRange(addDays(thisMonth.from, -1));
  const [period, setPeriod] = useState<Period>('this');
  const [cFrom, setCFrom] = useState(thisMonth.from);
  const [cTo, setCTo] = useState(today);
  const range = period === 'this' ? { from: thisMonth.from, to: today }
    : period === 'last' ? lastMonth
    : period === 'three' ? { from: monthRange(addDays(monthRange(addDays(thisMonth.from, -1)).from, -1)).from, to: today }
    : { from: cFrom, to: cTo };
  const valid = isIsoDate(range.from) && isIsoDate(range.to) && range.from <= range.to;

  const pl = useProfitLoss(range.from, range.to);
  const series = useDailySeries(range.from, range.to);
  const weekdays = useWeekdayCounts(range.from, range.to);
  const attendance = useAttendance(range.from, range.to);
  const insights = useInsights();
  const settings = useSettings();

  const pdf = useAction(async () => {
    if (!pl.data) return;
    await shareHtmlAsPdf(monthlyReportHtml(settings.data?.display_name ?? 'Kitchen', pl.data, insights.data ?? [], tr), 'Report');
  });
  const csv = useAction(async () => {
    const rows: (string | number)[][] = [['Date', 'Meals delivered', 'Billed (Rs)', 'Expenses (Rs)']];
    for (const d of series.data ?? []) rows.push([d.day, d.meals, paiseToRupeesNumber(d.billed_paise), paiseToRupeesNumber(d.expenses_paise)]);
    rows.push([]);
    rows.push(['Staff', 'Shifts', 'Hours']);
    for (const a of attendance.data ?? []) rows.push([a.display_name, a.shifts, Math.round(a.minutes / 6) / 10]);
    await shareCsv(toCsv(rows), `report-${range.from}-to-${range.to}`);
  });

  return (
    <Screen refreshing={pl.isFetching} onRefresh={() => { void pl.refetch(); void series.refetch(); void attendance.refetch(); }}>
      <Stack.Screen options={{ title: tr('Reports') }} />
      <Chips value={period} onChange={setPeriod} options={[
        { value: 'this', label: 'This month' }, { value: 'last', label: 'Last month' },
        { value: 'three', label: 'Last 3 months' }, { value: 'custom', label: 'Choose dates' },
      ]} />
      {period === 'custom' ? (
        <Card>
          <DateField label={tr('From')} value={cFrom} onChange={setCFrom} />
          <DateField label={tr('To')} value={cTo} onChange={setCTo} />
          <Muted>{tr('Up to about 13 months at a time.')}</Muted>
        </Card>
      ) : null}
      {valid ? <Muted>{formatDate(range.from)} – {formatDate(range.to)}</Muted> : <ErrorText error={new Error('INVALID_DATES')} />}
      {pl.isLoading ? <Loading /> : null}
      <ErrorText error={pl.error} />
      {pl.data ? <Summary pl={pl.data} /> : null}
      {series.data ? <Trend points={series.data} /> : null}
      {weekdays.data ? <WeekdayHeatmap rows={weekdays.data} /> : null}
      {pl.data ? <ByCategory pl={pl.data} /> : null}
      {pl.data ? <ByTiffin pl={pl.data} /> : null}
      <Card>
        <H2>{tr('Staff attendance')}</H2>
        <Muted>{tr('From check-in / check-out in the Staff app. Useful for salaries.')}</Muted>
        <ErrorText error={attendance.error} />
        {(attendance.data ?? []).length === 0 && !attendance.isLoading ? <Empty text={tr('No staff yet.')} /> : null}
        {(attendance.data ?? []).map((a) => (
          <ListRow key={a.staff_id} title={a.display_name}
            subtitle={a.shifts === 1
              ? tr('1 shift · {hours} h {minutes} min', { hours: Math.floor(a.minutes / 60), minutes: a.minutes % 60 })
              : tr('{count} shifts · {hours} h {minutes} min', { count: a.shifts, hours: Math.floor(a.minutes / 60), minutes: a.minutes % 60 })} />
        ))}
      </Card>
      <Card>
        <H2>{tr('Share')}</H2>
        <RowWrap>
          <Button small title={tr('Report as PDF')} disabled={!pl.data} loading={pdf.busy} onPress={() => void pdf.run()} />
          <Button small variant="secondary" title={tr('Spreadsheet (CSV)')} disabled={!series.data} loading={csv.busy} onPress={() => void csv.run()} />
        </RowWrap>
        <Muted>{tr('Expenses as a spreadsheet: Money › Expenses › Export.')}</Muted>
        <ErrorText error={pdf.error ?? csv.error} />
      </Card>
    </Screen>
  );
}

function Summary({ pl }: { pl: ProfitLoss }) {
  const tr = useT();
  const c = useColors();
  const pct = pl.payback_percent;
  return (
    <>
      <Card>
        <H2>{tr('Profit')}</H2>
        <Body>{tr('Billed to customers:')}{' '}<Body bold>{money(pl.billed_paise)}</Body></Body>
        <Body>{tr('Running expenses:')}{' '}<Body bold>{money(pl.running_expenses_paise)}</Body></Body>
        <Body bold>{pl.profit_paise >= 0 ? tr('Profit') : tr('Loss')}: {money(Math.abs(pl.profit_paise))}</Body>
        <Muted>{tr('Payments received in this period: {money}', { money: money(pl.received_paise) })}</Muted>
        <Muted>{tr('{meals_delivered} meals delivered · cost per meal {money} · billed per meal {money2}', { meals_delivered: pl.meals_delivered, money: money(pl.cost_per_meal_paise), money2: money(pl.billed_per_meal_paise) })}</Muted>
        <Muted>{tr('Tiffins left over: {waste_tiffins}', { waste_tiffins: pl.waste_tiffins })}</Muted>
      </Card>
      <Card>
        <H2>{tr('Investments')}</H2>
        <Body>{tr('In this period: {money} · all time: {money2}', { money: money(pl.investments_paise), money2: money(pl.investments_all_time_paise) })}</Body>
        {pct !== null ? (
          <>
            <Body bold>{tr('{pct}% recovered from profit', { pct: pct })}</Body>
            <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}
              style={{ height: 10, borderRadius: 5, backgroundColor: c.chip, overflow: 'hidden' }}>
              <View style={{ width: `${pct}%`, height: '100%', backgroundColor: c.chartBar, borderRadius: 5 }} />
            </View>
            <Muted>{tr('Profit since your first investment: {money}', { money: money(pl.profit_since_first_investment_paise) })}</Muted>
          </>
        ) : <Muted>{tr('No investments recorded yet (Add expense › Investment).')}</Muted>}
      </Card>
    </>
  );
}

/** Meals delivered per day: one series, one hue, tap a bar for the day's numbers; table view for exact values. */
function Trend({ points }: { points: DailyPoint[] }) {
  const tr = useT();
  const c = useColors();
  const [picked, setPicked] = useState<DailyPoint | null>(null);
  const [table, setTable] = useState(false);
  const highest = Math.max(0, ...points.map((p) => p.meals));
  const max = Math.max(1, highest);   // bar scale only; never shown (it made "Highest: 1 meals" with no deliveries)
  const H = 120;
  const shown = points.slice(-62);   // at most ~2 months of bars; the table and CSV have everything
  return (
    <Card>
      <H2>{tr('Meals delivered per day')}</H2>
      {table ? (
        [...points].reverse().map((p) => (
          <ListRow key={p.day} title={tr('{formatDate}: {meals} meals', { formatDate: formatDate(p.day), meals: p.meals })}
            subtitle={tr('Billed {money} · Spent {money2}', { money: money(p.billed_paise), money2: money(p.expenses_paise) })} />
        ))
      ) : (
        <>
          <Muted>{highest === 0 ? tr('No meals delivered in this period.')
            : highest === 1 ? tr('Highest: 1 meal')
            : tr('Highest: {max} meals', { max: highest })}</Muted>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: H, gap: 2, borderBottomWidth: 1, borderColor: c.border }}>
            {shown.map((p) => (
              <Pressable key={p.day} accessibilityRole="button" accessibilityLabel={tr('{formatDate}: {meals} meals', { formatDate: formatDate(p.day), meals: p.meals })}
                onPress={() => setPicked(picked?.day === p.day ? null : p)}
                style={{ flex: 1, height: H, justifyContent: 'flex-end' }}>
                <View style={{
                  height: p.meals === 0 ? 0 : Math.max(2, (p.meals / max) * H), backgroundColor: c.chartBar,
                  borderTopLeftRadius: 4, borderTopRightRadius: 4, opacity: picked && picked.day !== p.day ? 0.45 : 1,
                }} />
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: c.muted, fontSize: 12 }}>{shown[0] ? formatDate(shown[0].day) : ''}</Text>
            <Text style={{ color: c.muted, fontSize: 12 }}>{shown.at(-1) ? formatDate(shown.at(-1)!.day) : ''}</Text>
          </View>
          {picked ? (
            <Body>{tr('{date}: {meals} meals · billed {billed} · spent {spent}', { date: formatDate(picked.day), meals: picked.meals, billed: money(picked.billed_paise), spent: money(picked.expenses_paise) })}</Body>
          ) : <Muted>{tr('Tap a bar to see that day.')}</Muted>}
        </>
      )}
      <SwitchRow label={tr('Show as a list')} value={table} onValueChange={setTable} />
    </Card>
  );
}

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LONG = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Which weekday and meal is busiest (F36). One hue, darker = more meals a day on
 * average; every cell also shows its number and skip rate, so colour is never the
 * only way to read it.
 */
function WeekdayHeatmap({ rows }: { rows: WeekdayCount[] }) {
  const tr = useT();
  const c = useColors();
  const steps = heatColors(c);
  const avg = (r: WeekdayCount) => (r.days > 0 ? r.delivered / r.days : 0);
  const max = Math.max(0, ...rows.map(avg));
  const cell = (wd: number, slot: 'lunch' | 'dinner') => rows.find((r) => r.weekday === wd && r.meal_slot === slot);
  const step = (v: number) => (max === 0 ? 0 : Math.min(HEAT_STEPS - 1, Math.round((v / max) * (HEAT_STEPS - 1))));
  return (
    <Card>
      <H2>{tr('Busy days')}</H2>
      <Muted>{tr('Meals delivered per day, on average for each weekday. Darker = busier. Small text: share skipped.')}</Muted>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <View style={{ width: 44 }} />
        {(['Lunch', 'Dinner'] as const).map((h) => (
          <Text key={h} style={{ flex: 1, textAlign: 'center', color: c.muted, fontWeight: '600' }}>{tr(h)}</Text>
        ))}
      </View>
      {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
        <View key={wd} style={{ flexDirection: 'row', gap: 4, alignItems: 'stretch' }}>
          <Text style={{ width: 44, color: c.text, alignSelf: 'center' }}>{tr(DAY[wd]!)}</Text>
          {(['lunch', 'dinner'] as const).map((slot) => {
            const r = cell(wd, slot);
            const v = r ? avg(r) : 0;
            const total = r ? r.delivered + r.skipped : 0;
            const skipPct = total > 0 ? Math.round(((r?.skipped ?? 0) / total) * 100) : 0;
            const { bg, fg } = steps[step(v)]!;
            return (
              <View key={slot} accessible accessibilityLabel={tr(slot === 'lunch' ? '{day} lunch: {avg} meals a day on average, {skipPct}% skipped' : '{day} dinner: {avg} meals a day on average, {skipPct}% skipped', { day: tr(DAY_LONG[wd]!), avg: v.toFixed(1), skipPct })}
                style={{ flex: 1, minHeight: 44, borderRadius: 6, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 }}>
                <Text style={{ color: fg, fontWeight: '700', fontSize: 16 }}>{v.toFixed(1)}</Text>
                {total > 0 ? <Text style={{ color: fg, fontSize: 12 }}>{tr('{skipPct}% skipped', { skipPct: skipPct })}</Text> : null}
              </View>
            );
          })}
        </View>
      ))}
    </Card>
  );
}

function ByCategory({ pl }: { pl: ProfitLoss }) {
  const tr = useT();
  const c = useColors();
  const max = Math.max(1, ...pl.by_category.map((x) => Math.max(Number(x.amount_paise), Number(x.budget_paise ?? 0))));
  return (
    <Card>
      <H2>{tr('Spending by category')}</H2>
      {pl.by_category.length === 0 ? <Empty text={tr('No expenses in this period.')} /> : null}
      {pl.by_category.map((x) => {
        const amt = Number(x.amount_paise);
        const over = x.budget_paise !== null && amt > Number(x.budget_paise);
        return (
          <View key={`${x.name}-${x.kind}`} style={{ gap: 4, paddingVertical: 4 }}>
            <RowWrap>
              <Body>{x.name}{x.kind === 'investment' ? tr(' (investment)') : ''}: <Body bold>{money(amt)}</Body></Body>
              {x.budget_paise !== null ? <Muted>{tr('of {money} budget', { money: money(x.budget_paise) })}</Muted> : null}
              {over ? <Badge text={tr('Over budget')} tone="warn" /> : null}
            </RowWrap>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: c.chip, overflow: 'hidden' }}>
              <View style={{ width: `${(amt / max) * 100}%`, height: '100%', backgroundColor: c.chartBar, borderRadius: 4 }} />
            </View>
          </View>
        );
      })}
      <Muted>{tr('Budgets are per month: compare them with a one-month period.')}</Muted>
    </Card>
  );
}

function ByTiffin({ pl }: { pl: ProfitLoss }) {
  const tr = useT();
  return (
    <Card>
      <H2>{tr('By tiffin type')}</H2>
      {pl.by_tiffin_type.length === 0 ? <Empty text={tr('No meals billed in this period.')} /> : null}
      {pl.by_tiffin_type.map((t) => (
        <ListRow key={t.name} title={t.name} subtitle={tr('{meals} meals', { meals: t.meals })} right={<Body bold>{money(t.billed_paise)}</Body>} />
      ))}
    </Card>
  );
}
