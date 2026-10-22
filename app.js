/* ═══════════════════════════════════════════════════════════
   KaloriSnap — snap makanan, dapat kalori.
   Vanilla JS. Tiada dependency. Data dalam browser.
   ═══════════════════════════════════════════════════════════ */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const LS = {
  settings: 'ks.settings.v1',
  entries: 'ks.entries.v1',
  auth: 'ks.auth.v1',
};

const DEFAULT_SETTINGS = {
  endpoint: 'http://localhost:20128/v1',
  apiKey: '',
  model: 'super-free',
  targets: { kcal: 1800, protein: 120, karbo: 200, lemak: 60 },
};

const PROMPT = `Kau pakar pemakanan Malaysia. Analisa gambar makanan dan anggar kalori.

Balas HANYA dengan JSON sah. Tiada markdown, tiada teks lain.
Format:
{"items":[{"nama":"Nasi lemak","gram":180,"kalori":360,"protein":7,"karbo":48,"lemak":15}],"keyakinan":0.8,"nota":"andaian 1 pinggan nasi penuh"}

Peraturan:
1. Senaraikan SETIAP komponen berasingan (nasi, sambal, telur, ayam, sayur).
2. "gram" = anggaran berat hidangan yang kelihatan dalam gambar.
3. "kalori", "protein", "karbo", "lemak" = jumlah untuk gram itu, BUKAN per 100g.
4. Nama makanan dalam Bahasa Melayu biasa yang orang kenal.
5. "keyakinan" antara 0 dan 1. Turunkan jika gambar kabur, gelap, atau portion susah nampak.
6. "nota" maksimum 12 patah perkataan — sebut andaian utama kau.
7. Jika tiada makanan dikesan: {"items":[],"keyakinan":0,"nota":"Tiada makanan dikesan"}.
8. Semua angka mesti nombor JSON, bukan teks.`;

/* ───────── util ───────── */
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const round0 = (n) => Math.round(Number(n) || 0);
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const uid = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch { return false; }
}

let toastTimer = null;
function toast(msg, ms = 2400) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ───────── state ───────── */
let state = {
  settings: { ...DEFAULT_SETTINGS, ...load(LS.settings, {}) },
  entries: load(LS.entries, []),
  view: 'today',
};
state.settings.targets = { ...DEFAULT_SETTINGS.targets, ...(state.settings.targets || {}) };
if (!Array.isArray(state.entries)) state.entries = [];

function persistSettings() { save(LS.settings, state.settings); }

function persistEntries() {
  // Cuba simpan; kalau quota penuh, buang thumbnail lama dahulu.
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      localStorage.setItem(LS.entries, JSON.stringify(state.entries));
      return true;
    } catch {
      const withThumb = state.entries
        .filter((e) => e.thumb)
        .sort((a, b) => a.ts - b.ts);
      if (withThumb.length) { withThumb[0].thumb = null; continue; }
      // Masih gagal — buang rekod paling lama.
      if (state.entries.length > 1) {
        state.entries.sort((a, b) => b.ts - a.ts);
        state.entries.pop();
        continue;
      }
      toast('Storan penuh — tak dapat simpan');
      return false;
    }
  }
  return false;
}

/* ───────── auth ───────── */
const enc = new TextEncoder();
let auth = load(LS.auth, null);
let lockMode = 'unlock';

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function simpleHash(pass, salt) {
  let h1 = 0xdeadbeef ^ salt.length;
  let h2 = 0x41c6ce57 ^ pass.length;
  const s = `${salt}|${pass}|${salt}`;
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

async function hashPass(pass, salt, iter = 150000) {
  if (!(crypto.subtle && crypto.subtle.importKey)) return { algo: 'simple', hash: simpleHash(pass, salt) };
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: unb64(salt), iterations: iter, hash: 'SHA-256' }, key, 256,
  );
  return { algo: 'pbkdf2', hash: b64(bits) };
}

function newSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return b64(a);
}

async function createAuth(pass) {
  const salt = newSalt();
  const iter = 150000;
  const { algo, hash } = await hashPass(pass, salt, iter);
  auth = { salt, iter, algo, hash };
  save(LS.auth, auth);
  sessionStorage.setItem('ks.unlocked', '1');
}

async function checkAuth(pass) {
  if (!auth) return false;
  if (auth.algo === 'simple') return simpleHash(pass, auth.salt) === auth.hash;
  const { hash } = await hashPass(pass, auth.salt, auth.iter);
  return hash === auth.hash;
}

function showLock(mode) {
  lockMode = mode;
  const lock = $('#lock');
  lock.hidden = false;
  $('#app').hidden = true;
  $('#lock-err').textContent = '';
  $('#lock-pass').value = '';
  $('#lock-pass2').value = '';
  $('#forgot-btn').hidden = mode !== 'unlock';

  const setup = mode === 'setup';
  const change = mode === 'change';
  $('#lock-pass2').hidden = !(setup || change);
  $('#lock-sub').textContent = setup
    ? 'Cipta password untuk mula'
    : change ? 'Set password baru' : 'Masukkan password';
  $('#lock-btn').textContent = setup ? 'Cipta & mula' : change ? 'Simpan password' : 'Buka';
  $('#lock-note').textContent = setup
    ? 'Password ini disimpan dalam browser ni sahaja. Ia penghadang ringkas, bukan encryption.'
    : change ? 'App akan dikunci semula selepas ini.' : '';
  setTimeout(() => $('#lock-pass').focus(), 120);
}

function hideLock() {
  $('#lock').hidden = true;
  $('#app').hidden = false;
  sessionStorage.setItem('ks.unlocked', '1');
  switchView(state.view || 'today');
}

$('#lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pass = $('#lock-pass').value;
  const pass2 = $('#lock-pass2').value;
  const err = $('#lock-err');

  if (lockMode === 'unlock') {
    const ok = await checkAuth(pass);
    if (!ok) { err.textContent = 'Password salah.'; return; }
    hideLock();
    return;
  }

  if (pass.length < 4) { err.textContent = 'Minimum 4 aksara.'; return; }
  if (pass !== pass2) { err.textContent = 'Password tak sama.'; return; }

  await createAuth(pass);
  if (lockMode === 'change') {
    sessionStorage.removeItem('ks.unlocked');
    showLock('unlock');
    toast('Password dikemas kini');
    return;
  }
  hideLock();
  if (!state.settings.apiKey) switchView('settings');
});

$('#forgot-btn').addEventListener('click', () => {
  const ok = confirm(
    'Lupa password?\n\nSatu-satunya cara ialah set semula app. Semua rekod makanan akan dipadam.\n\nTeruskan?',
  );
  if (!ok) return;
  localStorage.removeItem(LS.entries);
  localStorage.removeItem(LS.auth);
  state.entries = [];
  auth = null;
  showLock('setup');
  toast('Data dipadam. Cipta password baru.');
});

$('#btn-lock').addEventListener('click', () => {
  sessionStorage.removeItem('ks.unlocked');
  showLock('unlock');
});

/* ───────── navigation ───────── */
const TITLES = { today: 'Hari Ini', history: 'Sejarah', settings: 'Tetapan' };

function switchView(view) {
  state.view = view;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === view));
  $$('main > section').forEach((s) => { s.hidden = s.dataset.view !== view; });
  $('#screen-title').textContent = TITLES[view] || '';
  $('#today-label').textContent = view === 'today'
    ? new Date().toLocaleDateString('ms-MY', { weekday: 'long', day: 'numeric', month: 'long' })
    : view === 'history' ? 'Rekod & trend' : 'Sambungan & data';
  if (view === 'today') renderToday();
  if (view === 'history') renderHistory();
  window.scrollTo(0, 0);
}

$$('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.tab)));

/* ───────── today ───────── */
function entryTotals(e) {
  return (e.items || []).reduce((a, i) => ({
    kcal: a.kcal + num(i.kalori),
    p: a.p + num(i.protein),
    c: a.c + num(i.karbo),
    f: a.f + num(i.lemak),
  }), { kcal: 0, p: 0, c: 0, f: 0 });
}

function renderToday() {
  const today = dateKey();
  const meals = state.entries
    .filter((e) => e.date === today)
    .sort((a, b) => b.ts - a.ts);

  const t = meals.reduce((a, e) => {
    const x = entryTotals(e);
    return { kcal: a.kcal + x.kcal, p: a.p + x.p, c: a.c + x.c, f: a.f + x.f };
  }, { kcal: 0, p: 0, c: 0, f: 0 });

  const tg = state.settings.targets;
  const left = tg.kcal - t.kcal;
  const pct = tg.kcal > 0 ? t.kcal / tg.kcal : 0;

  const C = 540.35;
  const ring = $('#ring-fg');
  ring.style.strokeDashoffset = String(C * (1 - clamp(pct, 0, 1)));
  ring.classList.toggle('over', left < 0);

  $('#kcal-left').textContent = Math.abs(Math.round(left));
  $('#kcal-label').textContent = left >= 0 ? 'kalori lagi' : 'lebih sasaran';
  $('#stat-eaten').textContent = Math.round(t.kcal) + ' kcal';
  $('#stat-target').textContent = Math.round(tg.kcal) + ' kcal';
  $('#stat-left').textContent = (left >= 0 ? '' : '+') + Math.round(Math.abs(left)) + ' kcal';
  $('#stat-left').style.color = left < 0 ? 'var(--bad)' : '';

  const macros = [
    ['protein', t.p, tg.protein],
    ['karbo', t.c, tg.karbo],
    ['lemak', t.f, tg.lemak],
  ];
  macros.forEach(([k, val, goal]) => {
    const p = goal > 0 ? val / goal : 0;
    const bar = $('#m-' + k);
    bar.style.width = Math.min(100, p * 100) + '%';
    bar.classList.toggle('over', p > 1);
    $('#m-' + k + '-txt').textContent = `${Math.round(val)} / ${Math.round(goal)} g`;
  });

  $('#meal-count').textContent = `${meals.length} hidangan`;
  $('#today-empty').hidden = meals.length > 0;
  $('#meal-list').hidden = meals.length === 0;

  $('#meal-list').innerHTML = meals.map((e) => {
    const x = entryTotals(e);
    const names = (e.items || []).map((i) => i.nama);
    const title = names.slice(0, 2).join(' + ') + (names.length > 2 ? ` +${names.length - 2}` : '');
    const time = new Date(e.ts).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' });
    return `
      <article class="meal">
        <div class="meal-thumb">${e.thumb ? `<img src="${e.thumb}" alt="">` : '🍽'}</div>
        <div class="meal-main">
          <p class="meal-name">${esc(title || 'Hidangan')}</p>
          <p class="meal-sub">${time} · P ${Math.round(x.p)}g · K ${Math.round(x.c)}g · L ${Math.round(x.f)}g</p>
        </div>
        <div class="meal-kcal">${Math.round(x.kcal)}<small>kcal</small></div>
        <button class="meal-del" data-del="${esc(e.id)}" aria-label="Padam">✕</button>
      </article>`;
  }).join('');
}

$('#meal-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-del]');
  if (!btn) return;
  const id = btn.dataset.del;
  const entry = state.entries.find((x) => x.id === id);
  if (!entry) return;
  const names = (entry.items || []).map((i) => i.nama).slice(0, 2).join(', ');
  if (!confirm(`Padam "${names}"?`)) return;
  state.entries = state.entries.filter((x) => x.id !== id);
  persistEntries();
  renderToday();
  toast('Rekod dipadam');
});

/* ───────── history ───────── */
function lastNDays(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    out.push(dateKey(d));
  }
  return out;
}

function renderHistory() {
  const days = lastNDays(14);
  const tg = state.settings.targets.kcal || 1;
  const rows = days.map((k) => {
    const meals = state.entries.filter((e) => e.date === k);
    const kcal = meals.reduce((a, e) => a + entryTotals(e).kcal, 0);
    return { key: k, kcal, count: meals.length };
  });

  const max = Math.max(tg * 1.2, ...rows.map((r) => r.kcal), 1);
  const todayKey = dateKey();

  $('#chart').innerHTML = rows.map((r) => {
    const h = clamp((r.kcal / max) * 100, 0, 100);
    const cls = r.kcal === 0 ? '' : r.kcal > tg ? 'over' : 'ok';
    const d = parseKey(r.key);
    const label = d.getDate();
    return `
      <div class="chart-col" title="${r.key}: ${Math.round(r.kcal)} kcal">
        <div class="chart-bar-wrap">
          <div class="chart-bar ${cls} ${r.key === todayKey ? 'today' : ''}" style="height:${h}%"></div>
        </div>
        <span class="chart-x">${label}</span>
      </div>`;
  }).join('') + `<div class="chart-goal" style="bottom:${clamp((tg / max) * 100, 0, 100)}%"></div>`;

  const active = rows.filter((r) => r.kcal > 0);
  const avg = active.length ? active.reduce((a, r) => a + r.kcal, 0) / active.length : 0;
  $('#avg-pill').textContent = active.length ? `purata ${Math.round(avg)} kcal` : 'tiada data';

  const withData = rows.filter((r) => r.count > 0).reverse();
  $('#history-list').innerHTML = withData.length
    ? withData.map((r) => {
      const d = parseKey(r.key);
      const over = r.kcal > tg;
      const dow = r.key === todayKey
        ? 'Hari ini'
        : d.toLocaleDateString('ms-MY', { weekday: 'long' });
      const sub = d.toLocaleDateString('ms-MY', { day: 'numeric', month: 'short' });
      return `
        <div class="day-row">
          <div class="day-date">
            <p class="day-dow">${dow}</p>
            <p class="day-sub">${sub} · ${r.count} hidangan</p>
          </div>
          <div class="day-kcal ${over ? 'over' : ''}">${Math.round(r.kcal)}<small>kcal</small></div>
        </div>`;
    }).join('')
    : '<div class="empty card"><div class="empty-emoji">📭</div><p class="empty-title">Belum ada sejarah</p><p class="empty-sub">Mulakan dengan snap satu hidangan hari ini.</p></div>';
}

/* ───────── settings ───────── */
let settingsBound = false;

function fillSettings() {
  const s = state.settings;
  $('#set-endpoint').value = s.endpoint || '';
  $('#set-key').value = s.apiKey || '';
  $('#set-model').value = s.model || 'super-free';
  $('#set-kcal').value = s.targets.kcal ?? '';
  $('#set-protein').value = s.targets.protein ?? '';
  $('#set-karbo').value = s.targets.karbo ?? '';
  $('#set-lemak').value = s.targets.lemak ?? '';
}

function bindSettings() {
  if (settingsBound) return;
  settingsBound = true;

  $('#btn-eye').addEventListener('click', () => {
    const f = $('#set-key');
    f.type = f.type === 'password' ? 'text' : 'password';
  });

  $$('#model-chips .chip').forEach((c) => c.addEventListener('click', () => {
    $('#set-model').value = c.dataset.model;
  }));

  $('#btn-save-conn').addEventListener('click', () => {
    state.settings.endpoint = $('#set-endpoint').value.trim() || DEFAULT_SETTINGS.endpoint;
    state.settings.apiKey = $('#set-key').value.trim();
    state.settings.model = $('#set-model').value.trim() || 'super-free';
    persistSettings();
    toast('Sambungan disimpan');
  });

  $('#btn-test').addEventListener('click', async () => {
    // Simpan dulu supaya test guna nilai terkini
    state.settings.endpoint = $('#set-endpoint').value.trim() || DEFAULT_SETTINGS.endpoint;
    state.settings.apiKey = $('#set-key').value.trim();
    state.settings.model = $('#set-model').value.trim() || 'super-free';
    persistSettings();

    const out = $('#conn-status');
    out.className = 'status';
    out.textContent = 'Menguji…';

    if (!state.settings.apiKey) { out.className = 'status bad'; out.textContent = 'API key kosong.'; return; }

    try {
      const t0 = performance.now();
      const res = await fetch(endpointUrl(state.settings.endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + state.settings.apiKey,
        },
        body: JSON.stringify({
          model: state.settings.model,
          messages: [{ role: 'user', content: 'Balas dengan satu perkataan: OK' }],
          max_tokens: 300,
          temperature: 0,
        }),
        signal: timeoutSignal(45000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${shortErr(text)}`);
      let out2 = '';
      try { out2 = JSON.parse(text).choices?.[0]?.message?.content || ''; } catch { /* ignore */ }
      out.className = 'status ok';
      const answered = out2.trim().slice(0, 40);
      out.textContent = `Berjaya (${Math.round(performance.now() - t0)}ms). ${answered ? 'Model jawab: ' + answered : 'Model responsif.'}`;
    } catch (err) {
      out.className = 'status bad';
      out.textContent = 'Gagal: ' + (err.message || err);
    }
  });

  $('#btn-save-targets').addEventListener('click', () => {
    const t = {
      kcal: clamp(round0($('#set-kcal').value) || 1800, 500, 6000),
      protein: clamp(round0($('#set-protein').value), 0, 400),
      karbo: clamp(round0($('#set-karbo').value), 0, 700),
      lemak: clamp(round0($('#set-lemak').value), 0, 300),
    };
    state.settings.targets = t;
    persistSettings();
    fillSettings();
    renderToday();
    toast('Sasaran disimpan');
  });

  $('#btn-calc').addEventListener('click', () => {
    const w = num($('#cal-berat').value);
    const h = num($('#cal-tinggi').value);
    const age = num($('#cal-umur').value);
    const sex = $('#cal-jantina').value;
    const act = num($('#cal-aktiviti').value) || 1.375;
    if (!w || !h || !age) { toast('Isi berat, tinggi & umur'); return; }

    // Mifflin-St Jeor
    const bmr = 10 * w + 6.25 * h - 5 * age + (sex === 'm' ? 5 : -161);
    const tdee = bmr * act;
    const kcal = Math.round((tdee * 0.8) / 10) * 10;          // defisit 20%
    const protein = Math.round(w * 1.8);
    const lemak = Math.round((kcal * 0.27) / 9);
    const karbo = Math.max(0, Math.round((kcal - protein * 4 - lemak * 9) / 4));

    $('#set-kcal').value = kcal;
    $('#set-protein').value = protein;
    $('#set-karbo').value = karbo;
    $('#set-lemak').value = lemak;
    $('#calc-out').textContent =
      `BMR ${Math.round(bmr)} kcal · TDEE ${Math.round(tdee)} kcal · defisit 20% → ${kcal} kcal/hari. Tekan "Simpan sasaran" untuk guna.`;
  });

  $('#btn-export').addEventListener('click', () => {
    const data = {
      app: 'KaloriSnap',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { ...state.settings, apiKey: '' },
      entries: state.entries,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kalorisnap-${dateKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Backup dimuat turun');
  });

  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.entries)) throw new Error('Format tak sah');
      const have = new Set(state.entries.map((x) => x.id));
      let added = 0;
      data.entries.forEach((x) => {
        if (x && x.id && !have.has(x.id) && x.date) { state.entries.push(x); added++; }
      });
      persistEntries();
      renderToday();
      renderHistory();
      toast(`${added} rekod diimport`);
    } catch (err) {
      toast('Gagal import: ' + err.message);
    }
  });

  $('#btn-wipe').addEventListener('click', () => {
    if (!confirm('Padam SEMUA rekod makanan? Tindakan ni tak boleh undo.')) return;
    state.entries = [];
    persistEntries();
    renderToday();
    renderHistory();
    toast('Semua rekod dipadam');
  });

  $('#btn-changepass').addEventListener('click', () => showLock('change'));

  // auto-save sambungan bila blur
  ['#set-endpoint', '#set-key', '#set-model'].forEach((sel) => {
    $(sel).addEventListener('change', () => {
      state.settings.endpoint = $('#set-endpoint').value.trim() || DEFAULT_SETTINGS.endpoint;
      state.settings.apiKey = $('#set-key').value.trim();
      state.settings.model = $('#set-model').value.trim() || 'super-free';
      persistSettings();
    });
  });
}

/* ───────── image ───────── */
async function decodeImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { try { return await createImageBitmap(file); } catch { /* fall through */ } }
  }
  return await new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Gambar tak dapat dibaca'));
    img.src = URL.createObjectURL(file);
  });
}

function drawTo(bitmap, max, quality) {
  const w0 = bitmap.width;
  const h0 = bitmap.height;
  const scale = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * scale));
  c.height = Math.max(1, Math.round(h0 * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

async function compress(file) {
  const bmp = await decodeImage(file);
  return {
    full: drawTo(bmp, 1024, 0.82),
    thumb: drawTo(bmp, 260, 0.6),
  };
}

/* ───────── AI ───────── */
function timeoutSignal(ms) {
  if (AbortSignal && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

function endpointUrl(ep) {
  let u = String(ep || '').trim().replace(/\/+$/, '');
  if (!u) u = DEFAULT_SETTINGS.endpoint;
  if (/\/chat\/completions$/i.test(u)) return u;
  if (/\/v1$/i.test(u)) return u + '/chat/completions';
  return u + '/v1/chat/completions';
}

function shortErr(text) {
  const t = String(text || '');
  try {
    const j = JSON.parse(t);
    return j?.error?.message || j?.message || t.slice(0, 180);
  } catch {
    return t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  }
}

function extractJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch { /* continue */ }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch { /* continue */ }
  }
  throw new Error('Jawapan AI bukan JSON yang sah.');
}

function perGram(item) {
  const gram = clamp(num(item.gram ?? item.grams ?? item.berat ?? item.weight) || 100, 1, 5000);
  let kcal = num(item.kalori ?? item.calories ?? item.kcal ?? item.kal);
  const p = num(item.protein ?? item.protein_g ?? item.prot);
  const c = num(item.karbo ?? item.carbs ?? item.carb ?? item.karbohidrat);
  const f = num(item.lemak ?? item.fat ?? item.fats);
  // Baiki kalori jika AI bagi 0 tapi makro ada
  if (kcal <= 0 && (p || c || f)) kcal = p * 4 + c * 4 + f * 9;
  return {
    nama: String(item.nama ?? item.name ?? item.food ?? 'Makanan').trim() || 'Makanan',
    gram,
    per: {
      kcal: clamp(kcal, 0, 9000) / gram,
      p: clamp(p, 0, 1000) / gram,
      c: clamp(c, 0, 1000) / gram,
      f: clamp(f, 0, 1000) / gram,
    },
  };
}

function normalizeResult(obj) {
  let items = obj?.items ?? obj?.foods ?? obj?.makanan ?? obj?.results;
  if (!items && Array.isArray(obj)) items = obj;
  if (!Array.isArray(items)) items = [];
  return {
    items: items.map(perGram).filter((i) => i.gram > 0 && i.per.kcal > 0).slice(0, 20),
    nota: String(obj?.nota ?? obj?.note ?? obj?.notes ?? '').slice(0, 160),
    keyakinan: clamp(num(obj?.keyakinan ?? obj?.confidence ?? 0.6), 0, 1),
  };
}

async function callVision(dataUrl) {
  const s = state.settings;
  if (!s.apiKey) throw new Error('API key 9Router belum diisi. Pergi Tetapan → Sambungan AI.');
  if (location.protocol === 'https:' && /^http:\/\//i.test(s.endpoint)) {
    throw new Error('Halaman https tak boleh call endpoint http. Guna URL tunnel https (9Router → Tunnel).');
  }

  const res = await fetch(endpointUrl(s.endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + s.apiKey,
    },
    body: JSON.stringify({
      model: s.model || 'super-free',
      temperature: 0.15,
      max_tokens: 1200,
      messages: [
        { role: 'system', content: PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analisa hidangan dalam gambar ini.' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    signal: timeoutSignal(90000),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${shortErr(text)}`);

  let body;
  try { body = JSON.parse(text); } catch { throw new Error('Respons bukan JSON.'); }
  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI tak bagi jawapan. Cuba model lain (cth: super-free).');

  const parsed = extractJson(content);
  const result = normalizeResult(parsed);
  if (!result.items.length) throw new Error(result.nota || 'Tiada makanan dikesan dalam gambar.');
  return result;
}

/* ───────── analyze sheet ───────── */
let draft = null;
let tipTimer = null;
let sheetOpen = false;

const TIPS = [
  'Ambil dari atas, cahaya cukup — lebih tepat.',
  'Sertakan sudu/garfu sebagai rujukan saiz.',
  'Hidangan berkuah susah diagak — betulkan gram nanti.',
  'Nasi, lauk dan sayur dalam satu gambar? Bagus.',
  'Kalau portion tak sure, lebih baik lebihkan sikit.',
];

function openSheet() {
  sheetOpen = true;
  $('#analyze').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  if (!sheetOpen) return;
  sheetOpen = false;
  $('#analyze').hidden = true;
  document.body.style.overflow = '';
  clearInterval(tipTimer);
  tipTimer = null;
  draft = null;
  $('#an-foot').hidden = true;
}

$('#an-close').addEventListener('click', closeSheet);

$('#fab').addEventListener('click', () => {
  if (!state.settings.apiKey) {
    toast('Isi API key 9Router di Tetapan dulu');
    switchView('settings');
    return;
  }
  $('#file-camera').click();
});

$('#empty-snap').addEventListener('click', () => $('#fab').click());

$('#fab-gallery').addEventListener('click', () => {
  if (!state.settings.apiKey) {
    toast('Isi API key 9Router di Tetapan dulu');
    switchView('settings');
    return;
  }
  $('#file-gallery').click();
});

$('#file-camera').addEventListener('change', onFile);
$('#file-gallery').addEventListener('change', onFile);

async function onFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  if (!state.settings.apiKey) {
    toast('Isi API key 9Router di Tetapan dulu');
    switchView('settings');
    return;
  }

  openSheet();
  $('#an-title').textContent = 'Analisa';
  $('#an-foot').hidden = true;

  let img;
  try {
    img = await compress(file);
  } catch (err) {
    renderError('Gambar tak dapat dibaca', err.message);
    return;
  }

  $('#an-body').innerHTML = `
    <img class="preview" src="${img.full}" alt="Gambar makanan">
    <div class="loading-box">
      <div class="spinner"></div>
      <p class="loading-title">Tengah tengok makanan kau…</p>
      <p class="loading-tip" id="tip">${esc(TIPS[0])}</p>
    </div>`;

  let ti = 0;
  clearInterval(tipTimer);
  tipTimer = setInterval(() => {
    ti = (ti + 1) % TIPS.length;
    const el = $('#tip');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => { el.textContent = TIPS[ti]; el.style.opacity = '1'; }, 180);
  }, 4200);

  try {
    const result = await callVision(img.full);
    clearInterval(tipTimer);
    tipTimer = null;
    draft = { ...result, thumb: img.thumb, photo: img.full };
    renderDraftEditor();
  } catch (err) {
    clearInterval(tipTimer);
    tipTimer = null;
    renderError('Tak dapat analisa', err.message || String(err));
  }
}

function renderError(title, msg) {
  $('#an-foot').hidden = true;
  $('#an-body').innerHTML = `
    <div class="an-error">
      <div class="big">😕</div>
      <h3>${esc(title)}</h3>
      <p>${esc(msg)}</p>
      <div class="btn-row">
        <button class="btn btn-ghost" id="err-settings">Tetapan</button>
        <button class="btn btn-primary" id="err-retry">Cuba lagi</button>
      </div>
    </div>`;

  $('#err-settings')?.addEventListener('click', () => { closeSheet(); switchView('settings'); });
  $('#err-retry')?.addEventListener('click', () => { closeSheet(); $('#file-camera').click(); });
}

function draftTotals() {
  return (draft?.items || []).reduce((a, i) => ({
    kcal: a.kcal + i.per.kcal * i.gram,
    p: a.p + i.per.p * i.gram,
    c: a.c + i.per.c * i.gram,
    f: a.f + i.per.f * i.gram,
  }), { kcal: 0, p: 0, c: 0, f: 0 });
}

function renderDraftEditor() {
  if (!draft) return;
  const conf = draft.keyakinan;
  const note = draft.nota;

  $('#an-title').textContent = 'Sahkan & betulkan';
  $('#an-body').innerHTML = `
    <img class="preview" src="${draft.photo || draft.thumb || ''}" alt="Gambar makanan" style="max-height:30vh">
    ${note ? `<p class="an-note">AI: ${esc(note)}</p>` : ''}
    ${conf < 0.55 ? '<p class="an-warn">AI tak berapa yakin dengan gambar ni. Semak gram sebelum simpan.</p>' : ''}

    <div class="items-head">
      <h3>Item dikesan</h3>
      <span>${draft.items.length} item · tekan gram untuk ubah</span>
    </div>
    <div id="item-list"></div>`;

  renderItems();
  $('#an-foot').hidden = false;
  updateFoot();
}

function renderItems() {
  const list = $('#item-list');
  if (!list || !draft) return;

  list.innerHTML = draft.items.map((i, idx) => {
    const kcal = i.per.kcal * i.gram;
    return `
      <div class="item" data-idx="${idx}">
        <div class="item-head">
          <input class="item-name" data-field="nama" value="${esc(i.nama)}" aria-label="Nama makanan">
          <button class="item-del" data-act="del" aria-label="Buang">✕</button>
        </div>
        <div class="item-row">
          <div class="stepper">
            <button data-act="minus" aria-label="Kurang">−</button>
            <input class="gram" data-field="gram" type="number" inputmode="decimal" value="${Math.round(i.gram)}" aria-label="Gram">
            <span class="unit">g</span>
            <button data-act="plus" aria-label="Tambah">+</button>
          </div>
          <button class="item-kcal" data-act="kcal" style="background:none;border:0;color:inherit;padding:0">${Math.round(kcal)} kcal</button>
        </div>
        <p class="item-macros">P ${round1(i.per.p * i.gram)}g · K ${round1(i.per.c * i.gram)}g · L ${round1(i.per.f * i.gram)}g</p>
      </div>`;
  }).join('');
}

function updateFoot() {
  const t = draftTotals();
  $('#foot-kcal').textContent = Math.round(t.kcal) + ' kcal';
  $('#foot-macros').textContent = `P ${Math.round(t.p)} · K ${Math.round(t.c)} · L ${Math.round(t.f)}`;
  // update per-item kcal text without full rerender
  $$('#item-list .item').forEach((el) => {
    const idx = Number(el.dataset.idx);
    const i = draft.items[idx];
    if (!i) return;
    const k = el.querySelector('.item-kcal');
    if (k) k.textContent = Math.round(i.per.kcal * i.gram) + ' kcal';
    const m = el.querySelector('.item-macros');
    if (m) m.textContent = `P ${round1(i.per.p * i.gram)}g · K ${round1(i.per.c * i.gram)}g · L ${round1(i.per.f * i.gram)}g`;
  });
}

$('#an-body').addEventListener('input', (e) => {
  const t = e.target;
  const itemEl = t.closest('.item');
  if (!itemEl || !draft) return;
  const idx = Number(itemEl.dataset.idx);
  const item = draft.items[idx];
  if (!item) return;

  if (t.dataset.field === 'nama') {
    item.nama = t.value;
  } else if (t.dataset.field === 'gram') {
    item.gram = clamp(num(t.value), 1, 5000);
    updateFoot();
  }
});

$('#an-body').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn || !draft) return;
  const itemEl = btn.closest('.item');
  const idx = Number(itemEl?.dataset.idx);
  const item = draft.items[idx];
  if (!item) return;
  const act = btn.dataset.act;

  if (act === 'del') {
    draft.items.splice(idx, 1);
    if (!draft.items.length) {
      closeSheet();
      toast('Semua item dibuang');
      return;
    }
    renderItems();
    updateFoot();
    return;
  }

  if (act === 'plus' || act === 'minus') {
    const step = Math.max(5, Math.round(item.gram * 0.1));
    item.gram = clamp(item.gram + (act === 'plus' ? step : -step), 1, 5000);
    const input = itemEl.querySelector('.gram');
    if (input) input.value = String(Math.round(item.gram));
    updateFoot();
    return;
  }

  if (act === 'kcal') {
    const cur = Math.round(item.per.kcal * item.gram);
    const val = prompt(`Kalori untuk ${Math.round(item.gram)} g "${item.nama}":`, String(cur));
    if (val === null) return;
    const n = num(val);
    if (n < 0) return;
    item.per.kcal = n / item.gram;
    updateFoot();
  }
});

$('#an-add').addEventListener('click', () => {
  if (!draft) return;
  draft.items.push({ nama: 'Item manual', gram: 100, per: { kcal: 1, p: 0, c: 0, f: 0 } });
  renderItems();
  updateFoot();
  const list = $('#item-list');
  list.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

$('#an-save').addEventListener('click', () => {
  if (!draft) return;
  const items = draft.items
    .filter((i) => i.gram > 0 && i.per.kcal > 0)
    .map((i) => ({
      nama: (i.nama || 'Makanan').trim().slice(0, 60),
      gram: Math.round(i.gram),
      kalori: Math.round(i.per.kcal * i.gram),
      protein: round1(i.per.p * i.gram),
      karbo: round1(i.per.c * i.gram),
      lemak: round1(i.per.f * i.gram),
    }));

  if (!items.length) { toast('Tiada item sah untuk disimpan'); return; }

  const entry = {
    id: uid(),
    date: dateKey(),
    ts: Date.now(),
    items,
    thumb: draft.thumb || null,
  };

  state.entries.push(entry);
  const ok = persistEntries();
  const total = items.reduce((a, i) => a + i.kalori, 0);

  closeSheet();
  switchView('today');
  renderToday();
  if (ok) toast(`Disimpan · ${Math.round(total)} kcal`);
});

/* ───────── boot ───────── */
function boot() {
  bindSettings();
  fillSettings();

  if (!auth) {
    showLock('setup');
  } else if (sessionStorage.getItem('ks.unlocked') === '1') {
    $('#app').hidden = false;
    $('#lock').hidden = true;
    switchView('today');
  } else {
    showLock('unlock');
  }

  // service worker (PWA) — hanya jika tersedia (https/localhost)
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { });
    });
  }
}

boot();
