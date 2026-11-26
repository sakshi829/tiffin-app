import { useMemo, useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import {
  Body, Button, Card, ErrorText, Field, H2, ListRow, Loading, Muted, rpc, Screen, SwitchRow, useAction, useT,
} from '@amruta/app-core';
import { addDays, describeLocation, istClock, istToday, matchesSearch, mealActions, nodePath } from '@amruta/shared';
import { useMyOrders, useNow, usePlaces, useRefreshAll, useSavedLocations } from '../../lib/queries';

/** "Where are you today?": pick from the kitchen's list, recent places, yesterday's, or type it. */
export default function LocationPicker() {
  const tr = useT();
  const { orderId, date } = useLocalSearchParams<{ orderId: string; date: string }>();
  const now = useNow();
  const orders = useMyOrders(addDays(date, -1), date);
  const places = usePlaces();
  const saved = useSavedLocations();
  const refreshAll = useRefreshAll();
  const [search, setSearch] = useState('');
  const [text, setText] = useState('');
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [alsoOther, setAlsoOther] = useState(true);

  const order = orders.data?.find((o) => o.order_id === orderId);
  const yesterday = orders.data?.find((o) => order && o.order_date === addDays(date, -1) && o.meal_slot === order.meal_slot);
  const other = orders.data?.find((o) => order && o.order_date === date && o.order_id !== orderId
    && mealActions(o, now, istToday()).canSetLocation);

  const nodes = useMemo(() => (places.data?.nodes ?? [])
    .map((n) => ({ id: n.id, path: nodePath(n.id, places.data) ?? n.name }))
    .filter((n) => matchesSearch(n.path, search))
    .sort((x, y) => x.path.localeCompare(y.path))
    .slice(0, 30), [places.data, search]);

  const save = useAction(async (node: string | null, freeText: string | null) => {
    const args = (id: string) => ({ p_order: id, p_location_node: node, p_location_text: freeText });
    await rpc('customer_set_location', args(orderId));
    if (alsoOther && other) await rpc('customer_set_location', args(other.order_id));
    await refreshAll();
    router.back();
  });

  if (orders.isLoading || places.isLoading) return <Loading />;
  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Where are you today?') }} />
      {order ? <Muted>{tr('Can be changed until {istClock}.', { istClock: istClock(order.location_cutoff_at) })}</Muted> : null}
      {other ? <SwitchRow label={tr(other.meal_slot === 'lunch' ? 'Also for my lunch today' : 'Also for my dinner today')} value={alsoOther} onValueChange={setAlsoOther} /> : null}

      {yesterday && (yesterday.location_node_id || yesterday.location_text) ? (
        <Card>
          <Body>{tr('Same as yesterday: {describeLocation}', { describeLocation: describeLocation(yesterday) })}</Body>
          <Button small title={tr('Use this')} loading={save.busy}
            onPress={() => void save.run(yesterday.location_node_id, yesterday.location_text)} />
        </Card>
      ) : null}

      {(saved.data ?? []).length > 0 ? (
        <Card>
          <H2>{tr('Recent')}</H2>
          {(saved.data ?? []).map((s) => {
            const label = [nodePath(s.location_node_id, places.data), s.location_text].filter(Boolean).join(' · ');
            return <ListRow key={s.id} title={label || tr('Saved place')} onPress={() => void save.run(s.location_node_id, s.location_text)} />;
          })}
        </Card>
      ) : null}

      <Card>
        <H2>{tr('Choose from the list')}</H2>
        <Field label={tr('Search (e.g. ward 5, lab, desk)')} value={search} onChangeText={setSearch} autoCapitalize="none" />
        {nodes.map((n) => (
          <ListRow key={n.id} title={n.path} onPress={() => setNodeId(n.id === nodeId ? null : n.id)}
            right={n.id === nodeId ? <Body bold>✓</Body> : undefined} />
        ))}
        {nodes.length === 0 ? <Muted>{tr('Not in the list? Describe it below.')}</Muted> : null}
      </Card>

      <Card>
        <Field label={nodeId ? tr('Extra detail (optional, e.g. bed 12)') : tr('Or describe where you are')} value={text} onChangeText={setText}
          maxLength={120} hint={tr('Tip: tap the microphone on your keyboard to speak instead of typing.')} />
        <ErrorText error={save.error} />
        <Button title={tr('Save')} loading={save.busy} disabled={!nodeId && !text.trim()}
          onPress={() => void save.run(nodeId, text.trim() || null)} />
      </Card>
    </Screen>
  );
}
