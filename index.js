// index.js
// -- Pastikan di package.json ada: "type": "module"
// -- ENV: API_URL, GEMINI_API_KEY, GEMINI_MODEL (opsional), CHROMIUM_PATH (opsional), DEBUG=1 (opsional)

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

// ====== Path & dotenv (AMAN untuk PM2) ======
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.join(__dirname, '.env') });

// ====== Konfigurasi API ======
const API_URL = process.env.API_URL ?? 'https://MakanKecoa-chatbot.hf.space/predict';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const DEBUG = process.env.DEBUG === '1';

const genAI = GEMINI_KEY ? new GoogleGenerativeAI(GEMINI_KEY) : null;
const log = (...a) => { if (DEBUG) console.log('[SKARA]', ...a); };

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
const hasGemini = !!genAI;

// Escape karakter formatting WA biar nggak auto-bold/italic
const sanitize = (s = '') => (s ?? '').replace(/([*_`~>])/g, '\\$1');

// Deteksi “pertanyaan dasar seputar sampah” (lebih longgar)
const qaTriggers = /\b(apakah|apa|apa\s*itu|gimana|bagaimana|termasuk|masuk|dibuang\s*ke|ke\s*mana|dimana|di\s*mana)\b/i;
const wasteTerms = /\b(sampah|organik|anorganik|b3|residu|plastik|kaca|kertas|kardus|logam|minyak\s*jelantah|oli|popok|styrofoam|stirofoam|e-?waste|elektronik|baterai|aki|kompos|bank\s*sampah|tps|tpst|tpa|limbah)\b/i;
const isBasicWasteQuestion = (t = '') => {
  const s = (t || '').toLowerCase();
  return wasteTerms.test(s) && (qaTriggers.test(s) || s.includes('?') || /termasuk\s*apa/.test(s));
};

// ====== Daftar TPS (contoh) ======
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

// ====== WhatsApp Lifecycle ======
client.on('qr', (qr) => qrcode.generate(qr, { small: true }));
client.on('ready', () => {
  console.log('✅ Bot WhatsApp siap digunakan!');
  console.log('🔑 Gemini:', hasGemini ? 'ON' : 'OFF', '• Model:', GEMINI_MODEL);
});
client.on('auth_failure', (m) => console.error('❌ Auth failure:', m));
client.on('disconnected', (r) => console.error('⚠️ Disconnected:', r));
client.initialize();

// ====== Handler Pesan ======
client.on('message', async (message) => {
  const textRaw = message.body || '';
  const text = textRaw.toLowerCase().trim();
  log('RX', { from: message.from, type: message.type, hasMedia: message.hasMedia, text: textRaw });

  // Handler lokasi → TPS terdekat
  if (message.type === 'location' && message.location) {
    const { latitude, longitude } = message.location;
    const tpsTerdekat = daftarTPS.reduce((best, tps) => {
      const jarak = hitungJarak(latitude, longitude, tps.lat, tps.lon);
      return !best || jarak < best.jarak ? { ...tps, jarak } : best;
    }, null);

    return message.reply(
      tpsTerdekat
        ? `📍 TPS Terdekat:\n${tpsTerdekat.nama}\nJarak: ${tpsTerdekat.jarak.toFixed(2)} km\n${tpsTerdekat.link}`
        : '❌ Tidak ditemukan TPS terdekat.'
    );
  }

  // Sapaan singkat
  const sapaan = ['halo', 'hai', 'assalamualaikum', 'selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam'];
  if (sapaan.includes(text)) {
    return message.reply(
      `👋 Hai! Saya *SKARA* (Sampah Karang Rejo Assistant).\n\n` +
      `Saya bisa:\n` +
      `1. 📸 Deteksi jenis sampah dari gambar\n` +
      `2. 💡 Rekomendasi pengelolaan sampah\n` +
      `3. 🗺️ Tunjukkan TPS terdekat (kirim lokasi)\n\n` +
      `Kirim gambar sampah 📷 atau share lokasi 📍 ya!`
    );
  }

  // Daftar TPS
  if (text === '#tps') {
    const list = daftarTPS.map((tps) => `📍 ${tps.nama}\n${tps.link}`).join('\n\n');
    return message.reply(`Daftar lokasi TPS:\n\n${list}`);
  }

  // ====== Pertanyaan Dasar Seputar Sampah (pakai Gemini) ======
  if (!message.hasMedia && text) {
    if (isBasicWasteQuestion(textRaw)) {
      log('QA matched');
      if (!hasGemini) {
        return message.reply('Aktifkan *GEMINI_API_KEY* agar saya bisa menjawab pertanyaan seputar sampah.');
      }
      try {
        try { if (typeof message.react === 'function') await message.react('💬'); } catch {}
        const jawaban = await jawabPertanyaanDasarGemini(textRaw);
        return message.reply(sanitize(jawaban));
      } catch (e) {
        console.error('❌ Gemini QA error:', e?.message || e);
        return message.reply('⚠️ Gagal menjawab saat ini. Coba lagi ya.');
      }
    } else {
      log('QA not matched');
    }
  }

  // ====== Media (gambar) → Klasifikasi + rekomendasi ======
  if (message.hasMedia) {
    let media;
    try {
      media = await message.downloadMedia();
    } catch (e) {
      console.error('❌ Gagal download media:', e.message);
      return message.reply('❌ Gagal mengunduh gambar. Coba lagi ya.');
    }
    if (!media?.data) return message.reply('⚠️ Tidak ada gambar yang bisa diproses.');

    // Optional: filter hanya gambar
    if (media.mimetype && !media.mimetype.startsWith('image/')) {
      return message.reply('⚠️ Kirim gambar ya, bukan file lain.');
    }

    const buffer = Buffer.from(media.data, 'base64');
    const filePath = path.join(tempDir, `sampah_${Date.now()}.jpg`);
    fs.writeFileSync(filePath, buffer);

    try {
      const formData = new FormData();
      formData.append('file', fs.createReadStream(filePath));

      // Timeout 60s (HF Space bisa cold start)
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

      await message.reply(
        `♻️ Klasifikasi: *${parent} → ${nice(sub)}*\n` +
          `• Parent: ${(pConf * 100).toFixed(1)}%${unsure ? ' (ragu)' : ''}\n` +
          `• Sub   : ${(sConf * 100).toFixed(1)}%\n` +
          (top3 ? `\nTop-3 sub:\n${top3}\n` : '') +
          `\n💡 Rekomendasi:\n${sanitize(rekomendasi)}`
      );
    } catch (e) {
      console.error('❌ Error kirim ke API HF:', e.message);
      await message.reply('⚠️ Gagal memproses gambar. Pastikan server AI aktif.');
    } finally {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
});

// ====== Gemini Helper: Rekomendasi dari jenis (hasil klasifikasi gambar) ======
async function getRekomendasiGemini(jenis) {
  if (!hasGemini) return 'GEMINI_API_KEY belum di-set.';
  const prompt =
`Kamu adalah asisten persampahan untuk masyarakat (Indonesia).
Jenis sampah: ${jenis}
Berikan 3 cara pengelolaan terbaik (poin).
• Tulis ringkas, jelas, ramah.
• Hindari istilah teknis berlebihan.
• Kalau berbahaya, tekankan kehati-hatian.`;

  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const result = await model.generateContent(prompt);
    const teks = result?.response?.text();
    return teks || '⚠️ Tidak ada rekomendasi dari AI.';
  } catch (err) {
    console.error('❌ Gemini error:', err?.message || err);
    return '⚠️ AI sedang sibuk, coba lagi nanti.';
  }
}

// ====== Gemini Helper: Jawab pertanyaan dasar seputar sampah ======
async function jawabPertanyaanDasarGemini(pertanyaan) {
  const prompt =
`Peran: Kamu adalah SKARA, asisten persampahan untuk warga Indonesia.
Tugas: Jawab pertanyaan dasar seputar sampah secara singkat dan tepat.
Aturan:
- Fokus domain persampahan: kategori (organik/anorganik/residu/B3), cara buang, daur ulang, kompos, TPS, e-waste, minyak jelantah, dsb.
- Jika pertanyaan "X termasuk apa?", jawab salah satu: organik/anorganik/residu/B3 + alasan 1 kalimat + saran ringkas.
- Maksimal 5 kalimat ATAU 5 poin pendek.
- Tanpa disclaimer, tanpa menyebut sumber, tanpa menyebut fitur bot.
- Jika di luar topik persampahan, jawab singkat: "Maaf, pertanyaan di luar topik pengelolaan sampah."

Pertanyaan: """${pertanyaan}"""`;

  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const res = await model.generateContent(prompt);
    const teks = res?.response?.text() || 'Maaf, belum bisa menjawab saat ini.';
    return teks;
  } catch (err) {
    console.error('❌ Gemini QA error:', err?.message || err);
    throw err;
  }
}
