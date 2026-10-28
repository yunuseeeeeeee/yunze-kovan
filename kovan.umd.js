(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Kovan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
const cmp = (a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createHive(name, opts = {}) {
  if (!name) throw new Error('createHive: name is required');
  const {
    initial = {},
    heartbeat = 1000,
    timeout = heartbeat * 3.5,
    settle = 250,
    requestTimeout = 5000,
    Channel = globalThis.BroadcastChannel,
  } = opts;

  // ids sort by creation time, the oldest tab ends up as leader
  const id = Date.now().toString(36).padStart(9, '0') + Math.random().toString(36).slice(2, 8);
  const ch = Channel ? new Channel('kovan:' + name) : { postMessage() {}, close() {} };

  let state = { ...initial };
  let clock = 0, closed = false, settled = false, leader = null, n = 0;
  const vers = {}; // key -> [clock, writer id], last write wins
  const peers = new Map();
  const subs = new Set(), evs = new Map(), handlers = new Map(), pending = new Map();
  const leaderFns = new Map(); // fn -> cleanup it returned when this tab became leader

  const send = (m) => { if (!closed) ch.postMessage({ ...m, from: id }); };
  const fire = (ev, data) => (evs.get(ev) || []).forEach((fn) => fn(data));

  function merge(patch, pv) {
    const next = { ...state };
    let changed = false;
    for (const k of Object.keys(patch)) {
      if (!pv[k] || cmp(pv[k], vers[k] || [0, '']) <= 0) continue;
      vers[k] = pv[k];
      clock = Math.max(clock, pv[k][0]);
      if (patch[k] === undefined) delete next[k];
      else next[k] = patch[k];
      changed = true;
    }
    if (changed) state = next;
    return changed;
  }

  function set(patch) {
    if (typeof patch === 'function') patch = patch(state);
    const pv = {};
    clock++;
    for (const k of Object.keys(patch)) pv[k] = [clock, id];
    merge(patch, pv);
    send({ t: 'set', patch, pv });
    subs.forEach((fn) => fn(state, { remote: false }));
  }

  function prune() {
    const now = Date.now();
    for (const [p, t] of peers) if (now - t > timeout) peers.delete(p);
  }

  function runLeader(fn) {
    try {
      const c = fn();
      leaderFns.set(fn, typeof c === 'function' ? c : null);
    } catch (e) {
      console.error('[kovan] onLeader threw', e);
    }
  }

  function stopLeading() {
    for (const [fn, c] of leaderFns) {
      if (c) {
        try { c(); } catch (e) { console.error('[kovan] cleanup threw', e); }
      }
      leaderFns.set(fn, null);
    }
  }

  function elect() {
    if (!settled || closed) return;
    prune();
    const next = [id, ...peers.keys()].sort()[0];
    if (next === leader) return;
    const was = leader;
    leader = next;
    if (was === id) stopLeading();
    if (next === id) [...leaderFns.keys()].forEach(runLeader);
    fire('leader', { id: next, isLeader: next === id });
  }

  const run = (name, payload) => {
    const h = handlers.get(name);
    if (!h) return Promise.reject(new Error('no handler: ' + name));
    return Promise.resolve().then(() => h(payload));
  };

  async function handleReq(m) {
    const base = { t: 'res', to: m.from, rid: m.rid };
    if (leader !== id) return send({ ...base, ok: false, error: 'not-leader' });
    try {
      send({ ...base, ok: true, value: await run(m.name, m.payload) });
    } catch (e) {
      send({ ...base, ok: false, error: String((e && e.message) || e) });
    }
  }

  function remote(name, payload, ms) {
    return new Promise((resolve, reject) => {
      const key = id + ':' + ++n;
      const timer = setTimeout(() => {
        pending.delete(key);
        reject(Object.assign(new Error('timed out: ' + name), { code: 'timeout' }));
      }, ms);
      pending.set(key, { resolve, reject, timer });
      send({ t: 'req', to: leader, rid: key, name, payload });
    });
  }

  async function request(name, payload, { timeout: ms = requestTimeout } = {}) {
    await ready;
    for (let i = 0; ; i++) {
      if (leader === id) return run(name, payload);
      try {
        return await remote(name, payload, ms);
      } catch (e) {
        // leader may have just changed, try once more
        if (e.code !== 'not-leader' || i) throw e;
        await sleep(100);
      }
    }
  }

  ch.onmessage = (e) => {
    const m = e.data;
    if (!m || m.from === id || closed || (m.to && m.to !== id)) return;
    switch (m.t) {
      case 'hello': {
        peers.set(m.from, Date.now());
        const patch = {};
        for (const k of Object.keys(vers)) patch[k] = state[k];
        send({ t: 'hb' });
        send({ t: 'snap', to: m.from, patch, pv: vers });
        elect();
        break;
      }
      case 'hb':
        peers.set(m.from, Date.now());
        elect();
        break;
      case 'bye':
        peers.delete(m.from);
        elect();
        break;
      case 'snap':
      case 'set':
        if (merge(m.patch, m.pv)) subs.forEach((fn) => fn(state, { remote: true }));
        break;
      case 'evt':
        fire(m.ev, m.data);
        break;
      case 'req':
        handleReq(m);
        break;
      case 'res': {
        const p = pending.get(m.rid);
        if (!p) break;
        pending.delete(m.rid);
        clearTimeout(p.timer);
        if (m.ok) p.resolve(m.value);
        else p.reject(Object.assign(new Error(m.error), { code: m.error }));
        break;
      }
    }
  };

  let done;
  const ready = new Promise((r) => (done = r));
  const hb = setInterval(() => { send({ t: 'hb' }); elect(); }, heartbeat);
  if (hb.unref) hb.unref();
  setTimeout(() => { settled = true; elect(); done(); }, settle);
  send({ t: 'hello' });

  function close() {
    if (closed) return;
    send({ t: 'bye' });
    stopLeading();
    closed = true;
    clearInterval(hb);
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('closed'));
    }
    pending.clear();
    ch.close();
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', close);
  }

  return {
    id,
    ready,
    get state() { return state; },
    get isLeader() { return leader === id; },
    get leaderId() { return leader; },
    peers() { prune(); return [id, ...peers.keys()].sort(); },
    get: () => state,
    set,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    onLeader(fn) {
      leaderFns.set(fn, null);
      if (leader === id) runLeader(fn);
      return () => {
        const c = leaderFns.get(fn);
        leaderFns.delete(fn);
        if (c) c();
      };
    },
    handle(name, fn) { handlers.set(name, fn); return () => handlers.delete(name); },
    request,
    emit(ev, data, { self = true } = {}) {
      send({ t: 'evt', ev, data });
      if (self) fire(ev, data);
    },
    on(ev, fn) {
      if (!evs.has(ev)) evs.set(ev, new Set());
      evs.get(ev).add(fn);
      return () => evs.get(ev).delete(fn);
    },
    close,
  };
}

  return { createHive };
});
