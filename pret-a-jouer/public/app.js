/* global L */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DEFAULT_POS = { lat: 48.8566, lng: 2.3522, label: 'centre de Paris par défaut' };
const BLOCK_COLORS = ['#e4572e', '#f2b705', '#2f6fed', '#2e9e6b', '#8e5bd6'];
const STATUS_LABEL = {
  pending: 'En attente', accepted: 'Acceptée', refused: 'Refusée', cancelled: 'Annulée', lent: 'Prêté', returned: 'Rendu',
};

const state = {
  me: null,
  meta: { categories: [], conditions: [] },
  origin: { ...DEFAULT_POS },
  toys: [],
  activeLender: null,
};

// ---------- API ----------
async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Une erreur est survenue.');
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 3200);
}

const fmtDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const fmtKm = (km) => (km == null ? '' : km < 1 ? `${Math.round(km * 1000 / 50) * 50} m` : `${km.toFixed(1).replace('.', ',')} km`);
const ageLabel = (t) => (t.ageMin === t.ageMax ? `${t.ageMin} ans` : `${t.ageMin}–${t.ageMax} ans`);
const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

function thumb(toy) {
  if (toy.photo) return `<div class="thumb"><img src="${esc(toy.photo)}" alt="" loading="lazy"></div>`;
  const letter = (toy.title || '?').trim().charAt(0).toUpperCase();
  const color = BLOCK_COLORS[(toy.id || 0) % BLOCK_COLORS.length];
  const text = color === '#f2b705' ? '#1f2a44' : '#fff';
  return `<div class="thumb"><div class="block"><span style="background:${color};color:${text}">${esc(letter)}</span></div></div>`;
}

function availabilityChip(toy) {
  if (!toy.active) return '<span class="chip off">Masqué</span>';
  if (toy.availability.state === 'lent') return `<span class="chip busy">Prêté jusqu'au ${fmtDate(toy.availability.until)}</span>`;
  return '<span class="chip ok">Disponible</span>';
}

function ratingText(r) {
  if (!r) return '';
  const parts = [];
  if (r.avg) parts.push(`★ ${String(r.avg).replace('.', ',')} (${r.count})`);
  if (r.loansDone) parts.push(`${r.loansDone} prêt${r.loansDone > 1 ? 's' : ''}`);
  return parts.join(' · ') || 'Nouveau membre';
}

// ---------- routing ----------
const VIEWS = ['explorer', 'mes-jouets', 'prets', 'profil'];
function currentView() {
  const v = location.hash.slice(1);
  return VIEWS.includes(v) ? v : 'explorer';
}
function showView() {
  const view = currentView();
  if (view !== 'explorer' && !state.me) {
    openAuth('login', 'Connectez-vous pour gérer vos jouets et vos prêts.');
    history.replaceState(null, '', '#explorer');
    return showView();
  }
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  document.querySelectorAll('.tabs a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.view === view));
  document.querySelectorAll('.tabs a[aria-current]').forEach((a) => a.setAttribute('aria-current', 'page'));
  if (view === 'explorer') { map.invalidateSize(); }
  if (view === 'mes-jouets') loadMyToys();
  if (view === 'prets') loadLoans();
  if (view === 'profil') fillProfile();
}
window.addEventListener('hashchange', showView);
$('.tabs a[data-view="profil"]').addEventListener('click', (e) => {
  if (!state.me) { e.preventDefault(); openAuth('login'); }
});

// ---------- explorer map ----------
const map = L.map('map', { zoomControl: true, attributionControl: true }).setView([DEFAULT_POS.lat, DEFAULT_POS.lng], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
const meMarker = L.marker([DEFAULT_POS.lat, DEFAULT_POS.lng], {
  icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18] }), zIndexOffset: 1000, keyboard: false,
}).addTo(map).bindTooltip('Vous êtes ici');
const radiusCircle = L.circle([DEFAULT_POS.lat, DEFAULT_POS.lng], {
  radius: 5000, color: '#2f6fed', weight: 1.5, fillOpacity: 0.05, dashArray: '6 6', interactive: false,
}).addTo(map);
const lenderLayer = L.layerGroup().addTo(map);
const lenderMarkers = new Map();

function setOrigin(lat, lng, label, { fit = true } = {}) {
  state.origin = { lat, lng, label };
  meMarker.setLatLng([lat, lng]);
  radiusCircle.setLatLng([lat, lng]);
  $('#where-label').textContent = `Position : ${label}`;
  if (fit) map.fitBounds(radiusCircle.getBounds(), { padding: [10, 10] });
  loadToys();
}

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('La géolocalisation n’est pas disponible sur cet appareil.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === 1
        ? 'Localisation refusée. Autorisez-la dans votre navigateur ou cherchez une adresse.'
        : 'Position introuvable pour le moment. Cherchez une adresse à la place.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  });
}

$('#btn-locate').addEventListener('click', async () => {
  const btn = $('#btn-locate');
  btn.disabled = true;
  try {
    const p = await locate();
    setOrigin(p.lat, p.lng, 'votre position actuelle');
  } catch (e) { toast(e.message); } finally { btn.disabled = false; }
});

// Address search (via the server's OpenStreetMap proxy)
async function geocode(q) {
  const { results } = await api(`/api/geocode?q=${encodeURIComponent(q)}`);
  return results;
}
function bindAddressSearch(form, input, list, onPick) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q.length < 3) return;
    list.innerHTML = '<li class="muted small" style="padding:8px">Recherche…</li>';
    list.hidden = false;
    try {
      const results = await geocode(q);
      if (!results.length) { list.innerHTML = '<li class="muted small" style="padding:8px">Aucune adresse trouvée.</li>'; return; }
      list.innerHTML = results.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.label)}</button></li>`).join('');
      list.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const r = results[Number(b.dataset.i)];
        list.hidden = true;
        input.value = r.label.split(',').slice(0, 2).join(',');
        onPick(r);
      }));
    } catch (err) {
      list.innerHTML = `<li class="muted small" style="padding:8px">${esc(err.message)}</li>`;
    }
  });
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) list.hidden = true; });
}
bindAddressSearch($('#address-form'), $('#address-q'), $('#address-results'), (r) => {
  setOrigin(r.lat, r.lng, r.label.split(',').slice(0, 2).join(','));
});

// ---------- filters ----------
const filters = {
  q: $('#f-q'), category: $('#f-category'), age: $('#f-age'), radius: $('#f-radius'), available: $('#f-available'),
};
for (let a = 0; a <= 12; a++) filters.age.insertAdjacentHTML('beforeend', `<option value="${a}">${a === 0 ? 'Moins d’1 an' : `${a} an${a > 1 ? 's' : ''}`}</option>`);
filters.age.insertAdjacentHTML('beforeend', '<option value="14">Ado (13 ans et +)</option>');

let filterTimer;
const scheduleLoad = () => { clearTimeout(filterTimer); filterTimer = setTimeout(loadToys, 250); };
filters.q.addEventListener('input', scheduleLoad);
[filters.category, filters.age, filters.available].forEach((el) => el.addEventListener('change', loadToys));
filters.radius.addEventListener('input', () => {
  $('#f-radius-out').textContent = `${filters.radius.value} km`;
  radiusCircle.setRadius(Number(filters.radius.value) * 1000);
  scheduleLoad();
});
filters.radius.addEventListener('change', () => map.fitBounds(radiusCircle.getBounds(), { padding: [10, 10] }));
$('#filters').addEventListener('submit', (e) => { e.preventDefault(); loadToys(); });

async function loadToys() {
  const p = new URLSearchParams({ lat: state.origin.lat, lng: state.origin.lng, radius: filters.radius.value });
  if (filters.q.value.trim()) p.set('q', filters.q.value.trim());
  if (filters.category.value) p.set('category', filters.category.value);
  if (filters.age.value) p.set('age', filters.age.value);
  if (filters.available.checked) p.set('availableOnly', '1');
  try {
    const { toys } = await api(`/api/toys?${p}`);
    state.toys = toys;
    renderToys();
    renderLenders();
  } catch (e) {
    $('#results-head').textContent = e.message;
  }
}

function toyCard(t, { mine = false } = {}) {
  return `<li><button type="button" class="toy-card" data-toy="${t.id}" data-owner="${t.owner.id}">
    ${thumb(t)}
    <div class="body">
      <h3>${esc(t.title)}</h3>
      <div class="toy-meta">${availabilityChip(t)}<span class="chip">${esc(ageLabel(t))}</span><span class="chip">${esc(t.category)}</span></div>
      ${mine ? `<p class="small muted">Prêt ${t.maxDays} j max.${t.deposit ? ` · caution ${t.deposit} €` : ''}</p>`
        : `<div class="owner-line"><span><b>${esc(t.owner.name)}</b>${t.owner.isMe ? ' (vous)' : ''}</span><span class="distance">${fmtKm(t.distanceKm)}</span></div>`}
    </div>
  </button></li>`;
}

function renderToys() {
  const list = $('#toy-list');
  const n = state.toys.length;
  const lenders = new Set(state.toys.map((t) => t.owner.id)).size;
  $('#results-head').textContent = n
    ? `${n} jouet${n > 1 ? 's' : ''} chez ${lenders} prêteur${lenders > 1 ? 's' : ''} à moins de ${filters.radius.value} km`
    : 'Aucun jouet trouvé';
  list.innerHTML = n ? state.toys.map((t) => toyCard(t)).join('') : `<li class="empty">
      <b>Pas encore de jouet dans ce rayon</b>
      <span>Élargissez le rayon, changez les filtres, ou soyez le premier à prêter un jouet dans le quartier.</span>
      <button class="btn btn-primary" type="button" data-action="add-first">Prêter un jouet</button>
    </li>`;
}

$('#toy-list').addEventListener('click', (e) => {
  if (e.target.closest('[data-action="add-first"]')) {
    if (!state.me) return openAuth('register', 'Créez un compte pour prêter vos jouets.');
    location.hash = '#mes-jouets';
    return openEditor();
  }
  const card = e.target.closest('[data-toy]');
  if (card) openToy(Number(card.dataset.toy));
});
$('#toy-list').addEventListener('mouseover', (e) => {
  const card = e.target.closest('[data-owner]');
  highlightLender(card ? Number(card.dataset.owner) : null);
});

function renderLenders() {
  lenderLayer.clearLayers();
  lenderMarkers.clear();
  const byOwner = new Map();
  for (const t of state.toys) {
    if (!t.owner.position) continue;
    if (!byOwner.has(t.owner.id)) byOwner.set(t.owner.id, { owner: t.owner, toys: [] });
    byOwner.get(t.owner.id).toys.push(t);
  }
  for (const { owner, toys } of byOwner.values()) {
    const icon = L.divIcon({ className: '', html: `<div class="lender-pin">${toys.length}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
    const marker = L.marker([owner.position.lat, owner.position.lng], { icon, title: `${owner.name} : ${toys.length} jouet(s)` });
    const html = `<div class="popup">
      <h4>${esc(owner.name)}${owner.isMe ? ' (vous)' : ''}</h4>
      <div class="small">${esc(ratingText(owner.rating))}${toys[0].distanceKm != null ? ` · ${fmtKm(toys[0].distanceKm)}` : ''}</div>
      <ul>${toys.map((t) => `<li><button type="button" data-toy="${t.id}">${esc(t.title)}</button></li>`).join('')}</ul>
    </div>`;
    marker.bindPopup(html);
    marker.on('popupopen', (ev) => {
      ev.popup.getElement().querySelectorAll('[data-toy]').forEach((b) => b.addEventListener('click', () => openToy(Number(b.dataset.toy))));
      highlightCards(owner.id);
    });
    marker.on('popupclose', () => highlightCards(null));
    marker.addTo(lenderLayer);
    lenderMarkers.set(owner.id, marker);
  }
}

function highlightLender(ownerId) {
  if (state.activeLender === ownerId) return;
  const prev = lenderMarkers.get(state.activeLender);
  prev?.getElement()?.querySelector('.lender-pin')?.classList.remove('is-active');
  state.activeLender = ownerId;
  const m = lenderMarkers.get(ownerId);
  m?.getElement()?.querySelector('.lender-pin')?.classList.add('is-active');
  m?.setZIndexOffset(500);
}
function highlightCards(ownerId) {
  document.querySelectorAll('#toy-list .toy-card').forEach((c) => c.classList.toggle('is-highlight', Number(c.dataset.owner) === ownerId));
}

// ---------- toy detail + request ----------
async function openToy(id) {
  const dlg = $('#dlg-toy');
  const box = $('#toy-detail');
  box.innerHTML = '<p class="muted">Chargement…</p>';
  if (!dlg.open) dlg.showModal();
  try {
    const { toy: t, reviews } = await api(`/api/toys/${id}?lat=${state.origin.lat}&lng=${state.origin.lng}`);
    const start = todayIso();
    const end = addDays(start, Math.min(7, t.maxDays) - 1);
    const booked = t.availability.booked?.length
      ? `<p class="small muted">Déjà réservé : ${t.availability.booked.map((b) => `du ${fmtDate(b.start_date)} au ${fmtDate(b.end_date)}`).join(', ')}.</p>` : '';
    let requestBlock;
    if (t.owner.isMe) {
      requestBlock = `<div class="request"><p class="muted">C'est votre jouet.</p><button class="btn btn-ghost" type="button" data-edit="${t.id}">Modifier</button></div>`;
    } else if (!state.me) {
      requestBlock = `<div class="request"><p>Connectez-vous pour demander ce jouet à ${esc(t.owner.name)}.</p>
        <button class="btn btn-primary" type="button" data-login>Se connecter ou créer un compte</button></div>`;
    } else {
      requestBlock = `<form class="request" id="request-form">
        <h3>Demander ce jouet</h3>
        <div class="grid-2">
          <div class="field"><label for="r-start">Je le récupère le</label><input id="r-start" type="date" min="${start}" value="${start}" required></div>
          <div class="field"><label for="r-end">Je le rends le</label><input id="r-end" type="date" min="${start}" value="${end}" required></div>
        </div>
        ${booked}
        <div class="field"><label for="r-msg">Message à ${esc(t.owner.name)}</label>
          <textarea id="r-msg" rows="3" maxlength="1000" placeholder="Bonjour ! Mon fils de 4 ans adorerait l'essayer. Je peux passer mercredi après 17 h.">Bonjour ${esc(t.owner.name.replace(/\s*\(démo\)$/, ''))} ! </textarea></div>
        <p class="error" id="r-error" role="alert"></p>
        <button class="btn btn-primary" type="submit">Envoyer la demande</button>
      </form>`;
    }
    box.innerHTML = `<div class="detail">
      ${thumb(t)}
      <div class="detail-info">
        <h2>${esc(t.title)}</h2>
        <div class="toy-meta">${availabilityChip(t)}<span class="chip">${esc(t.category)}</span></div>
        ${t.description ? `<p>${esc(t.description)}</p>` : ''}
        <dl>
          <dt>Âge</dt><dd>${esc(ageLabel(t))}</dd>
          <dt>État</dt><dd>${esc(t.condition)}</dd>
          <dt>Durée max.</dt><dd>${t.maxDays} jours</dd>
          <dt>Caution</dt><dd>${t.deposit ? `${t.deposit} €` : 'aucune'}</dd>
        </dl>
        <div class="lender-box">
          <b>Prêté par ${esc(t.owner.name)}</b>
          <span class="muted">${esc(ratingText(t.owner.rating))}${t.distanceKm != null && !t.owner.isMe ? ` · à environ ${fmtKm(t.distanceKm)}` : ''}${t.owner.city ? ` · ${esc(t.owner.city)}` : ''}</span>
          ${t.owner.bio ? `<span>${esc(t.owner.bio)}</span>` : ''}
        </div>
      </div>
      ${reviews.length ? `<div class="reviews"><h3>Avis sur ${esc(t.owner.name)}</h3>${reviews.map((r) => `<blockquote>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)} — ${esc(r.author)}${r.comment ? `<br>${esc(r.comment)}` : ''}</blockquote>`).join('')}</div>` : ''}
      ${requestBlock}
    </div>`;
    box.querySelector('[data-login]')?.addEventListener('click', () => { dlg.close(); openAuth('login', `Connectez-vous pour demander « ${t.title} ».`); });
    box.querySelector('[data-edit]')?.addEventListener('click', () => { dlg.close(); openEditor(t); });
    const form = box.querySelector('#request-form');
    if (form) {
      const s = $('#r-start'), en = $('#r-end');
      s.addEventListener('change', () => {
        en.min = s.value;
        en.max = addDays(s.value, t.maxDays - 1);
        if (en.value < s.value || en.value > en.max) en.value = addDays(s.value, Math.min(7, t.maxDays) - 1);
      });
      en.max = addDays(s.value, t.maxDays - 1);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api('/api/loans', { method: 'POST', body: { toyId: t.id, startDate: s.value, endDate: en.value, message: $('#r-msg').value } });
          dlg.close();
          toast(`Demande envoyée à ${t.owner.name}.`);
        } catch (err) { $('#r-error').textContent = err.message; }
      });
    }
  } catch (e) {
    box.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

// ---------- auth ----------
let authMode = 'login';
function openAuth(mode, reason) {
  setAuthMode(mode);
  const r = $('#auth-reason');
  r.hidden = !reason;
  r.textContent = reason || '';
  $('#auth-error').textContent = '';
  const dlg = $('#dlg-auth');
  if (!dlg.open) dlg.showModal();
}
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('[data-auth]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.auth === mode)));
  document.querySelectorAll('.register-only').forEach((el) => { el.hidden = mode !== 'register'; });
  $('#a-name').required = mode === 'register';
  $('#a-password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  $('#auth-submit').textContent = mode === 'register' ? 'Créer mon compte' : 'Se connecter';
}
document.querySelectorAll('[data-auth]').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.auth)));

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#auth-submit');
  btn.disabled = true;
  $('#auth-error').textContent = '';
  try {
    const body = { email: $('#a-email').value, password: $('#a-password').value };
    if (authMode === 'register') {
      body.name = $('#a-name').value;
      if ($('#a-geo').checked) {
        try { Object.assign(body, await locate()); } catch { Object.assign(body, { lat: state.origin.lat, lng: state.origin.lng }); }
      }
    }
    const { user } = await api(authMode === 'register' ? '/api/register' : '/api/login', { method: 'POST', body });
    setMe(user);
    $('#dlg-auth').close();
    $('#auth-form').reset();
    toast(authMode === 'register' ? `Bienvenue ${user.name} !` : `Bon retour ${user.name} !`);
    if (user.position && authMode === 'login') setOrigin(user.position.lat, user.position.lng, 'votre point de rendez-vous');
    else loadToys();
  } catch (err) {
    $('#auth-error').textContent = err.message;
  } finally { btn.disabled = false; }
});

function setMe(user) {
  state.me = user;
  $('#tab-profil-label').textContent = user ? user.name : 'Connexion';
  const badge = $('#badge-prets');
  badge.hidden = !user?.pendingRequests;
  badge.textContent = user?.pendingRequests || '';
}

$('#btn-logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  setMe(null);
  location.hash = '#explorer';
  toast('Vous êtes déconnecté.');
  loadToys();
});

// ---------- my toys ----------
async function loadMyToys() {
  const list = $('#my-toys');
  try {
    const { toys } = await api('/api/my/toys');
    list.innerHTML = toys.length ? toys.map((t) => toyCard(t, { mine: true })).join('') : `<li class="empty">
      <b>Vous ne prêtez encore aucun jouet</b>
      <span>Ajoutez un jouet qui dort au fond d'un placard : il apparaîtra sur la carte de vos voisins.</span>
    </li>`;
    list.querySelectorAll('[data-toy]').forEach((c) => c.addEventListener('click', () => openEditor(toys.find((t) => t.id === Number(c.dataset.toy)))));
  } catch (e) { list.innerHTML = `<li class="error">${esc(e.message)}</li>`; }
}

$('#btn-add-toy').addEventListener('click', () => openEditor());

let editing = null;
let editPhoto = null;
function openEditor(toy = null) {
  if (!state.me) return openAuth('login');
  if (!state.me.position) {
    toast('Placez d’abord votre point de rendez-vous sur la carte de votre profil.');
    location.hash = '#profil';
    return;
  }
  editing = toy;
  editPhoto = toy?.photo || null;
  $('#edit-title').textContent = toy ? 'Modifier le jouet' : 'Ajouter un jouet';
  $('#e-title').value = toy?.title || '';
  $('#e-desc').value = toy?.description || '';
  $('#e-category').value = toy?.category || state.meta.categories[0];
  $('#e-condition').value = toy?.condition || 'bon';
  $('#e-agemin').value = toy?.ageMin ?? 3;
  $('#e-agemax').value = toy?.ageMax ?? 8;
  $('#e-maxdays').value = toy?.maxDays ?? 14;
  $('#e-deposit').value = toy?.deposit ?? 0;
  $('#e-active').checked = toy ? toy.active : true;
  $('#e-delete').hidden = !toy;
  $('#edit-error').textContent = '';
  renderPhotoPreview();
  $('#dlg-edit').showModal();
}
function renderPhotoPreview() {
  $('#e-preview').innerHTML = thumb({ id: editing?.id || 0, title: $('#e-title').value || '?', photo: editPhoto });
  $('#e-photo-clear').hidden = !editPhoto;
}
$('#e-title').addEventListener('input', () => { if (!editPhoto) renderPhotoPreview(); });
$('#e-photo-clear').addEventListener('click', () => { editPhoto = null; $('#e-photo').value = ''; renderPhotoPreview(); });

// Shrink photos in the browser so uploads stay small on mobile data.
$('#e-photo').addEventListener('change', async () => {
  const file = $('#e-photo').files[0];
  if (!file) return;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    editPhoto = canvas.toDataURL('image/jpeg', 0.8);
    renderPhotoPreview();
  } catch {
    toast('Cette image ne peut pas être lue. Essayez une photo JPEG ou PNG.');
  }
});

$('#edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    title: $('#e-title').value, description: $('#e-desc').value, category: $('#e-category').value,
    condition: $('#e-condition').value, ageMin: Number($('#e-agemin').value), ageMax: Number($('#e-agemax').value),
    maxDays: Number($('#e-maxdays').value), deposit: Number($('#e-deposit').value), active: $('#e-active').checked, photo: editPhoto,
  };
  try {
    await api(editing ? `/api/toys/${editing.id}` : '/api/toys', { method: editing ? 'PUT' : 'POST', body });
    $('#dlg-edit').close();
    toast(editing ? 'Jouet mis à jour.' : 'Jouet ajouté : vos voisins le voient sur la carte.');
    loadMyToys();
    loadToys();
  } catch (err) { $('#edit-error').textContent = err.message; }
});

$('#e-delete').addEventListener('click', async () => {
  const btn = $('#e-delete');
  if (btn.dataset.confirm !== '1') {
    btn.dataset.confirm = '1';
    btn.textContent = 'Confirmer la suppression';
    setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = 'Supprimer'; }, 4000);
    return;
  }
  try {
    await api(`/api/toys/${editing.id}`, { method: 'DELETE' });
    $('#dlg-edit').close();
    toast('Jouet supprimé.');
    loadMyToys();
    loadToys();
  } catch (err) { $('#edit-error').textContent = err.message; }
});

// ---------- loans ----------
const ACTIONS = {
  owner: {
    pending: [['accepted', 'Accepter', 'btn-primary'], ['refused', 'Refuser', 'btn-ghost']],
    accepted: [['lent', 'Jouet remis', 'btn-primary'], ['cancelled', 'Annuler', 'btn-ghost']],
    lent: [['returned', 'Jouet rendu', 'btn-primary']],
  },
  borrower: {
    pending: [['cancelled', 'Annuler ma demande', 'btn-ghost']],
    accepted: [['cancelled', 'Annuler', 'btn-ghost']],
  },
};
const HINT = {
  owner: { pending: 'vous demande ce jouet', accepted: 'viendra le chercher', lent: 'a le jouet', returned: 'a rendu le jouet', refused: 'demande refusée', cancelled: 'demande annulée' },
  borrower: { pending: 'doit répondre', accepted: 'a accepté : convenez du rendez-vous', lent: 'vous a prêté ce jouet', returned: 'merci d’avoir rendu le jouet', refused: 'n’a pas pu prêter', cancelled: 'demande annulée' },
};

async function loadLoans() {
  try {
    const { loans } = await api('/api/loans');
    for (const role of ['owner', 'borrower']) {
      const mine = loans.filter((l) => l.role === role);
      $(`#loans-${role}`).innerHTML = mine.length ? mine.map(loanItem).join('') : `<li class="empty"><span>${role === 'owner'
        ? 'Aucune demande pour l’instant.' : 'Vous n’avez encore rien emprunté. Trouvez un jouet sur la carte !'}</span></li>`;
    }
    document.querySelectorAll('#view-prets [data-status]').forEach((b) => b.addEventListener('click', () => changeStatus(Number(b.dataset.loan), b.dataset.status)));
    document.querySelectorAll('#view-prets [data-thread]').forEach((b) => b.addEventListener('click', () => openThread(loans.find((l) => l.id === Number(b.dataset.thread)))));
    const pending = loans.filter((l) => l.role === 'owner' && l.status === 'pending').length;
    setMe({ ...state.me, pendingRequests: pending });
  } catch (e) { toast(e.message); }
}

function loanItem(l) {
  const actions = (ACTIONS[l.role][l.status] || [])
    .map(([s, label, cls]) => `<button class="btn btn-sm ${cls}" type="button" data-loan="${l.id}" data-status="${s}">${label}</button>`).join('');
  const review = l.status === 'returned' && !l.myReview ? '<button class="btn btn-sm btn-ghost" type="button" data-thread="' + l.id + '">Laisser un avis</button>' : '';
  return `<li class="loan">
    ${thumb({ id: l.toy.id, title: l.toy.title, photo: l.toy.photo })}
    <div>
      <div class="loan-top"><h3>${esc(l.toy.title)}</h3><span class="status status-${l.status}">${STATUS_LABEL[l.status]}</span></div>
      <p class="small"><b>${esc(l.other.name)}</b> ${HINT[l.role][l.status]}</p>
      <p class="loan-dates">Du ${fmtDate(l.startDate)} au ${fmtDate(l.endDate)}</p>
      <div class="loan-actions">${actions}<button class="btn btn-sm btn-ghost" type="button" data-thread="${l.id}">Messages${l.messageCount ? ` (${l.messageCount})` : ''}</button>${review}</div>
    </div>
  </li>`;
}

async function changeStatus(id, status) {
  try {
    await api(`/api/loans/${id}/status`, { method: 'POST', body: { status } });
    toast(`Statut : ${STATUS_LABEL[status].toLowerCase()}.`);
    loadLoans();
    loadToys();
  } catch (e) { toast(e.message); }
}

async function openThread(loan) {
  const dlg = $('#dlg-thread');
  const box = $('#thread');
  const render = async () => {
    const { messages } = await api(`/api/loans/${loan.id}/messages`);
    const canReview = loan.status === 'returned' && !loan.myReview;
    box.innerHTML = `<h2>${esc(loan.toy.title)}</h2>
      <p class="muted small">Avec ${esc(loan.other.name)} · du ${fmtDate(loan.startDate)} au ${fmtDate(loan.endDate)}</p>
      ${canReview ? `<form class="card stack" id="review-form" style="margin-top:12px">
        <b>Comment s’est passé ce prêt avec ${esc(loan.other.name)} ?</b>
        <div class="stars" role="radiogroup" aria-label="Note">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="false" aria-label="${n} sur 5" data-star="${n}">★</button>`).join('')}</div>
        <textarea id="rv-comment" rows="2" maxlength="500" placeholder="Ponctuel, jouet en bon état…"></textarea>
        <button class="btn btn-primary" type="submit">Publier l’avis</button>
      </form>` : ''}
      <ul class="thread-messages">${messages.length ? messages.map((m) => `<li class="msg ${m.mine ? 'mine' : ''}">${esc(m.body)}<time>${new Date(m.createdAt.replace(' ', 'T') + 'Z').toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></li>`).join('')
        : '<li class="muted small">Aucun message. Proposez un lieu et une heure pour l’échange.</li>'}</ul>
      <form class="thread-form" id="thread-form">
        <label class="sr-only" for="t-body">Votre message</label>
        <input id="t-body" placeholder="Votre message…" maxlength="1000" autocomplete="off" required>
        <button class="btn btn-primary" type="submit">Envoyer</button>
      </form>`;
    const ul = box.querySelector('.thread-messages');
    ul.scrollTop = ul.scrollHeight;
    box.querySelector('#thread-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('#t-body');
      try {
        await api(`/api/loans/${loan.id}/messages`, { method: 'POST', body: { body: input.value } });
        await render();
        $('#t-body').focus();
      } catch (err) { toast(err.message); }
    });
    const rf = box.querySelector('#review-form');
    if (rf) {
      let rating = 0;
      rf.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', () => {
        rating = Number(b.dataset.star);
        rf.querySelectorAll('[data-star]').forEach((s) => {
          s.classList.toggle('on', Number(s.dataset.star) <= rating);
          s.setAttribute('aria-checked', String(Number(s.dataset.star) === rating));
        });
      }));
      rf.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const r = await api(`/api/loans/${loan.id}/review`, { method: 'POST', body: { rating, comment: $('#rv-comment').value } });
          loan = r.loan;
          toast('Merci pour votre avis !');
          await render();
          loadLoans();
        } catch (err) { toast(err.message); }
      });
    }
  };
  box.innerHTML = '<p class="muted">Chargement…</p>';
  dlg.showModal();
  try { await render(); } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

// ---------- profile ----------
let profileMap = null;
let profileMarker = null;
let profilePos = null;

function setProfilePos(lat, lng, pan = true) {
  profilePos = { lat, lng };
  if (!profileMarker) profileMarker = L.marker([lat, lng], { draggable: true }).addTo(profileMap)
    .on('dragend', () => { const p = profileMarker.getLatLng(); setProfilePos(p.lat, p.lng, false); });
  profileMarker.setLatLng([lat, lng]);
  if (pan) profileMap.setView([lat, lng], 15);
  $('#p-pos-label').textContent = 'Repère placé. Pensez à enregistrer.';
}

function fillProfile() {
  const u = state.me;
  $('#p-name').value = u.name;
  $('#p-city').value = u.city || '';
  $('#p-bio').value = u.bio || '';
  if (!profileMap) {
    profileMap = L.map('profile-map').setView([state.origin.lat, state.origin.lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(profileMap);
    profileMap.on('click', (e) => setProfilePos(e.latlng.lat, e.latlng.lng, false));
  }
  setTimeout(() => profileMap.invalidateSize(), 50);
  if (u.position) {
    setProfilePos(u.position.lat, u.position.lng);
    $('#p-pos-label').textContent = 'Position enregistrée.';
  } else {
    profilePos = null;
    $('#p-pos-label').textContent = 'Aucune position enregistrée : touchez la carte.';
  }
}

$('#p-locate').addEventListener('click', async () => {
  try { const p = await locate(); setProfilePos(p.lat, p.lng); } catch (e) { toast(e.message); }
});

$('#profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { name: $('#p-name').value, city: $('#p-city').value, bio: $('#p-bio').value };
  if (profilePos) Object.assign(body, profilePos);
  try {
    const { user } = await api('/api/me', { method: 'PUT', body });
    setMe(user);
    $('#p-pos-label').textContent = 'Position enregistrée.';
    toast('Profil enregistré.');
  } catch (err) { toast(err.message); }
});

// ---------- start ----------
async function start() {
  const [meta, { user }] = await Promise.all([api('/api/meta'), api('/api/me')]);
  state.meta = meta;
  filters.category.insertAdjacentHTML('beforeend', meta.categories.map((c) => `<option>${esc(c)}</option>`).join(''));
  $('#e-category').innerHTML = meta.categories.map((c) => `<option>${esc(c)}</option>`).join('');
  $('#e-condition').innerHTML = meta.conditions.map((c) => `<option>${esc(c)}</option>`).join('');
  setMe(user);
  showView();

  if (user?.position) setOrigin(user.position.lat, user.position.lng, 'votre point de rendez-vous');
  else setOrigin(DEFAULT_POS.lat, DEFAULT_POS.lng, DEFAULT_POS.label);

  // Quietly try the device position when the permission is already granted.
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm?.state === 'granted' && !user?.position) {
      const p = await locate();
      setOrigin(p.lat, p.lng, 'votre position actuelle');
    }
  } catch { /* the "Me localiser" button stays available */ }
}
start().catch((e) => toast(e.message));
