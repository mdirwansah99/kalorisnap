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

### A. WiFi sama (paling laju, untuk test)
1. `node serve.mjs` — ia print URL `http://192.168.x.x:5173`
2. Buka URL tu dalam phone
3. Endpoint: `http://192.168.x.x:20128/v1`

⚠️ XAMPP-style http ni **tak boleh** install PWA penuh (service worker perlu https/localhost), tapi app tetap jalan.

### B. GitHub Pages + Tunnel (produk sebenar)

GitHub Pages guna `https://`. Browser **blok** panggilan dari https ke `http://localhost` atau IP LAN (mixed content + Private Network Access). Jadi kau **wajib** bagi 9Router satu URL https:

1. Buka `http://localhost:20128/dashboard`
2. **Tunnel** → **Enable**
3. Copy URL, contoh `https://abc-def.trycloudflare.com`
4. Dalam app: Endpoint = `https://abc-def.trycloudflare.com/v1`
5. API key sama, tekan **Uji sambungan**

Lepas tu deploy:

```bash
git init
git add .
git commit -m "KaloriSnap"
git branch -M main
git remote add origin https://github.com/<username>/kalorisnap.git
git push -u origin main
```

GitHub → **Settings → Pages → Source: Deploy from a branch → main / (root)**.
App akan hidup di `https://<username>.github.io/kalorisnap/`.

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
