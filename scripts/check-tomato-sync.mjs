import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../deploy/tomatoes-script.js', import.meta.url), 'utf8');
const record = id => ({ id, date: '2026-09-22', no: Number(id) || 1, tomatoWeight: 1, completionPercent: 100 });
const state = ids => ({ settings: {}, records: ids.map(record), recentTasks: [], longTermGoals: [], clipboardHistory: [], activePomodoro: null });
function app(local, options = {}) {
  const storage = new Map([['xianTomatoBaseStateV2', JSON.stringify(local)], ['xianTomatoBaseV2Initialized', '1']]);
  if (options.meta) storage.set('xianTomatoBaseSyncV1', JSON.stringify(options.meta));
  const timers = new Map(); let timerId = 0;
  const redirects = [], labels = { currentUserLabel: {}, syncNowBtn: {} };
  const context = vm.createContext({
    console, URL, Date, setTimeout,
    document: { getElementById: id => labels[id] || null },
    localStorage: {
      getItem: k => storage.get(k) ?? null,
      setItem: (k, v) => { if (options.failBackup && k === 'xianTomatoBaseBeforeSyncV1') throw Error('QuotaExceeded'); storage.set(k, v); }
    },
    window: { location: { protocol: 'https:', pathname: '/', search: '', assign: url => redirects.push(url) },
      setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) },
    fetch: (...args) => options.fetch(...args)
  });
  const expose = `
    reconcileActiveTimer = hydrateActiveForm = applyTheme = renderAll = showToast = () => {};
    globalThis.api = { hydrateRemoteState, saveRemoteState, syncNow, mergeThreeWay,
      get state() { return appState; }, set state(s) { appState = normalizeState(s); },
      get ready() { return remoteStateReady; }, get baseline() { return lastSyncedState; } };
  `;
  vm.runInContext(source.replace('  init();', expose), context);
  return { api: context.api, storage, redirects, labels };
}
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const auth = name => response({ user: name ? { username: name } : null });
const ids = a => Array.from(a.records, r => r.id).sort();

test('reproduction: reconnect merges 13 local records with 3 cloud records and uploads all 13', async () => {
  const all = Array.from({ length: 13 }, (_, i) => String(i + 1)); let uploaded;
  const a = app(state(all), { fetch: async (url, init) => url.includes('/auth/') ? auth('Xian') : init.method === 'PUT' ? (uploaded = JSON.parse(init.body).state, response({ ok: true })) : response({ state: state(all.slice(0, 3)) }) });
  await a.api.syncNow();
  assert.deepEqual(ids(a.api.state), [...all].sort());
  assert.deepEqual(ids(uploaded), [...all].sort());
  assert.equal(JSON.parse(a.storage.get('xianTomatoBaseBeforeSyncV1')).state.records.length, 13);
  assert.equal(JSON.parse(a.storage.get('xianTomatoBaseSyncV1')).state.records.length, 13);
});

test('expired login saves current local state before redirect and never uploads', async () => {
  const a = app(state(['1']), { fetch: async () => auth(null) });
  a.api.state = state(['1', '2']);
  await a.api.syncNow();
  assert.equal(a.api.ready, false);
  assert.equal(a.redirects.length, 1);
  assert.deepEqual(ids(JSON.parse(a.storage.get('xianTomatoBaseStateV2'))), ['1', '2']);
});

test('persisted baseline preserves offline additions and deliberate deletion across reload', async () => {
  const a = app(state(['1', '3']), { meta: { username: 'Xian', state: state(['1', '2']) }, fetch: async url => url.includes('/auth/') ? auth('Xian') : response({ state: state(['1', '2', '4']) }) });
  await a.api.hydrateRemoteState();
  assert.deepEqual(ids(a.api.state), ['1', '3', '4']);
});

test('cloud deletion stays deleted when local has no edits', async () => {
  const a = app(state(['1', '2']), { meta: { username: 'Xian', state: state(['1', '2']) }, fetch: async url => url.includes('/auth/') ? auth('Xian') : response({ state: state(['1']) }) });
  await a.api.hydrateRemoteState();
  assert.deepEqual(ids(a.api.state), ['1']);
});

test('account switch backs up old local state and never copies it to another user', async () => {
  let uploaded;
  const a = app(state(['private']), { meta: { username: 'Xian', state: state([]) }, fetch: async (url, init) => url.includes('/auth/') ? auth('Other') : init.method === 'PUT' ? (uploaded = JSON.parse(init.body).state, response({ ok: true })) : response({ state: state(['other']) }) });
  await a.api.syncNow();
  assert.deepEqual(ids(uploaded), ['other']);
  assert.deepEqual(ids(JSON.parse(a.storage.get('xianTomatoBaseBeforeSyncV1')).state), ['private']);
});

test('backup failure aborts hydration without changing local records', async () => {
  const a = app(state(['1', '2']), { failBackup: true, fetch: async url => url.includes('/auth/') ? auth('Xian') : response({ state: state(['1']) }) });
  await a.api.hydrateRemoteState();
  assert.equal(a.api.ready, false);
  assert.deepEqual(ids(a.api.state), ['1', '2']);
  assert.deepEqual(ids(JSON.parse(a.storage.get('xianTomatoBaseStateV2'))), ['1', '2']);
});

test('edits made during cloud GET survive and concurrent sync shares one GET', async () => {
  let resolve, gets = 0;
  const a = app(state(['1']), { fetch: async url => url.includes('/auth/') ? auth('Xian') : (gets++, await new Promise(r => resolve = r)) });
  const first = a.api.hydrateRemoteState(), second = a.api.hydrateRemoteState();
  while (!resolve) await new Promise(r => setImmediate(r));
  a.api.state = state(['1', '2']); resolve(response({ state: state(['1', '3']) }));
  await Promise.all([first, second]);
  assert.equal(gets, 1);
  assert.deepEqual(ids(a.api.state), ['1', '2', '3']);
});

test('edits during PUT are sent in a subsequent save; baseline only includes acknowledged state', async () => {
  let resolve; const uploads = [];
  const a = app(state(['1']), { fetch: async (url, init) => {
    if (url.includes('/auth/')) return auth('Xian');
    if (init.method !== 'PUT') return response({ state: state(['1']) });
    uploads.push(JSON.parse(init.body).state);
    return uploads.length === 1 ? new Promise(r => resolve = r) : response({ ok: true });
  } });
  await a.api.hydrateRemoteState();
  const save = a.api.saveRemoteState();
  while (!resolve) await new Promise(r => setImmediate(r));
  a.api.state = state(['1', '2']); resolve(response({ ok: true })); await save;
  assert.equal(uploads.length, 2);
  assert.deepEqual(ids(uploads[1]), ['1', '2']);
  assert.deepEqual(ids(a.api.baseline), ['1', '2']);
});

test('manual sync pulls changes from another device before uploading local edits', async () => {
  let remote = state(['1']); let uploaded;
  const a = app(state(['1']), { fetch: async (url, init) => url.includes('/auth/') ? auth('Xian') : init.method === 'PUT' ? (uploaded = JSON.parse(init.body).state, response({ ok: true })) : response({ state: remote }) });
  await a.api.hydrateRemoteState();
  a.api.state = state(['1', '2']); remote = state(['1', '3']);
  await a.api.syncNow();
  assert.deepEqual(ids(uploaded), ['1', '2', '3']);
});

test('network failure preserves records and allows a later retry', async () => {
  let online = false;
  const a = app(state(['1', '2']), { fetch: async url => {
    if (!online) throw Error('offline');
    return url.includes('/auth/') ? auth('Xian') : response({ state: state(['1']) });
  } });
  await a.api.hydrateRemoteState();
  assert.equal(a.api.ready, false);
  assert.deepEqual(ids(a.api.state), ['1', '2']);
  online = true; await a.api.hydrateRemoteState();
  assert.equal(a.api.ready, true);
  assert.deepEqual(ids(a.api.state), ['1', '2']);
});

test('409 merges edits made while upload was in flight, not just the earlier snapshot', async () => {
  let resolve; let puts = 0; let uploaded;
  const a = app(state(['1']), { fetch: async (url, init) => {
    if (url.includes('/auth/')) return auth('Xian');
    if (init.method !== 'PUT') return response({ state: state(['1']), revision: 1 });
    puts++; uploaded = JSON.parse(init.body).state;
    return puts === 1 ? new Promise(r => resolve = r) : response({ ok: true, revision: 3 });
  } });
  await a.api.hydrateRemoteState();
  const save = a.api.saveRemoteState();
  while (!resolve) await new Promise(r => setImmediate(r));
  a.api.state = state(['1', '2']); resolve(response({ state: state(['1', '3']), revision: 2 }, 409));
  assert.equal(await save, true);
  assert.deepEqual(ids(uploaded), ['1', '2', '3']);
});

test('first upload preserves local preferences for a known matching account', async () => {
  const local = state(['1']); local.settings.todayTargetTomatoes = 12;
  const a = app(local, { meta: { username: 'Xian', state: state([]) }, fetch: async url => url.includes('/auth/') ? auth('Xian') : response({ state: null }) });
  await a.api.hydrateRemoteState();
  assert.equal(a.api.state.settings.todayTargetTomatoes, 12);
  assert.deepEqual(ids(a.api.state), ['1']);
});

test('exhausted conflict retries report failure and keep unsent local records', async () => {
  let revision = 1;
  const a = app(state(['1', '2']), { fetch: async (url, init) => url.includes('/auth/') ? auth('Xian') : response({ state: state(['1']), revision: revision++ }, init.method === 'PUT' ? 409 : 200) });
  await a.api.hydrateRemoteState();
  assert.equal(await a.api.saveRemoteState(), false);
  assert.deepEqual(ids(a.api.state), ['1', '2']);
});


test('unknown legacy data stays in a backup rather than entering a new account', async () => {
  const a = app(state(['private']), { fetch: async url => url.includes('/auth/') ? auth('NewUser') : response({ state: null, revision: 0 }) });
  await a.api.hydrateRemoteState();
  assert.deepEqual(ids(a.api.state), []);
  assert.deepEqual(ids(JSON.parse(a.storage.get('xianTomatoBaseBeforeSyncV1')).state), ['private']);
});
