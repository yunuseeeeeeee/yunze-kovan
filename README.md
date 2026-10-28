# Yunze Kovan

A small library that makes the open tabs of a site behave like one app. No dependencies.

If a user opens your site in 5 tabs you get 5 websockets, 5 polling loops and 5 separate copies of the state. Kovan elects a leader among the tabs, lets only that tab do the heavy work, and keeps the state the same in all of them.

```js
import { createHive } from 'yunze-kovan';

const hive = createHive('app', { initial: { unread: 0 } });

// runs only in the leader tab, and starts in another tab if the leader closes
hive.onLeader(() => {
  const ws = new WebSocket('wss://example.com/ws');
  ws.onmessage = () => hive.set((s) => ({ unread: s.unread + 1 }));
  return () => ws.close(); // called when leadership ends
});

// up to date in every tab
hive.subscribe((state) => render(state));

// call the leader from any tab
hive.handle('refresh-token', () => api.refresh());
const token = await hive.request('refresh-token');
```

Works with a plain script tag too: include `kovan.umd.js` and use `Kovan.createHive(...)`.

## API

- `createHive(name, opts)`: tabs with the same `name` join the same group
- `hive.onLeader(fn)`: `fn` runs when this tab becomes leader. If it returns a function, that is called when leadership ends
- `hive.get()`, `hive.set(patch)`, `hive.set(fn)`: shared state. If two tabs write at the same time the last write wins per key. Setting a key to `undefined` deletes it
- `hive.subscribe(fn)`: `fn(state, { remote })` is called on every change
- `hive.handle(name, fn)` and `hive.request(name, payload)`: promise-based requests to the leader
- `hive.emit(event, data)` and `hive.on(event, fn)`: events to all tabs. `hive.on('leader', fn)` fires when the leader changes
- `hive.isLeader`, `hive.leaderId`, `hive.peers()`, `hive.ready`
- `hive.close()`: leave the group. This already happens when the tab closes

Options: `initial`, `heartbeat` (1000 ms), `timeout` (heartbeat x 3.5), `settle` (250 ms, how long a new tab listens for others before the first election), `requestTimeout` (5000 ms).

## How it works

Tabs talk over `BroadcastChannel`. The leader is the oldest tab. Every tab sends a heartbeat now and then. A tab that closes says `bye` and the leader changes right away, a tab that crashes is dropped after `timeout`. Each state key has a counter and the higher one wins on conflicts. A new tab asks the others for the current state when it opens.

## Good to know

- Only tabs of the same origin see each other
- State goes through structured clone, so no functions in it
- If the leader crashes it takes about 3.5 s to hand over, and requests sent in that window may time out
- Without `BroadcastChannel` every tab thinks it is the leader

## Development

`npm run build` and `npm test` (Node 18+). Open `demo.html` in a few tabs to try it.
