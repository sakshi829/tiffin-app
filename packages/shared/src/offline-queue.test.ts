import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueue, flushQueue, memoryStore, type QueuedAction, type SendResult } from './offline-queue.ts';

const act = (id: string, kind: QueuedAction['kind'], orderId: string): QueuedAction => ({ id, kind, orderId, queuedAt: 0 });

test('latest decision per meal wins; box pickups are kept separately', async () => {
  const store = memoryStore();
  await enqueue(store, act('1', 'not_delivered', 'o1'));
  await enqueue(store, act('2', 'delivered', 'o1'));
  await enqueue(store, act('3', 'box_collected', 'o1'));
  await enqueue(store, act('4', 'delivered', 'o2'));
  assert.deepEqual((await store.load()).map((a) => a.id), ['2', '3', '4']);
});

test('flush sends in order, stops when offline, keeps the rest', async () => {
  const store = memoryStore([act('a', 'delivered', 'o1'), act('b', 'delivered', 'o2'), act('c', 'delivered', 'o3')]);
  const sent: string[] = [];
  const report = await flushQueue(store, async (a): Promise<SendResult> => {
    if (a.id === 'b') return { result: 'retry' };
    sent.push(a.id);
    return { result: 'done' };
  });
  assert.deepEqual(sent, ['a']);
  assert.equal(report.sent, 1);
  assert.equal(report.remaining, 2);
  assert.deepEqual((await store.load()).map((a) => a.id), ['b', 'c']);
});

test('refused actions are dropped with their message, others continue', async () => {
  const store = memoryStore([act('a', 'delivered', 'o1'), act('b', 'delivered', 'o2')]);
  const report = await flushQueue(store, async (a): Promise<SendResult> =>
    a.id === 'a' ? { result: 'drop', message: 'This can only be done on the day of the meal.' } : { result: 'done' });
  assert.equal(report.sent, 1);
  assert.equal(report.dropped[0]?.message, 'This can only be done on the day of the meal.');
  assert.deepEqual(await store.load(), []);
});
