import { Stack } from 'expo-router';
import { useInsights } from '../../../lib/finance';
import { Badge, Body, Card, Empty, ErrorText, Loading, Muted, Screen } from '../../../ui/kit';
import { useT } from '@amruta/app-core';

/**
 * Suggestions from simple rules over your own numbers (no AI, nothing leaves the
 * database): spending growing faster than meals, cost per meal, skip patterns,
 * waste, old dues, budgets, boxes not back, customers ordering less, payback.
 */
export default function Insights() {
  const tr = useT();
  const insights = useInsights();
  const rows = [...(insights.data ?? [])].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warn' ? -1 : 1));
  return (
    <Screen refreshing={insights.isFetching} onRefresh={() => void insights.refetch()}>
      <Stack.Screen options={{ title: tr('Suggestions') }} />
      <Muted>{tr('Worked out from your own numbers each time you open this. Pull down to refresh.')}</Muted>
      {insights.isLoading ? <Loading /> : null}
      <ErrorText error={insights.error} />
      {!insights.isLoading && rows.length === 0 ? <Empty text={tr('Nothing to point out right now.')} /> : null}
      {rows.map((i) => (
        <Card key={i.title}>
          <Badge text={i.severity === 'warn' ? tr('Check this') : tr('Tip')} tone={i.severity === 'warn' ? 'warn' : 'neutral'} />
          <Body bold>{i.title}</Body>
          <Body>{i.detail}</Body>
        </Card>
      ))}
    </Screen>
  );
}
