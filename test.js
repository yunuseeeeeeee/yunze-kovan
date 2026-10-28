const assert = require('assert');
const { createHive } = require('./kovan.umd.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const O = { heartbeat: 100, settle: 60 };
const name = 't' + Date.now();
const log = [];

// once muted it sends neither heartbeats nor bye, like a crashed tab
let mute = false;
class Mutable extends BroadcastChannel {
  postMessage(m) { if (!mute) super.postMessage(m); }
}

(async () => {
  const a = createHive(name, { ...O, initial: { x: 0 } }); await sleep(5);
  const b = createHive(name, { ...O, Channel: Mutable }); await sleep(5);
  const c = createHive(name, O);
  for (const h of [a, b, c]) h.handle('double', (n) => n * 2);
  a.onLeader(() => { log.push('a leads'); return () => log.push('a stopped'); });
  b.onLeader(() => { log.push('b leads'); return () => log.push('b stopped'); });
  await Promise.all([a.ready, b.ready, c.ready]);
  await sleep(80);

  // oldest tab should be the leader
  assert.deepStrictEqual([a, b, c].map((h) => h.isLeader), [true, false, false]);
  assert.strictEqual(a.peers().length, 3);
  assert.deepStrictEqual(log, ['a leads']);

  // state spreads to every tab
  a.set({ x: 1 }); await sleep(40);
  assert.strictEqual(b.get().x, 1);
  assert.strictEqual(c.get().x, 1);
  c.set((s) => ({ x: s.x + 1 })); await sleep(40);
  assert.strictEqual(a.get().x, 2);

  // concurrent writes should end up the same everywhere
  a.set({ k: 'a' }); b.set({ k: 'b' }); c.set({ k: 'c' }); await sleep(60);
  assert.ok(a.get().k === b.get().k && b.get().k === c.get().k);

  b.set({ k: undefined }); await sleep(40);
  assert.ok(!('k' in a.get()) && !('k' in c.get()));

  // a tab opened later should get the current state
  const d = createHive(name, O); await sleep(60);
  assert.strictEqual(d.get().x, 2);
  assert.ok(!d.isLeader);

  assert.strictEqual(await c.request('double', 21), 42);
  await assert.rejects(() => c.request('missing'), /no handler/);

  let got = null;
  d.on('ping', (v) => (got = v));
  a.emit('ping', 7); await sleep(40);
  assert.strictEqual(got, 7);

  // clean close of the leader: b takes over
  a.close(); await sleep(60);
  assert.ok(b.isLeader && !c.isLeader);
  assert.deepStrictEqual(log, ['a leads', 'a stopped', 'b leads']);
  assert.strictEqual(await c.request('double', 5), 10);

  // leader crashes (no bye): c takes over after the timeout
  mute = true; await sleep(600);
  assert.ok(c.isLeader && !d.isLeader);
  assert.strictEqual(await d.request('double', 4), 8);

  console.log('tests passed');
  [b, c, d].forEach((h) => h.close());
})().catch((e) => { console.error('failed:', e); process.exit(1); });
