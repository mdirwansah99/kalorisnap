# KaloriSnap 🍽

App diet paling ringkas: **ambil gambar makanan → tahu kalori & makro**. Tiada sign-up, tiada langganan, data duduk dalam phone kau.

```
snap → AI kira → betulkan portion → simpan → tengok baki harian
```

---

## Apa yang ada

| Bahagian | Fungsi |
|---|---|
| **Hari Ini** | Ring kalori, baki vs sasaran, bar protein/karbo/lemak, log hidangan |
| **Snap** | Kamera atau galeri → hantar ke 9Router → AI kesan item + kalori |
| **Betulkan** | Setiap item boleh ubah gram (±10%), nama, atau kalori manual |
| **Sejarah** | Carta 14 hari + senarai hari, purata kalori |
| **Tetapan** | Endpoint/model 9Router, sasaran harian, kira BMR automatik, export/import |

Semua dalam Bahasa Melayu. Mobile-first, boleh install sebagai PWA (Add to Home Screen).

---

## Setup pantas (PC)

```bash
# 1. Pastikan 9Router hidup
9router
# → http://localhost:20128

# 2. Hidupkan app
node serve.mjs
# → http://localhost:5173
```

Buka `http://localhost:5173`, cipta password, kemudian:

**Tetapan → Sambungan AI**

| Medan | Nilai |
|---|---|
| Endpoint | `http://localhost:20128/v1` |
| API key | `sk-...` dari dashboard 9Router |
| Model | `super-free` |

Tekan **Uji sambungan**. Kalau hijau, terus boleh snap.

> API key kau ada dalam: `%APPDATA%\9router\db\data.sqlite` → table `apiKeys`.
> Atau buka `http://localhost:20128/dashboard` → API Keys.

---

## Guna dari phone

Dua cara:

### A. Guna di PC (paling laju)

1. `9router` — dah jalan di `http://localhost:20128`
2. `node serve.mjs` — buka `http://localhost:5173`
3. Tetapan: Endpoint `http://localhost:20128/v1`, API key dari dashboard 9Router
4. Terus jalan — 9Router percaya origin `localhost`, jadi tak perlu proxy/tunnel

### B. GitHub Pages + Tunnel (dah deploy)

**Live:** https://mdirwansah99.github.io/kalorisnap/

GitHub Pages guna `https://`. Browser **blok** panggilan https → `http://localhost` / IP LAN. Ada satu lagi halangan: **9Router tolak request yang ada header `Origin`** (anti-CSRF), jadi preflight browser dapat 401.

Sebab tu ada **proxy kecil** di PC kau:

```
phone / GitHub Pages
      │  https
      ▼
Cloudflare Tunnel (trycloudflare.com)
      │  http (loopback)
      ▼
proxy.mjs :5180   ← buang Origin, inject API key sebenar
      │
      ▼
9Router :20128
```

**Keistimewaan:** API key 9Router **tak pernah** masuk ke phone. App guna *token app* sahaja.

#### Hidupkan (2 klik)

1. Buka folder `C:\Users\mdirw\9router-tunnel`
2. Double-click **`MULA.bat`**
3. Ia print:

```
Endpoint : https://xxxx-xxxx.trycloudflare.com/v1
API key  : ef3a....
```

4. Dalam app: **Tetapan → Sambungan AI** → tampal dua nilai tu → **Uji sambungan**.

> ⚠️ URL quick tunnel **bertukar** setiap kali `MULA.bat` dijalankan, dan mati bila PC tidur/restart. Kalau app bagi `Failed to fetch`, jalankan `MULA.bat` semula dan update Endpoint.

#### Nak URL kekal? (Tailscale)

Tailscale kau dah aktif (`laptop-v9vvphfu.tailf4ced9.ts.net`), cuma HTTPS cert belum di-enable:

1. Buka https://login.tailscale.com/admin/dns → **Enable HTTPS Certificates**
2. `tailscale serve --bg --https=443 http://127.0.0.1:5180`
3. Endpoint kekal: `https://laptop-v9vvphfu.tailf4ced9.ts.net/v1`
4. Phone kena ada Tailscale app & login akaun sama

#### Fail dalam `C:\Users\mdirw\9router-tunnel`

| Fail | Fungsi |
|---|---|
| `proxy.mjs` | Jambatan ke 9Router + CORS |
| `config.json` | Token app + API key 9Router (**jangan commit**) |
| `cloudflared.exe` | Tunnel client |
| `mula.ps1` / `MULA.bat` | Start semua + print URL |

Deploy (dah dibuat):

```bash
git push -u origin main
```

GitHub → **Settings → Pages → Deploy from a branch → main / (root)**.

---

## Kiraan kalori — jujur

AI (model vision) anggar dari gambar. Realitinya:

- **Portion** paling selalu tersasar. Sebab tu ada skrin betulkan gram.
- **Lauk berkuah / campur** paling susah — minyak & santan tersembunyi.
- Angka adalah **anggaran**, bukan makmal. Guna untuk trend, bukan angka tepat.

Tip untuk hasil lebih baik:
- Ambil dari atas, cahaya terang
- Letak sudu/garfu sebagai rujukan saiz
- Satu pinggan satu gambar
- Kalau AI bagi 3 item padahal 5 — tekan **+ Item**

---

## Keselamatan (baca ni)

- **Password adalah penghadang ringkas, bukan encryption.** Ia disimpan sebagai hash (PBKDF2-SHA256, 150k iterasi) dalam `localStorage`. Sesiapa yang buka DevTools boleh nampak data. Ia menghalang orang yang pinjam phone — bukan hacker.
- **API key disimpan dalam `localStorage`** phone kau sahaja. Ia **tidak** masuk ke dalam kod, tidak di-commit ke GitHub.
- **Jangan letak key dalam kod** kalau repo public — sesiapa boleh curi dan guna kuota 9Router kau.
- Data tiada di mana-mana server. Backup = **Tetapan → Export JSON**.

---

## Struktur

```
kalorisnap/
├─ index.html            # semua skrin
├─ styles.css            # dark UI, mobile-first
├─ app.js                # logik: auth, AI, log, chart
├─ sw.js                 # offline shell (PWA)
├─ manifest.webmanifest
├─ icon.svg
├─ serve.mjs             # static server untuk test
└─ .nojekyll             # untuk GitHub Pages
```

Tiada build step. Tiada npm install. Edit → refresh.

---

## Troubleshooting

| Masalah | Sebab / jalan |
|---|---|
| `Failed to fetch` | 9Router tak hidup, atau endpoint salah |
| `HTTP 401` | API key salah / kosong |
| `HTTP 410 ModelDeprecated` | Combo `free` dah lapuk — tukar ke `super-free` |
| `Mixed Content` / `blocked` | Halaman https call endpoint http — guna tunnel https |
| AI jawab benda lain | Model tu tak support vision — guna `super-free` |
| Data hilang | `localStorage` dibersihkan browser. Selalu export. |

---

Dibuat untuk kau. Selamat diet. 🥗
