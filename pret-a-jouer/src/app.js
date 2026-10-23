import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { approximatePosition, boundingBox, distanceKm, validCoords } from './geo.js';

export const CATEGORIES = [
  'Jeux de société', 'Construction', 'Éveil bébé', 'Plein air', 'Véhicules',
  'Poupées & figurines', 'Déguisements', 'Puzzles', 'Musique', 'Livres', 'Autre',
];
export const CONDITIONS = ['comme neuf', 'très bon', 'bon', 'usé'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
const MAX_BODY = 2_000_000;
const MAX_PHOTO = 1_400_000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

export function createApp(db, { publicDir, fuzzSecret }) {
  const secret = fuzzSecret || loadSecret(db);

  // ---------- helpers ----------
  const hashPassword = (password, salt) => scryptSync(password, salt, 64).toString('hex');

  function currentUser(req) {
    const token = parseCookies(req.headers.cookie).paj_session;
    if (!token) return null;
    return db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token) || null;
  }
  const requireUser = (req) => currentUser(req) || fail(401, 'Connectez-vous pour continuer.');

  function newSession(res, userId) {
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
    res.setHeader('Set-Cookie', `paj_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 60}`);
  }

  function ratingOf(userId) {
    const r = db.prepare('SELECT AVG(rating) AS avg, COUNT(*) AS n FROM reviews WHERE target_id = ?').get(userId);
    const lent = db.prepare(`SELECT COUNT(*) AS n FROM loans WHERE owner_id = ? AND status = 'returned'`).get(userId).n;
    return { avg: r.avg ? Math.round(r.avg * 10) / 10 : null, count: r.n, loansDone: lent };
  }

  function publicUser(u, viewer) {
    const isMe = viewer && viewer.id === u.id;
    const pos = u.lat == null ? null
      : isMe ? { lat: u.lat, lng: u.lng } : approximatePosition(u.id, u.lat, u.lng, secret);
    return { id: u.id, name: u.name, city: u.city, bio: u.bio, position: pos, rating: ratingOf(u.id), isMe: !!isMe };
  }

  function toyAvailability(toyId) {
    const today = isoToday();
    const current = db.prepare(`SELECT end_date FROM loans WHERE toy_id = ? AND status = 'lent' ORDER BY end_date DESC LIMIT 1`).get(toyId);
    if (current) return { state: 'lent', until: current.end_date };
    const booked = db.prepare(`SELECT start_date, end_date FROM loans WHERE toy_id = ? AND status = 'accepted' AND end_date >= ? ORDER BY start_date`).all(toyId, today);
    return { state: 'available', booked };
  }

  function serializeToy(t, owner, viewer, origin) {
    const ownerPublic = publicUser(owner, viewer);
    let distance = null;
    if (origin && ownerPublic.position) {
      distance = Math.round(distanceKm(origin.lat, origin.lng, ownerPublic.position.lat, ownerPublic.position.lng) * 10) / 10;
    }
    return {
      id: t.id, title: t.title, description: t.description, category: t.category,
      ageMin: t.age_min, ageMax: t.age_max, condition: t.condition, deposit: t.deposit,
      maxDays: t.max_days, photo: t.photo, active: !!t.active, createdAt: t.created_at,
      availability: toyAvailability(t.id), owner: ownerPublic, distanceKm: distance,
    };
  }

  function readToyInput(body, existing = {}) {
    const title = str(body.title ?? existing.title, 80);
    if (!title) fail(400, 'Donnez un nom au jouet.');
    const category = body.category ?? existing.category;
    if (!CATEGORIES.includes(category)) fail(400, 'Choisissez une catégorie.');
    const condition = body.condition ?? existing.condition ?? 'bon';
    if (!CONDITIONS.includes(condition)) fail(400, 'État du jouet inconnu.');
    const ageMin = int(body.ageMin ?? existing.age_min, 0, 18, 0);
    const ageMax = int(body.ageMax ?? existing.age_max, 0, 18, 12);
    if (ageMax < ageMin) fail(400, "L'âge maximum doit être supérieur ou égal à l'âge minimum.");
    let photo = body.photo !== undefined ? body.photo : existing.photo ?? null;
    if (photo) {
      if (typeof photo !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(photo)) fail(400, 'Photo invalide (JPEG, PNG ou WebP).');
      if (photo.length > MAX_PHOTO) fail(400, 'Photo trop lourde (1 Mo maximum).');
    }
    return {
      title, category, condition, ageMin, ageMax, photo: photo || null,
      description: str(body.description ?? existing.description ?? '', 1000),
      deposit: int(body.deposit ?? existing.deposit, 0, 500, 0),
      maxDays: int(body.maxDays ?? existing.max_days, 1, 90, 14),
      active: body.active === undefined ? (existing.active ?? 1) : (body.active ? 1 : 0),
    };
  }

  function loanView(l, viewer) {
    const toy = db.prepare('SELECT id, title, photo, category FROM toys WHERE id = ?').get(l.toy_id);
    const other = db.prepare('SELECT * FROM users WHERE id = ?').get(viewer.id === l.owner_id ? l.borrower_id : l.owner_id);
    const myReview = db.prepare('SELECT rating, comment FROM reviews WHERE loan_id = ? AND author_id = ?').get(l.id, viewer.id);
    const unread = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE loan_id = ? AND sender_id != ?').get(l.id, viewer.id).n;
    return {
      id: l.id, status: l.status, startDate: l.start_date, endDate: l.end_date,
      createdAt: l.created_at, updatedAt: l.updated_at,
      role: viewer.id === l.owner_id ? 'owner' : 'borrower',
      toy, other: publicUser(other, viewer), myReview: myReview || null, messageCount: unread,
    };
  }

  function getLoanFor(viewer, id) {
    const l = db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
    if (!l || (l.owner_id !== viewer.id && l.borrower_id !== viewer.id)) fail(404, 'Demande introuvable.');
    return l;
  }

  // ---------- routes ----------
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler });
  };

  route('GET', '/api/meta', () => ({ categories: CATEGORIES, conditions: CONDITIONS }));

  route('POST', '/api/register', ({ body, res }) => {
    const name = str(body.name, 40);
    const email = str(body.email, 120).toLowerCase();
    const password = String(body.password || '');
    if (!name) fail(400, 'Indiquez votre prénom.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Adresse e-mail invalide.');
    if (password.length < 8) fail(400, 'Le mot de passe doit faire au moins 8 caractères.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'Un compte existe déjà avec cette adresse.');
    const lat = num(body.lat), lng = num(body.lng);
    const hasPos = validCoords(lat, lng);
    const salt = randomBytes(16).toString('hex');
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO users (name, email, pass_hash, salt, lat, lng, city) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(name, email, hashPassword(password, salt), salt, hasPos ? lat : null, hasPos ? lng : null, str(body.city ?? '', 80));
    newSession(res, Number(lastInsertRowid));
    return { user: me(Number(lastInsertRowid)) };
  });

  route('POST', '/api/login', ({ body, res }) => {
    const email = str(body.email, 120).toLowerCase();
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = u && timingSafeEqual(Buffer.from(hashPassword(String(body.password || ''), u.salt), 'hex'), Buffer.from(u.pass_hash, 'hex'));
    if (!ok) fail(401, 'E-mail ou mot de passe incorrect.');
    newSession(res, u.id);
    return { user: me(u.id) };
  });

  route('POST', '/api/logout', ({ req, res }) => {
    const token = parseCookies(req.headers.cookie).paj_session;
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.setHeader('Set-Cookie', 'paj_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return { ok: true };
  });

  function me(id) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    const pending = db.prepare(`SELECT COUNT(*) AS n FROM loans WHERE owner_id = ? AND status = 'pending'`).get(id).n;
    return { ...publicUser(u, u), email: u.email, pendingRequests: pending };
  }

  route('GET', '/api/me', ({ req }) => {
    const u = currentUser(req);
    return { user: u ? me(u.id) : null };
  });

  route('PUT', '/api/me', ({ req, body }) => {
    const u = requireUser(req);
    const name = body.name !== undefined ? str(body.name, 40) : u.name;
    if (!name) fail(400, 'Indiquez votre prénom.');
    let { lat, lng } = u;
    if (body.lat !== undefined || body.lng !== undefined) {
      lat = num(body.lat); lng = num(body.lng);
      if (!validCoords(lat, lng)) fail(400, 'Position invalide.');
    }
    db.prepare('UPDATE users SET name = ?, bio = ?, city = ?, lat = ?, lng = ? WHERE id = ?').run(
      name, str(body.bio ?? u.bio ?? '', 300), str(body.city ?? u.city ?? '', 80), lat, lng, u.id);
    return { user: me(u.id) };
  });

  // Toys around a point. Coordinates come from the browser's geolocation,
  // the user's saved position, or a searched address.
  route('GET', '/api/toys', ({ req, query }) => {
    const viewer = currentUser(req);
    let lat = num(query.lat), lng = num(query.lng);
    if (!validCoords(lat, lng) && viewer?.lat != null) ({ lat, lng } = viewer);
    const origin = validCoords(lat, lng) ? { lat, lng } : null;
    const radius = Math.min(Math.max(num(query.radius) || 10, 0.5), 100);

    let sql = `SELECT t.*, u.id AS u_id FROM toys t JOIN users u ON u.id = t.owner_id WHERE t.active = 1 AND u.lat IS NOT NULL`;
    const params = [];
    if (origin) {
      // Pad the box by the maximum position fuzz so edge lenders are not lost.
      const box = boundingBox(origin.lat, origin.lng, radius + 0.5);
      sql += ' AND u.lat BETWEEN ? AND ? AND u.lng BETWEEN ? AND ?';
      params.push(box.minLat, box.maxLat, box.minLng, box.maxLng);
    }
    if (query.category && CATEGORIES.includes(query.category)) { sql += ' AND t.category = ?'; params.push(query.category); }
    const age = num(query.age);
    if (Number.isFinite(age)) { sql += ' AND t.age_min <= ? AND t.age_max >= ?'; params.push(age, age); }
    const q = str(query.q ?? '', 60);
    if (q) { sql += ' AND (t.title LIKE ? OR t.description LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    sql += ' ORDER BY t.created_at DESC LIMIT 500';

    const owners = new Map();
    const toys = db.prepare(sql).all(...params).map((t) => {
      if (!owners.has(t.owner_id)) owners.set(t.owner_id, db.prepare('SELECT * FROM users WHERE id = ?').get(t.owner_id));
      return serializeToy(t, owners.get(t.owner_id), viewer, origin);
    }).filter((t) => !origin || t.distanceKm <= radius);
    if (query.availableOnly === '1') toys.splice(0, toys.length, ...toys.filter((t) => t.availability.state === 'available'));
    if (origin) toys.sort((a, b) => a.distanceKm - b.distanceKm);
    return { origin, radius, toys };
  });

  route('GET', '/api/toys/:id', ({ req, params, query }) => {
    const viewer = currentUser(req);
    const t = db.prepare('SELECT * FROM toys WHERE id = ?').get(params.id);
    if (!t || (!t.active && t.owner_id !== viewer?.id)) fail(404, 'Jouet introuvable.');
    const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(t.owner_id);
    const lat = num(query.lat), lng = num(query.lng);
    const origin = validCoords(lat, lng) ? { lat, lng } : viewer?.lat != null ? { lat: viewer.lat, lng: viewer.lng } : null;
    const reviews = db.prepare(`SELECT r.rating, r.comment, r.created_at, a.name AS author FROM reviews r JOIN users a ON a.id = r.author_id WHERE r.target_id = ? ORDER BY r.created_at DESC LIMIT 5`).all(owner.id);
    return { toy: serializeToy(t, owner, viewer, origin), reviews };
  });

  route('GET', '/api/my/toys', ({ req }) => {
    const u = requireUser(req);
    const toys = db.prepare('SELECT * FROM toys WHERE owner_id = ? ORDER BY created_at DESC').all(u.id);
    return { toys: toys.map((t) => serializeToy(t, u, u, null)) };
  });

  route('POST', '/api/toys', ({ req, body }) => {
    const u = requireUser(req);
    if (u.lat == null) fail(400, 'Indiquez d’abord votre position dans votre profil pour que les voisins vous trouvent.');
    const t = readToyInput(body);
    const { lastInsertRowid } = db.prepare(
      `INSERT INTO toys (owner_id, title, description, category, age_min, age_max, condition, deposit, max_days, photo, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(u.id, t.title, t.description, t.category, t.ageMin, t.ageMax, t.condition, t.deposit, t.maxDays, t.photo, t.active);
    const row = db.prepare('SELECT * FROM toys WHERE id = ?').get(lastInsertRowid);
    return { toy: serializeToy(row, u, u, null) };
  });

  route('PUT', '/api/toys/:id', ({ req, body, params }) => {
    const u = requireUser(req);
    const existing = db.prepare('SELECT * FROM toys WHERE id = ? AND owner_id = ?').get(params.id, u.id) || fail(404, 'Jouet introuvable.');
    const t = readToyInput(body, existing);
    db.prepare(`UPDATE toys SET title=?, description=?, category=?, age_min=?, age_max=?, condition=?, deposit=?, max_days=?, photo=?, active=? WHERE id=?`)
      .run(t.title, t.description, t.category, t.ageMin, t.ageMax, t.condition, t.deposit, t.maxDays, t.photo, t.active, existing.id);
    return { toy: serializeToy(db.prepare('SELECT * FROM toys WHERE id = ?').get(existing.id), u, u, null) };
  });

  route('DELETE', '/api/toys/:id', ({ req, params }) => {
    const u = requireUser(req);
    const t = db.prepare('SELECT * FROM toys WHERE id = ? AND owner_id = ?').get(params.id, u.id) || fail(404, 'Jouet introuvable.');
    const out = db.prepare(`SELECT 1 FROM loans WHERE toy_id = ? AND status IN ('accepted', 'lent')`).get(t.id);
    if (out) fail(409, 'Ce jouet est prêté ou réservé : clôturez le prêt avant de le supprimer.');
    db.prepare('DELETE FROM toys WHERE id = ?').run(t.id);
    return { ok: true };
  });

  route('GET', '/api/loans', ({ req }) => {
    const u = requireUser(req);
    const rows = db.prepare('SELECT * FROM loans WHERE owner_id = ? OR borrower_id = ? ORDER BY updated_at DESC').all(u.id, u.id);
    return { loans: rows.map((l) => loanView(l, u)) };
  });

  route('POST', '/api/loans', ({ req, body }) => {
    const u = requireUser(req);
    const toy = db.prepare('SELECT * FROM toys WHERE id = ? AND active = 1').get(num(body.toyId)) || fail(404, 'Jouet introuvable.');
    if (toy.owner_id === u.id) fail(400, 'Vous ne pouvez pas emprunter votre propre jouet.');
    const start = isoDate(body.startDate), end = isoDate(body.endDate);
    if (!start || !end) fail(400, 'Choisissez les dates du prêt.');
    if (start < isoToday()) fail(400, 'La date de début est déjà passée.');
    if (end < start) fail(400, 'La date de retour doit suivre la date de début.');
    const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    if (days > toy.max_days) fail(400, `Ce jouet se prête ${toy.max_days} jours maximum.`);
    const clash = db.prepare(`SELECT 1 FROM loans WHERE toy_id = ? AND status IN ('accepted','lent') AND start_date <= ? AND end_date >= ?`).get(toy.id, end, start);
    if (clash) fail(409, 'Le jouet est déjà réservé sur une partie de ces dates.');
    const dup = db.prepare(`SELECT 1 FROM loans WHERE toy_id = ? AND borrower_id = ? AND status = 'pending'`).get(toy.id, u.id);
    if (dup) fail(409, 'Vous avez déjà une demande en attente pour ce jouet.');
    const { lastInsertRowid } = db.prepare('INSERT INTO loans (toy_id, borrower_id, owner_id, start_date, end_date) VALUES (?, ?, ?, ?, ?)')
      .run(toy.id, u.id, toy.owner_id, start, end);
    const message = str(body.message ?? '', 1000);
    if (message) db.prepare('INSERT INTO messages (loan_id, sender_id, body) VALUES (?, ?, ?)').run(lastInsertRowid, u.id, message);
    return { loan: loanView(db.prepare('SELECT * FROM loans WHERE id = ?').get(lastInsertRowid), u) };
  });

  // Allowed moves of a loan, by who may make them.
  const TRANSITIONS = {
    owner: { pending: ['accepted', 'refused'], accepted: ['lent', 'cancelled'], lent: ['returned'] },
    borrower: { pending: ['cancelled'], accepted: ['cancelled'] },
  };

  route('POST', '/api/loans/:id/status', ({ req, body, params }) => {
    const u = requireUser(req);
    const l = getLoanFor(u, params.id);
    const role = l.owner_id === u.id ? 'owner' : 'borrower';
    const next = String(body.status || '');
    if (!(TRANSITIONS[role][l.status] || []).includes(next)) fail(400, 'Cette action n’est pas possible à ce stade du prêt.');
    if (next === 'accepted') {
      const clash = db.prepare(`SELECT 1 FROM loans WHERE toy_id = ? AND id != ? AND status IN ('accepted','lent') AND start_date <= ? AND end_date >= ?`)
        .get(l.toy_id, l.id, l.end_date, l.start_date);
      if (clash) fail(409, 'Vous avez déjà accepté un prêt de ce jouet sur ces dates.');
    }
    if (next === 'lent') {
      const out = db.prepare(`SELECT 1 FROM loans WHERE toy_id = ? AND id != ? AND status = 'lent'`).get(l.toy_id, l.id);
      if (out) fail(409, 'Le jouet est encore chez un autre emprunteur.');
    }
    db.prepare(`UPDATE loans SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(next, l.id);
    return { loan: loanView(db.prepare('SELECT * FROM loans WHERE id = ?').get(l.id), u) };
  });

  route('GET', '/api/loans/:id/messages', ({ req, params }) => {
    const u = requireUser(req);
    const l = getLoanFor(u, params.id);
    const messages = db.prepare('SELECT id, sender_id, body, created_at FROM messages WHERE loan_id = ? ORDER BY id').all(l.id)
      .map((m) => ({ id: m.id, mine: m.sender_id === u.id, body: m.body, createdAt: m.created_at }));
    return { messages };
  });

  route('POST', '/api/loans/:id/messages', ({ req, body, params }) => {
    const u = requireUser(req);
    const l = getLoanFor(u, params.id);
    const text = str(body.body, 1000);
    if (!text) fail(400, 'Le message est vide.');
    db.prepare('INSERT INTO messages (loan_id, sender_id, body) VALUES (?, ?, ?)').run(l.id, u.id, text);
    db.prepare(`UPDATE loans SET updated_at = datetime('now') WHERE id = ?`).run(l.id);
    return { ok: true };
  });

  route('POST', '/api/loans/:id/review', ({ req, body, params }) => {
    const u = requireUser(req);
    const l = getLoanFor(u, params.id);
    if (l.status !== 'returned') fail(400, 'Vous pourrez laisser un avis une fois le jouet rendu.');
    const rating = int(body.rating, 1, 5, 0);
    if (!rating) fail(400, 'Choisissez une note de 1 à 5.');
    const target = l.owner_id === u.id ? l.borrower_id : l.owner_id;
    try {
      db.prepare('INSERT INTO reviews (loan_id, author_id, target_id, rating, comment) VALUES (?, ?, ?, ?, ?)')
        .run(l.id, u.id, target, rating, str(body.comment ?? '', 500));
    } catch {
      fail(409, 'Vous avez déjà laissé un avis pour ce prêt.');
    }
    return { loan: loanView(l, u) };
  });

  // Address search, proxied so the OpenStreetMap usage policy (identified
  // User-Agent) is respected and results are limited to what the app needs.
  route('GET', '/api/geocode', async ({ query }) => {
    const q = str(query.q ?? '', 120);
    if (q.length < 3) return { results: [] };
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=fr&q=${encodeURIComponent(q)}`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'PretAJouer/1.0 (pret de jouets entre particuliers)' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      return { results: data.map((d) => ({ label: d.display_name, lat: Number(d.lat), lng: Number(d.lon) })) };
    } catch {
      fail(502, 'La recherche d’adresse ne répond pas. Réessayez ou placez-vous sur la carte.');
    }
  });

  // ---------- server ----------
  async function serveStatic(req, res, pathname) {
    const rel = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname)).replace(/^([/\\])+/, '');
    if (rel.startsWith('..')) return send(res, 404, 'Not found', 'text/plain');
    try {
      const data = await readFile(join(publicDir, rel));
      res.writeHead(200, { 'Content-Type': MIME[extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch {
      const index = await readFile(join(publicDir, 'index.html'));
      send(res, 200, index, MIME['.html']);
    }
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
      return serveStatic(req, res, url.pathname);
    }
    try {
      const match = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
      if (!match) fail(404, 'Route inconnue.');
      const m = url.pathname.match(match.re);
      const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const body = ['POST', 'PUT'].includes(req.method) ? await readJson(req) : {};
      const result = await match.handler({ req, res, body, params, query: Object.fromEntries(url.searchParams) });
      send(res, 200, JSON.stringify(result), 'application/json');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      send(res, status, JSON.stringify({ error: status === 500 ? 'Erreur du serveur.' : err.message }), 'application/json');
    }
  };
}

// ---------- small utilities ----------
function loadSecret(db) {
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'fuzz_secret'`).get();
  if (row) return row.value;
  const value = randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO settings (key, value) VALUES ('fuzz_secret', ?)`).run(value);
  return value;
}

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Envoi trop volumineux.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'JSON invalide.')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));
}

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const num = (v) => (v === undefined || v === null || v === '' ? NaN : Number(v));
function int(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}
const isoToday = () => new Date().toISOString().slice(0, 10);
function isoDate(v) {
  const s = String(v || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
}
