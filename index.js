// index.js
// -- Pastikan di package.json ada:  "type": "module"
// -- ENV: API_URL, GEMINI_API_KEY, CHROMIUM_PATH (opsional), LOG_LEVEL (error|warn|info|debug), DEBUG (opsional: whatsapp-web.js:*)

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
import { randomUUID } from 'crypto';

config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== Konfigurasi API ======
const API_URL = process.env.API_URL ?? 'https://MakanKecoa-chatbot.hf.space/predict';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const genAI = GEMINI_KEY ? new GoogleGenerativeAI(GEMINI_KEY) : null;
const hasGemini = !!genAI;

// ====== Logger Sederhana (console + file JSONL per hari) ======
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const LEVEL_NAME = (process.env.LOG_LEVEL || 'info').toLowerCase();
const MIN_LEVEL = LEVELS[LEVEL_NAME] ?? 2;

function logWrite(line) {
  const file = path.join(logsDir, `${new Date().toISOString().slice(0, 10)}.log`);
  fs.appendFile(file, line + '\n', () => {});
}

function log(level, msg, meta = undefined) {
  const lv = LEVELS[level] ?? 2;
  if (lv > MIN_LEVEL) return;
  const entry = { ts: new Date().toISOString(), level, msg, ...meta };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(`[${entry.ts}] [${level}] ${msg}`, meta?.err || meta || '');
  } else {
    console.log(`[${entry.ts}] [${level}] ${msg}`, meta || '');
  }
  logWrite(line);
}

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

const nice = (s = '') => s.replace(/_/g, ' ').trim();

// ====== FILTER WA (pakai regex kamu persis) ======
function filterWA(input = '') {
  const part = String(input ?? '');
  let text = part.trim()
    .replace(/`{3}[\s\S]*?`{3}/g, '')                        // Hapus blok kode
    .replace(/`([^`\n]+)`/g, '$1')                           // Hapus inline code
    .replace(/\*\*(.*?)\*\*/g, '*$1*')                       // Ubah markdown bold jadi WhatsApp bold
    .replace(/__(.*?)__/g, '*$1*')                           // Ubah __teks__ jadi *teks*
    .replace(/~~(.*?)~~/g, '~$1~')                           // Ubah markdown strikethrough jadi WhatsApp
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1: $2')                // Ubah [teks](link) jadi teks: link
    .replace(/[-*+]\s+/g, '• ')                              // Bullet list
    .replace(/\d+\.\s+/g, '')                                // Hapus numbering list
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')                              // Trim spasi di akhir baris
    .replace(/\n[ \t]+/g, '\n')                              // Trim spasi di awal baris
    .replace(/\n{3,}/g, '\n\n')                              // Maks 2 newline
    .replace(/[^\x00-\x7F]+/g, '')                           // Hapus emoji/asing
    .replace(/[^\w\s.,:;!?'"()\-\•\[\]`~<>\/\\]+/g, '')      // Hapus karakter aneh
    .trim();
  return text;
}

// ====== Daftar TPS (contoh) ======
const daftarTPS = [
  { nama: 'TPSU 1', lat: -1.246358, lon: 116.838075, link: 'https://maps.app.goo.gl/HzWyFLVPHThJ86Pz6' },
  { nama: 'TPSU 2', lat: -1.246242, lon: 116.836864, link: 'https://maps.app.goo.gl/xyZHbSWoERRXr713A' },
  { nama: 'TPSU 3', lat: -1.243908, lon: 116.835673, link: 'https://maps.app.goo.gl/GnwcmoXMZz1hvGQW8' },
  { nama: 'TPSU 4', lat: -1.246265, lon: 116.83694,  link: 'https://maps.app.goo.gl/yNMgoDeeM3kwR4Cr7' },
  { nama: 'TPSU 5', lat: -1.24577,  lon: 116.837739, link: 'https://maps.app.goo.gl/13eHSbnnMwe1AvG68' },
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
client.on('qr', (qr) => {
  log('info', 'QR generated');
  qrcode.generate(qr, { small: true });
});
client.on('ready', () => log('info', 'Bot WhatsApp siap digunakan!', { pid: process.pid, node: process.versions.node, hasGemini }));
client.on('auth_failure', (m) => log('error', 'Auth failure', { err: m }));
client.on('disconnected', (r) => log('warn', 'Disconnected', { reason: r }));
client.initialize();

// ====== Handler Pesan ======
client.on('message', async (message) => {
  // Trace ID untuk jejak log per pesan
  const rid = randomUUID().slice(0, 8);
  const textRaw = message.body || '';
  const text = textRaw.toLowerCase().trim();

  log('info', 'Incoming message', {
    rid,
    from: message.from,
    type: message.type,
    hasMedia: message.hasMedia,
    textPreview: textRaw.slice(0, 140)
  });

  try {
    // ====== Handler lokasi → TPS terdekat ======
    if (message.type === 'location' && message.location) {
      const { latitude, longitude } = message.location;
      log('debug', 'Location received', { rid, latitude, longitude });

      const tpsTerdekat = daftarTPS.reduce((best, tps) => {
        const jarak = hitungJarak(latitude, longitude, tps.lat, tps.lon);
        return !best || jarak < best.jarak ? { ...tps, jarak } : best;
      }, null);

      log('info', 'Nearest TPS computed', { rid, found: !!tpsTerdekat, tps: tpsTerdekat?.nama, jarak: tpsTerdekat?.jarak });
      return message.reply(
        tpsTerdekat
          ? `📍 TPS Terdekat:\n${tpsTerdekat.nama}\nJarak: ${tpsTerdekat.jarak.toFixed(2)} km\n${tpsTerdekat.link}`
          : '❌ Tidak ditemukan TPS terdekat.'
      );
    }

    // ====== Sapaan singkat ======
    const sapaan = ['halo', 'hai', 'assalamualaikum', 'selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam'];
    if (sapaan.includes(text)) {
      log('debug', 'Greeting detected', { rid });
      return message.reply(
        `👋 Hai! Saya *SKARA* (Sampah Karang Rejo Assistant).\n\n` +
        `Saya bisa:\n` +
        `1. 📸 Deteksi jenis sampah dari gambar\n` +
        `2. 💡 Rekomendasi pengelolaan sampah\n` +
        `3. 🗺️ Tunjukkan TPS terdekat (kirim lokasi)\n\n` +
        `Kirim gambar sampah 📷 atau share lokasi 📍 ya!`
      );
    }

    // ====== Daftar TPS ======
    if (text === '#tps') {
      log('debug', 'List TPS requested', { rid });
      const list = daftarTPS.map((tps) => `📍 ${tps.nama}\n${tps.link}`).join('\n\n');
      return message.reply(`Daftar lokasi TPS:\n\n${list}`);
    }

    // ====== Media (gambar) → Klasifikasi + rekomendasi ======
    if (message.hasMedia) {
      let media;
      try {
        await message.react('🖼️');
        media = await message.downloadMedia();
      } catch (e) {
        log('error', 'Gagal download media', { rid, err: e?.stack || e?.message || e });
        return message.reply('❌ Gagal mengunduh gambar. Coba lagi ya.');
      }
      if (!media?.data) {
        log('warn', 'No media data', { rid });
        return message.reply('⚠️ Tidak ada gambar yang bisa diproses.');
      }

      if (media.mimetype && !media.mimetype.startsWith('image/')) {
        log('warn', 'Non-image media blocked', { rid, mimetype: media.mimetype });
        return message.reply('⚠️ Kirim gambar ya, bukan file lain.');
      }

      const buffer = Buffer.from(media.data, 'base64');
      const filePath = path.join(tempDir, `sampah_${Date.now()}.jpg`);
      fs.writeFileSync(filePath, buffer);
      log('debug', 'Media saved', { rid, filePath });

      try {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath));

        const t0 = Date.now();
        const resp = await axios.post(API_URL, formData, {
          headers: formData.getHeaders(),
          timeout: 60000
        });
        const latency = Date.now() - t0;

        const data = resp?.data ?? {};
        const parent = data?.parent?.label ?? '-';
        const pConf = Number(data?.parent?.confidence ?? 0);
        const sub = data?.sub?.label ?? '-';
        const sConf = Number(data?.sub?.confidence ?? 0);
        const unsure = !!data?.parent?.uncertain;

        log('info', 'HF API success', {
          rid, status: resp?.status, latency_ms: latency,
          parent, pConf, sub, sConf, unsure
        });

        const rekomendasi = hasGemini
          ? await getRekomendasiGemini(nice(sub), rid)
          : 'Aktifkan GEMINI_API_KEY untuk rekomendasi.';

        const top3 = (data?.top3_sub ?? [])
          .map((t, i) => `${i + 1}) ${nice(t.label)} (${Number(t.confidence * 100).toFixed(1)}%)`)
          .join('\n');

        await message.reply(
          `♻️ Klasifikasi: *${parent} → ${nice(sub)}*\n` +
          `• Parent: ${(pConf * 100).toFixed(1)}%${unsure ? ' (ragu)' : ''}\n` +
          `• Sub   : ${(sConf * 100).toFixed(1)}%\n` +
          (top3 ? `\nTop-3 sub:\n${top3}\n` : '') +
          `\n💡 Rekomendasi:\n${filterWA(rekomendasi)}`
        );
      } catch (e) {
        log('error', 'Error kirim ke API HF', { rid, err: e?.stack || e?.message || e });
        await message.reply('⚠️ Gagal memproses gambar. Pastikan server AI aktif.');
      } finally {
        try { fs.unlinkSync(filePath); log('debug', 'Temp file deleted', { rid, filePath }); } catch {}
      }
      return;
    }

    // ====== Fallback teks → Gemini (khusus topik persampahan) ======
    if (!message.hasMedia && text) {
      if (!hasGemini) {
        log('warn', 'No GEMINI_API_KEY set', { rid });
        return message.reply('Aktifkan *GEMINI_API_KEY* agar saya bisa menjawab pertanyaan seputar sampah.');
      }
      try {
        await message.react('💬');
        const t0 = Date.now();
        const jawaban = await jawabPertanyaanDasarGemini(textRaw, rid);
        const latency = Date.now() - t0;
        log('info', 'Gemini QA success', { rid, latency_ms: latency, chars: jawaban?.length ?? 0 });
        return message.reply(filterWA(jawaban));
      } catch (e) {
        log('error', 'Gemini QA error', { rid, err: e?.stack || e?.message || e });
        return message.reply('⚠️ Gagal menjawab saat ini. Coba lagi ya.');
      }
    }
  } catch (err) {
    log('error', 'Uncaught handler error', { rid, err: err?.stack || err?.message || err });
    try { await message.reply('⚠️ Terjadi kesalahan tak terduga.'); } catch {}
  }
});

// ====== Gemini Helper: Rekomendasi dari jenis (hasil klasifikasi gambar) ======
async function getRekomendasiGemini(jenis, rid) {
  if (!hasGemini) return 'GEMINI_API_KEY belum di-set.';
  const prompt =
`Kamu adalah asisten persampahan untuk masyarakat (Indonesia).
Jenis sampah: ${jenis}
Berikan 3 cara pengelolaan terbaik (poin).
• Tulis ringkas, jelas, ramah.
• Hindari istilah teknis berlebihan.
• Kalau berbahaya, tekankan kehati-hatian.`;

  try {
    const t0 = Date.now();
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    const teks = result?.response?.text();
    const latency = Date.now() - t0;
    log('debug', 'Gemini recommend success', { rid, latency_ms: latency, jenis, ok: !!teks });
    return teks || '⚠️ Tidak ada rekomendasi dari AI.';
  } catch (err) {
    log('error', 'Gemini recommend error', { rid, err: err?.stack || err?.message || err });
    return '⚠️ AI sedang sibuk, coba lagi nanti.';
  }
}

// ====== Gemini Helper: Jawab pertanyaan dasar seputar sampah ======
async function jawabPertanyaanDasarGemini(pertanyaan, rid) {
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
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const res = await model.generateContent(prompt);
    const teks = res?.response?.text() || 'Maaf, belum bisa menjawab saat ini.';
    return teks;
  } catch (err) {
    // dilempar ke caller supaya dicatat juga di sana
    throw err;
  }
}

// ====== Safety: Global error handlers ======
process.on('unhandledRejection', (reason) => {
  log('error', 'UNHANDLED REJECTION', { err: (reason && reason.stack) || String(reason) });
});
process.on('uncaughtException', (err) => {
  log('error', 'UNCAUGHT EXCEPTION', { err: err?.stack || err?.message || err });
});

// ====== Log startup ======
log('info', 'Bot starting', {
  pid: process.pid,
  node: process.versions.node,
  logLevel: LEVEL_NAME,
  hasGemini
});
