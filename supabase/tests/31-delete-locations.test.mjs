// Deleting places and spots: only this kitchen's owner, only when nothing uses them
// (the database's foreign keys decide), otherwise LOCATION_IN_USE and nothing changes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u;
before(async () => { w = await buildWorld(); t = w.t; u = w.u; });
after(async () => { await t.close(); });

const del = (user, kind, id) => t.call(user, 'public.owner_delete_location($1, $2)', [kind, id]);
const spot = async (name, placeId = w.place) =>
  (await t.as(u.owner, `insert into public.location_nodes (kitchen_id, place_id, name, kind) values ($1, $2, $3, 'lab') returning id`, [w.k1, placeId, name]))[0].id;
const exists = async (table, id) => (await t.sql(`select count(*)::int n from public.${table} where id = $1`, [id]))[0].n === 1;

test('owner deletes a spot that nothing uses; it is gone', async () => {
  const id = await spot('Typo lab');
  await del(u.owner, 'spot', id);
  assert.equal(await exists('location_nodes', id), false);
});

test('a spot in use (a customer\'s usual place, meal plans, orders) is refused and kept', async () => {
  await rejects(del(u.owner, 'spot', w.ward5), 'LOCATION_IN_USE');
  assert.equal(await exists('location_nodes', w.ward5), true);
});

test('a spot with a spot inside it is refused; after removing the inner one it can go', async () => {
  const outer = await spot('Block C');
  const [{ id: inner }] = await t.as(u.owner, `insert into public.location_nodes (kitchen_id, place_id, parent_id, name, kind) values ($1, $2, $3, 'Room 4', 'other') returning id`, [w.k1, w.place, outer]);
  await rejects(del(u.owner, 'spot', outer), 'LOCATION_IN_USE');
  await del(u.owner, 'spot', inner);
  await del(u.owner, 'spot', outer);
  assert.equal(await exists('location_nodes', outer), false);
});

test('a place with spots is refused; an empty place can be deleted', async () => {
  await rejects(del(u.owner, 'place', w.place), 'LOCATION_IN_USE');
  assert.equal(await exists('places', w.place), true);
  const [{ id: empty }] = await t.as(u.owner, `insert into public.places (kitchen_id, name, kind) values ($1, 'Wrong place', 'other') returning id`, [w.k1]);
  await del(u.owner, 'place', empty);
  assert.equal(await exists('places', empty), false);
});

test('nobody else can delete: other kitchen\'s owner, customers, staff, signed-out visitors', async () => {
  const id = await spot('Not yours');
  await rejects(del(u.owner2, 'spot', id), 'NOT_ALLOWED');
  await rejects(del(u.custA, 'spot', id), 'NOT_ALLOWED');
  await rejects(del(u.delivery, 'spot', id), 'NOT_ALLOWED');
  await rejects(t.as(null, 'select public.owner_delete_location($1, $2)', ['spot', id]), 'permission denied');
  assert.equal(await exists('location_nodes', id), true);
});

test('unknown ids and kinds are refused; owners still have no direct DELETE on these tables', async () => {
  await rejects(del(u.owner, 'spot', '00000000-0000-4000-8000-000000000000'), 'NOT_FOUND');
  await rejects(del(u.owner, 'table', w.ward5), 'INVALID_REQUEST');
  const id = await spot('Direct delete try');
  await rejects(t.as(u.owner, 'delete from public.location_nodes where id = $1', [id]), 'permission denied');
  assert.equal(await exists('location_nodes', id), true);
});
