// index.js
// Pastikan di package.json ada: "type": "module"
// ENV: API_URL, GEMINI_API_KEY, GEMINI_MODEL (opsional), CHROMIUM_PATH (opsional)

import wwebjs from 'whatsapp-web.js';
const { Client, LocalAuth } = wwebjs;

import qrcode from 'qrcode-terminal';
import axios from 'axios';
import * as fs from 'fs';
import FormData from 'form-data';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== ENV & init ======
const API_URL = (process.env.API_URL || 'https://MakanKecoa-chatbot.hf.space/predict').trim();
const GEMINI_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();

const genAI = GEMINI_KEY ? new GoogleGenerativeAI(GEMINI_KEY) : null;
const hasGemini = !!genAI;

// ====== WhatsApp Client ======
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
  puppeteer: {
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer'
    ]
  }
});

// ====== Utils ======
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

const nice = (s = '') => s.replace(/_/g, ' ');
function sanitizeWA(s = '') { return s.replace(/([_*~`>])/g, '\\$1'); }
async function safeReply(message, text) { return message.reply(sanitizeWA(text ?? '')); }
function cleanupFile(p) { try { fs.unlinkSync(p); } catch {} }

// ====== Data TPS contoh ======
const daftarTPS = [
  { nama: 'TPSU 1', lat: -1.246358, lon: 116.838075, link: 'https://maps.app.goo.gl/HzWyFLVPHThJ86Pz6' },
  { nama: 'TPSU 2', lat: -1.246242, lon: 116.836864, link: 'https://maps.app.goo.gl/xyZHbSWoERRXr713A' },
  { nama: 'TPSU 3', lat: -1.243908, lon: 116.835673, link: 'https://maps.app.goo.gl/GnwcmoXMZz1hvGQW8' },
  { nama: 'TPSU 4', lat: -1.246265, lon: 116.836940, link: 'https://maps.app.goo.gl/yNMgoDeeM3kwR4Cr7' },
  { nama: 'TPSU 5', lat: -1.245770, lon: 116.837739, link: 'https://maps.app.goo.gl/13eHSbnnMwe1AvG68' },
  { nama: 'TPSU 6', lat: -1.243526, lon: 116.843712, link: 'https://maps.app.goo.gl/jE81HCR8JmUyLaBB9' },
  { nama: 'TPSU 7', lat: -1.244069, lon: 116.846743, link: 'https://maps.app.goo.gl/Gi3eDfPDa1J4vACbA' },
  { nama: 'TPSU 8', lat: -1.244453, lon: 116.843198, link: 'https://maps.app.goo.gl/2WNpmWB2sAw8aT856' },
  { nama: 'TPSU 9', lat: -1.244379, lon: 116.839902, link: 'https://maps.app.goo.gl/SzVbNQSLemnmEMYn9' }
];

function hitungJarak(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ====== Gemini helpers (SDK lama) ======
function isKeyInvalidError(err) {
  const m = (err?.message || '').toLowerCase();
  return m.includes('api key not valid') || m.includes('api_key_invalid');
}
const withTimeout = (p, ms = 15000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`Gemini timeout ${ms}ms`)), ms))]);

async function askGemini25Strict(prompt) {
  if (!genAI) throw new Error('Gemini not initialized');
  console.log('[Gemini] CALL (strict) model =', GEMINI_MODEL);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
  const res = await withTimeout(model.generateContent(prompt), 15000);
  const txt = res?.response?.text?.() || '';
  return txt.trim();
}

async function askGeminiPrefer25(prompt) {
  if (!genAI) throw new Error('Gemini not initialized');
  const prefer = GEMINI_MODEL || 'gemini-2.5-flash';
  try {
    console.log('[Gemini] TRY', prefer);
    const model = genAI.getGenerativeModel({ model: prefer });
    const res = await withTimeout(model.generateContent(prompt), 15000);
    const out = res?.response?.text?.() || '';
    if (out.trim()) return out.trim();
    throw new Error('Empty response');
  } catch (e) {
    if (isKeyInvalidError(e)) throw e;
    const fb = 'gemini-1.5-flash';
    console.warn('⚠️ Prefer failed:', prefer, '-', e?.message || e, '➡️ Fallback:', fb);
    const model2 = genAI.getGenerativeModel({ model: fb });
    const res2 = await withTimeout(model2.generateContent(prompt), 15000);
    return (res2?.response?.text?.() || '').trim();
  }
}

async function getRekomendasiGemini(jenis) {
  if (!hasGemini) return 'GEMINI_API_KEY belum di-set.';
  const prompt =
`Jenis sampah: ${jenis}
Berikan 3 cara pengelolaan terbaik (poin).
Format:
• ...
• ...
• ...
Bahasa santai dan mudah dipahami masyarakat.`;
  try {
    const ai = await askGeminiPrefer25(prompt);
    return ai || '⚠️ Tidak ada rekomendasi dari AI.';
  } catch (err) {
    console.error('❌ Gemini error:', err?.message || err);
    if (isKeyInvalidError(err)) return '⚠️ API kunci tidak valid. Hubungi admin.';
    return '⚠️ AI sedang sibuk, coba lagi nanti.';
  }
}

// ====== Lifecycle ======
client.on('qr', (qr) => qrcode.generate(qr, { small: true }));
client.on('ready', () => {
  console.log('[BOOT]', __filename);
  console.log('✅ Bot WhatsApp siap digunakan!');
  console.log('[BOOT] SDK = @google/generative-ai, MODEL =', GEMINI_MODEL);
  console.log('[BOOT] GEMINI KEY tail =', GEMINI_KEY ? GEMINI_KEY.slice(-4) : 'EMPTY');
  console.log('[BOOT] API_URL =', API_URL);
});
client.on('auth_failure', (m) => console.error('❌ Auth failure:', m));
client.on('disconnected', (r) => console.error('⚠️ Disconnected:', r));
client.initialize();

// ====== Handler Pesan ======
client.on('message', async (message) => {
  const textRaw = message.body ?? '';
  const text = textRaw.toLowerCase().trim();
  console.log('[MSG]', { type: message.type, from: message.from, body: textRaw.slice(0, 120) });

  // Debug cmds
  if (text === '#ping') return safeReply(message, 'pong');

  if (text === '#test25') {
    if (!hasGemini) return safeReply(message, 'GEMINI_API_KEY belum terpasang.');
    try {
      const out = await askGeminiPrefer25('Balas persis: 25 OK');
      return safeReply(message, out || 'no text');
    } catch (e) {
      console.error('❌ Test25:', e?.message || e);
      return safeReply(message, isKeyInvalidError(e) ? 'API key invalid. Cek .env' : `Gemini error: ${e?.message || e}`);
    }
  }

  if (text === '#force25') {
    if (!hasGemini) return safeReply(message, 'GEMINI_API_KEY belum terpasang.');
    try {
      const out = await askGemini25Strict('Balas persis: FORCE 25 OK');
      return safeReply(message, out || 'no text');
    } catch (e) {
      console.error('❌ force25:', e?.message || e);
      return safeReply(message, isKeyInvalidError(e)
        ? 'API key invalid / 2.5 ditolak oleh project key.'
        : `Error 2.5: ${e?.message || e}`);
    }
  }

  // Lokasi → TPS terdekat
  if (message.type === 'location' && message.location) {
    const { latitude, longitude } = message.location;
    const tpsTerdekat = daftarTPS.reduce((best, tps) => {
      const jarak = hitungJarak(latitude, longitude, tps.lat, tps.lon);
      return !best || jarak < best.jarak ? { ...tps, jarak } : best;
    }, null);

    return safeReply(
      message,
      tpsTerdekat
        ? `📍 TPS Terdekat:\n${tpsTerdekat.nama}\nJarak: ${tpsTerdekat.jarak.toFixed(2)} km\n${tpsTerdekat.link}`
        : '❌ Tidak ditemukan TPS terdekat.'
    );
  }

  // Sapaan → Gemini (fallback statis)
  const sapaan = ['halo', 'hai', 'assalamualaikum', 'selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam'];
  if (sapaan.includes(text)) {
    if (hasGemini) {
      try {
        const ai = await askGeminiPrefer25(
`Kamu adalah SKARA, asisten pengelolaan sampah untuk warga.
Balas sapaan singkat ramah. Hanya seputar layanan sampah. Di akhir, tampilkan menu berikut persis:

Saya bisa:
1. 📸 Deteksi jenis sampah dari gambar
2. 💡 Rekomendasi pengelolaan sampah
3. 🗺️ Tunjukkan TPS terdekat (kirim lokasi)`
        );
        if (ai) return safeReply(message, ai);
      } catch (e) {
        console.error('❌ Gemini greet error:', e?.message || e);
      }
    }
    return safeReply(
      message,
      `👋 Hai! Saya SKARA (Sampah Karang Rejo Assistant).

Saya bisa:
1. 📸 Deteksi jenis sampah dari gambar
2. 💡 Rekomendasi pengelolaan sampah
3. 🗺️ Tunjukkan TPS terdekat (kirim lokasi)

Kirim gambar sampah 📷 atau share lokasi 📍 ya!`
    );
  }

  // Daftar TPS
  if (text === '#tps') {
    const list = daftarTPS.map((tps) => `📍 ${tps.nama}\n${tps.link}`).join('\n\n');
    return safeReply(message, `Daftar lokasi TPS:\n\n${list}`);
  }

  // Media (gambar) → klasifikasi + rekomendasi
  if (message.hasMedia) {
    let media;
    try {
      media = await message.downloadMedia();
    } catch (e) {
      console.error('❌ Gagal download media:', e.message);
      return safeReply(message, '❌ Gagal mengunduh gambar. Coba lagi ya.');
    }
    if (!media?.data) return safeReply(message, '⚠️ Tidak ada gambar yang bisa diproses.');
    if (media.mimetype && !media.mimetype.startsWith('image/')) {
      return safeReply(message, '⚠️ Kirim gambar ya, bukan file lain.');
    }

    const filePath = path.join(tempDir, `sampah_${Date.now()}.jpg`);
    try {
      fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
      const formData = new FormData();
      formData.append('file', fs.createReadStream(filePath));

      const { data } = await axios.post(API_URL, formData, {
        headers: formData.getHeaders(),
        timeout: 60000
      });

      const parent = data?.parent?.label ?? '-';
      const pConf = Number(data?.parent?.confidence ?? 0);
      const sub = data?.sub?.label ?? '-';
      const sConf = Number(data?.sub?.confidence ?? 0);
      const unsure = !!data?.parent?.uncertain;

      const rekomendasi = hasGemini
        ? await getRekomendasiGemini(nice(sub))
        : 'Aktifkan GEMINI_API_KEY untuk rekomendasi.';

      const top3 = (data?.top3_sub ?? [])
        .map((t, i) => `${i + 1}) ${nice(t.label)} (${Number(t.confidence * 100).toFixed(1)}%)`)
        .join('\n');

      await safeReply(
        message,
        `♻️ Klasifikasi: *${parent} → ${nice(sub)}*\n` +
        `• Parent: ${(pConf * 100).toFixed(1)}%${unsure ? ' (ragu)' : ''}\n` +
        `• Sub   : ${(sConf * 100).toFixed(1)}%\n` +
        (top3 ? `\nTop-3 sub:\n${top3}\n` : '') +
        `\n💡 Rekomendasi:\n${rekomendasi}`
      );
      return;
    } catch (e) {
      console.error('❌ Error kirim ke API HF:', e.message);
      await safeReply(message, '⚠️ Gagal memproses gambar. Pastikan server AI aktif.');
    } finally {
      cleanupFile(filePath);
    }
  }

  // Teks generik → selalu lewat Gemini (biar Gemini yang filter topik)
  if (hasGemini && text) {
    try {
      const ai = await askGeminiPrefer25(
`Anda adalah SKARA, asisten WhatsApp untuk pengelolaan sampah.
Aturan:
- Jawab HANYA jika pertanyaannya terkait sampah (jenis/kategori, organik–anorganik–residu–B3, kompos/daur ulang, TPS).
- Jika di luar topik, balas kalimat penolakan singkat: "Maaf, saya hanya bantu topik sampah."
- Jawab ringkas, jelas, dan aplikatif untuk warga.
- Jika klasifikasi seperti "apakah plastik organik" / "kardus termasuk apa", jawab kategori + 1–3 tips singkat.

Pertanyaan pengguna:
"${textRaw}"

Balas dalam 1–5 baris.`
      );
      return safeReply(message, ai || '⚠️ Maaf, belum bisa menjawab. Coba tanya ulang seputar sampah ya.');
    } catch (e) {
      console.error('❌ Gemini QA error:', e?.message || e);
      return safeReply(message, isKeyInvalidError(e) ? '⚠️ API key invalid. Cek .env' : '⚠️ AI error. Coba lagi sebentar ya.');
    }
  }

  return safeReply(message, '👋 Hai! Tanyakan hal seputar *sampah* ya. Contoh: "kardus termasuk apa?", "plastik organik atau anorganik?"');
});

// ====== Graceful shutdown ======
process.on('SIGINT', async () => {
  console.log('🔻 SIGINT diterima. Menutup client...');
  try { await client.destroy(); } catch {}
  process.exit(0);
});
process.on('SIGTERM', async () => {
  console.log('🔻 SIGTERM diterima. Menutup client...');
  try { await client.destroy(); } catch {}
  process.exit(0);
});
