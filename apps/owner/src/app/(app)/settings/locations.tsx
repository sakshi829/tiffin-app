import { useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { pickAndUploadPhoto, PrivateImage, useT } from '@amruta/app-core';
import { getSupabase } from '../../../lib/supabase';
import { AppError, rpc, run } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { nodePath, usePlaceStaff, usePlaces, useRefreshAll, useStaff } from '../../../lib/queries';
import { Badge, Button, Card, Chips, Empty, ErrorText, Field, H2, ListRow, Loading, Muted, RowWrap, Screen, useAction } from '../../../ui/kit';

const PLACE_KINDS = [
  { value: 'hospital', label: 'Hospital' }, { value: 'office', label: 'Office' }, { value: 'college', label: 'College' },
  { value: 'home', label: 'Home' }, { value: 'other', label: 'Other' },
] as const;
const NODE_KINDS = [
  { value: 'building', label: 'Building' }, { value: 'floor', label: 'Floor' }, { value: 'department', label: 'Department' },
  { value: 'ward', label: 'Ward' }, { value: 'lab', label: 'Lab' }, { value: 'desk', label: 'Desk' }, { value: 'gate', label: 'Gate' },
  { value: 'other', label: 'Other' },
] as const;

export default function Locations() {
  const tr = useT();
  const { kitchenId } = useOwner();
  const data = usePlaces();
  const staff = useStaff();
  const placeStaff = usePlaceStaff();
  const refreshAll = useRefreshAll();
  const [placeName, setPlaceName] = useState('');
  const [placeKind, setPlaceKind] = useState<string>('hospital');
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string>('');
  const [nodeName, setNodeName] = useState('');
  const [nodeKind, setNodeKind] = useState<string>('ward');
  const [directions, setDirections] = useState('');
  const [photoFor, setPhotoFor] = useState<string | null>(null);
  const dirPhoto = useAction(async (nodeId: string, source: 'camera' | 'library') => {
    const path = await pickAndUploadPhoto(source, 'kitchen-media', `${kitchenId}/dir-${nodeId.slice(0, 8)}-${Date.now()}.jpg`);
    if (!path) return;
    await run(getSupabase().from('location_nodes').update({ directions_photo_path: path }).eq('id', nodeId).select('id').single());
    await refreshAll();
  });

  const addPlace = useAction(async () => {
    if (!placeName.trim()) throw new AppError('INVALID_REQUEST');
    await run(getSupabase().from('places').insert({ kitchen_id: kitchenId, name: placeName.trim(), kind: placeKind }));
    setPlaceName('');
    await refreshAll();
  });
  const addNode = useAction(async () => {
    if (!placeId || !nodeName.trim()) throw new AppError('INVALID_REQUEST');
    await run(getSupabase().from('location_nodes').insert({
      kitchen_id: kitchenId, place_id: placeId, parent_id: parentId || null, name: nodeName.trim(), kind: nodeKind,
      directions: directions.trim() || null,
    }));
    setNodeName(''); setDirections('');
    await refreshAll();
  });
  const toggle = useAction(async (table: 'places' | 'location_nodes', id: string, active: boolean) => {
    await run(getSupabase().from(table).update({ active }).eq('id', id).select('id').single());
    await refreshAll();
  });

  const setPlaceStaff = useAction(async (place: string, staffId: string | null) => {
    await rpc('owner_set_place_staff', { p_place: place, p_staff: staffId });
    await refreshAll();
  });
  const deliveryStaff = (staff.data ?? []).filter((s) => s.active && (s.role === 'delivery' || s.role === 'kitchen_delivery'));
  const staffName = (id: string | undefined) => (id ? staff.data?.find((s) => s.id === id)?.display_name : undefined);

  if (data.isLoading) return <Loading />;
  const places = data.data?.places ?? [];
  const nodes = data.data?.nodes ?? [];
  const placeNodes = nodes.filter((n) => n.place_id === placeId);

  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Locations') }} />
      <Muted>{tr('Customers pick their place for the day from this list (or type their own). Staff see the directions.')}</Muted>
      <Card>
        <H2>{tr('Places')}</H2>
        {places.length === 0 ? <Empty text={tr('No places yet.')} /> : null}
        {places.map((p) => (
          <ListRow key={p.id} title={p.name}
            subtitle={((kind: string, spots: number, by: string | undefined) => [kind, spots === 1 ? tr('1 spot') : tr('{count} spots', { count: spots }),
              by ? tr('delivered by {name}', { name: by }) : tr('delivered by whoever you assign')].join(' · '))(
              tr(PLACE_KINDS.find((k) => k.value === p.kind)?.label ?? p.kind), nodes.filter((n) => n.place_id === p.id).length,
              staffName(placeStaff.data?.find((x) => x.place_id === p.id)?.staff_id) ?? undefined)}
            right={<Button small variant="ghost" title={p.active ? tr('Hide') : tr('Show')} onPress={() => void toggle.run('places', p.id, !p.active)} />}
            onPress={() => { setPlaceId(p.id); setParentId(''); }} />
        ))}
        <Field label={tr('New place')} value={placeName} onChangeText={setPlaceName} maxLength={100} placeholder={tr('e.g. City Hospital, Tech Park')} />
        <Chips value={placeKind} onChange={setPlaceKind} options={PLACE_KINDS} />
        <ErrorText error={addPlace.error ?? toggle.error} />
        <Button small title={tr('Add place')} loading={addPlace.busy} onPress={() => void addPlace.run()} />
      </Card>
      {placeId ? (
        <Card>
          <H2>{tr('Spots in {name}', { name: places.find((p) => p.id === placeId)?.name ?? '' })}</H2>
          {deliveryStaff.length > 0 ? (
            <>
              <Chips label={tr('Delivered by (assigned automatically)')} value={placeStaff.data?.find((x) => x.place_id === placeId)?.staff_id ?? ''}
                onChange={(v) => void setPlaceStaff.run(placeId, v || null)}
                options={[{ value: '', label: 'No one (I assign)' }, ...deliveryStaff.map((s) => ({ value: s.id, label: s.display_name }))]} />
              <Muted>{tr('Meals at this place with no delivery person get this person automatically. Your manual choices are never changed.')}</Muted>
              <ErrorText error={setPlaceStaff.error} />
            </>
          ) : null}
          {placeNodes.length === 0 ? <Empty text={tr('No wards/labs/desks yet.')} /> : null}
          {placeNodes.map((n) => (
            <View key={n.id}>
              <ListRow title={nodePath(n.id, data.data) ?? n.name}
                subtitle={[n.directions ?? tr(NODE_KINDS.find((k) => k.value === n.kind)?.label ?? n.kind), n.directions_photo_path ? tr('Photo') : ''].filter(Boolean).join(' · ')}
                right={n.active ? <RowWrap>
                  <Button small variant="ghost" title={tr('Photo')} onPress={() => setPhotoFor(photoFor === n.id ? null : n.id)} />
                  <Button small variant="ghost" title={tr('Hide')} onPress={() => void toggle.run('location_nodes', n.id, false)} />
                </RowWrap> : <Badge text={tr('Hidden')} />}
                onPress={n.active ? undefined : () => void toggle.run('location_nodes', n.id, true)} />
              {photoFor === n.id ? (
                <View style={{ gap: 8, paddingBottom: 8 }}>
                  <Muted>{tr('A photo of the way in (entrance, counter, shelf) helps new delivery staff. Staff of your kitchen can see it.')}</Muted>
                  <PrivateImage bucket="kitchen-media" path={n.directions_photo_path} alt={tr('Photo of the way in to {name}', { name: n.name })} />
                  <RowWrap>
                    <Button small variant="secondary" title={tr('Take photo')} loading={dirPhoto.busy} onPress={() => void dirPhoto.run(n.id, 'camera')} />
                    <Button small variant="ghost" title={tr('From gallery')} loading={dirPhoto.busy} onPress={() => void dirPhoto.run(n.id, 'library')} />
                  </RowWrap>
                  <ErrorText error={dirPhoto.error} />
                </View>
              ) : null}
            </View>
          ))}
          <Field label={tr('New spot')} value={nodeName} onChangeText={setNodeName} maxLength={100} placeholder={tr('e.g. Ward 5, Pathology lab, Desk 12')} />
          <Chips value={nodeKind} onChange={setNodeKind} options={NODE_KINDS} />
          {placeNodes.length > 0 ? (
            <Chips label={tr('Inside (optional)')} value={parentId} onChange={setParentId} options={[
              { value: '', label: 'Directly in the place' },
              ...placeNodes.filter((n) => n.active).map((n) => ({ value: n.id, label: n.name })),
            ]} />
          ) : null}
          <Field label={tr('Directions for staff')} value={directions} onChangeText={setDirections} maxLength={1000} multiline
            placeholder={tr('3rd floor, lift B, give to nurse station')} />
          <ErrorText error={addNode.error} />
          <Button small title={tr('Add spot')} loading={addNode.busy} onPress={() => void addNode.run()} />
        </Card>
      ) : <Muted>{tr('Tap a place to add wards, labs or desks inside it.')}</Muted>}
    </Screen>
  );
}
