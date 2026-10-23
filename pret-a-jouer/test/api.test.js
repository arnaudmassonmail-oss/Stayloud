import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { approximatePosition, distanceKm } from '../src/geo.js';

async function startServer() {
  const db = openDb(':memory:');
  const server = createServer(createApp(db, { publicDir: '.', fuzzSecret: 'test' }));
  await new Promise((r) => server.listen(0, r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

function client(base) {
  let cookie = '';
  return async (path, body, method = body ? 'POST' : 'GET') => {
    const res = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test('approximate position stays within 400 m and is stable', () => {
  const a = approximatePosition(7, 45.76, 4.83, 's');
  const b = approximatePosition(7, 45.76, 4.83, 's');
  assert.deepEqual(a, b);
  const d = distanceKm(45.76, 4.83, a.lat, a.lng);
  assert.ok(d > 0.1 && d < 0.42, `offset ${d} km`);
});

test('full loan cycle between two neighbours', async () => {
  const { server, base } = await startServer();
  try {
    const alice = client(base);
    const bob = client(base);

    let r = await alice('/api/register', { name: 'Alice', email: 'alice@example.org', password: 'motdepasse', lat: 45.76, lng: 4.83 });
    assert.equal(r.status, 200);
    r = await bob('/api/register', { name: 'Bob', email: 'bob@example.org', password: 'motdepasse', lat: 45.77, lng: 4.84 });
    assert.equal(r.status, 200);

    r = await alice('/api/toys', { title: 'Kapla', category: 'Construction', ageMin: 4, ageMax: 10, maxDays: 10 });
    assert.equal(r.status, 200);
    const toyId = r.data.toy.id;

    // Bob finds it nearby, Alice's exact address is not exposed.
    r = await bob('/api/toys?lat=45.77&lng=4.84&radius=5');
    assert.equal(r.data.toys.length, 1);
    const owner = r.data.toys[0].owner;
    assert.notDeepEqual(owner.position, { lat: 45.76, lng: 4.83 });
    assert.ok(r.data.toys[0].distanceKm < 2);
    assert.equal((await bob('/api/toys?lat=48.85&lng=2.35&radius=5')).data.toys.length, 0, 'not visible from Paris');
    assert.equal((await bob('/api/toys?lat=45.77&lng=4.84&radius=5&age=2')).data.toys.length, 0, 'age filter');

    // Too long, then a valid request.
    r = await bob('/api/loans', { toyId, startDate: plusDays(1), endDate: plusDays(20) });
    assert.equal(r.status, 400);
    r = await bob('/api/loans', { toyId, startDate: plusDays(1), endDate: plusDays(5), message: 'Bonjour !' });
    assert.equal(r.status, 200);
    const loanId = r.data.loan.id;

    assert.equal((await alice('/api/me')).data.user.pendingRequests, 1);
    assert.equal((await bob(`/api/loans/${loanId}/status`, { status: 'accepted' })).status, 400, 'borrower cannot accept');
    assert.equal((await alice(`/api/loans/${loanId}/status`, { status: 'accepted' })).status, 200);

    // Overlapping dates are now refused for someone else.
    const carol = client(base);
    await carol('/api/register', { name: 'Carol', email: 'carol@example.org', password: 'motdepasse', lat: 45.76, lng: 4.84 });
    assert.equal((await carol('/api/loans', { toyId, startDate: plusDays(3), endDate: plusDays(4) })).status, 409);

    assert.equal((await alice(`/api/loans/${loanId}/status`, { status: 'lent' })).status, 200);
    r = await bob(`/api/toys/${toyId}`);
    assert.equal(r.data.toy.availability.state, 'lent');
    assert.equal((await alice(`/api/toys/${toyId}`, undefined, 'DELETE')).status, 409, 'cannot delete a lent toy');

    assert.equal((await alice(`/api/loans/${loanId}/status`, { status: 'returned' })).status, 200);
    assert.equal((await bob(`/api/loans/${loanId}/review`, { rating: 5, comment: 'Super' })).status, 200);
    assert.equal((await bob(`/api/loans/${loanId}/review`, { rating: 4 })).status, 409);

    r = await bob(`/api/loans/${loanId}/messages`);
    assert.equal(r.data.messages[0].body, 'Bonjour !');

    r = await carol('/api/toys?lat=45.76&lng=4.84&radius=5');
    assert.equal(r.data.toys[0].owner.rating.avg, 5);
    assert.equal(r.data.toys[0].owner.rating.loansDone, 1);
  } finally {
    server.close();
  }
});

test('login errors and protected routes', async () => {
  const { server, base } = await startServer();
  try {
    const c = client(base);
    assert.equal((await c('/api/my/toys')).status, 401);
    await c('/api/register', { name: 'Dan', email: 'dan@example.org', password: 'motdepasse' });
    assert.equal((await c('/api/toys', { title: 'Ballon', category: 'Plein air' })).status, 400, 'needs a position first');
    const other = client(base);
    assert.equal((await other('/api/login', { email: 'dan@example.org', password: 'mauvais!!' })).status, 401);
    assert.equal((await other('/api/login', { email: 'dan@example.org', password: 'motdepasse' })).status, 200);
  } finally {
    server.close();
  }
});
