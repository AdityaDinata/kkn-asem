// index.js
// Pastikan di package.json ada:  "type": "module"
// ENV yang dipakai: API_URL, GEMINI_API_KEY, CHROMIUM_PATH (opsional)

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

// ====== Konfigurasi API ======
const API_URL = process.env.API_URL ?? 'https://MakanKecoa-chatbot.hf.space/predict';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
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

function cleanupFile(p) {
  try { fs.unlinkSync(p); } catch {}
}

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

// ====== Filter anti-Markdown WhatsApp ======
function sanitizeForWhatsApp(input) {
  if (!input) return '';

  let s = String(input);

  // 1) Ubah bullet di awal baris: "* " / "- " → "• "
  s = s.replace(/^[\t >-]*\* +/gm, '• ');
  s = s.replace(/^[\t >-]*- +/gm,  '• ');

  // 2) Hilangkan heading markdown (#, ##, ...)
  s = s.replace(/^#{1,6}\s*/gm, '');

  // 3) Hilangkan bold/italic/strike/inline-code
  s = s.replace(/\*\*(.*?)\*\*/gs, '$1');  // **bold**
  s = s.replace(/__(.*?)__/gs, '$1');      // __bold__
  s = s.replace(/_(.*?)_/gs, '$1');        // _italic_
  s = s.replace(/\*(.*?)\*/gs, '$1');      // *italic*
  s = s.replace(/~(.*?)~/gs, '$1');        // ~strike~
  s = s.replace(/`{1,3}([\s\S]*?)`{1,3}/g, '$1'); // `code` atau ```code```

  // 4) Sisa asterisk diganti simbol aman (full-width asterisk/•)
  s = s.replace(/\*/g, '•');

  // 5) Rapikan spasi kosong berlebih di baris
  s = s.replace(/[ \t]+$/gm, '');

  return s;
}

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

// ====== WhatsApp Lifecycle ======
client.on('qr', (qr) => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('✅ Bot WhatsApp siap digunakan!'));
client.on('auth_failure', (m) => console.error('❌ Auth failure:', m));
client.on('disconnected', (r) => console.error('⚠️ Disconnected:', r));
client.initialize();

// ====== Handler Pesan ======
client.on('message', async (message) => {
  const raw = message.body || '';
  const text = raw.toLowerCase().trim();

  // === Lokasi → TPS terdekat
  if (message.type === 'location' && message.location) {
    const { latitude, longitude } = message.location;
    const tpsTerdekat = daftarTPS.reduce((best, tps) => {
      const jarak = hitungJarak(latitude, longitude, tps.lat, tps.lon);
      return !best || jarak < best.jarak ? { ...tps, jarak } : best;
    }, null);

    return message.reply(
      tpsTerdekat
        ? `📍 TPS Terdekat:
${tpsTerdekat.nama}
Jarak: ${tpsTerdekat.jarak.toFixed(2)} km
${tpsTerdekat.link}`
        : '❌ Tidak ditemukan TPS terdekat.'
    );
  }

  // === Menu singkat
  if (text === '#menu' || text === '#help' || text === 'menu') {
    return message.reply(
`Saya bisa:
1. 📸 Deteksi jenis sampah dari gambar
2. 💡 Rekomendasi pengelolaan sampah
3. 🗺️ Tunjukkan TPS terdekat (kirim lokasi atau ketik #tps)`
    );
  }

  // === Sapaan → Gemini (fallback statis jika perlu)
  const sapaan = ['halo','hai','assalamualaikum','selamat pagi','selamat siang','selamat sore','selamat malam'];
  if (sapaan.some(s => text === s || text.startsWith(s))) {
    if (hasGemini) {
      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const res = await model.generateContent(
`Kamu adalah SKARA, asisten pengelolaan sampah untuk warga Karang Rejo.
Balas sapaan singkat (1–2 kalimat), ramah. Setelah itu tampilkan menu di bawah ini.

Menu (tampilkan persis):
Saya bisa:
1. 📸 Deteksi jenis sampah dari gambar
2. 💡 Rekomendasi pengelolaan sampah
3. 🗺️ Tunjukkan TPS terdekat (kirim lokasi atau ketik #tps)`
        );
        let ai = res?.response?.text?.() || '';
        ai = sanitizeForWhatsApp(ai);
        if (ai) return message.reply(ai);
      } catch (e) {
        console.error('❌ Gemini greet error:', e?.message || e);
      }
    }
    return message.reply(
`👋 Hai! Saya SKARA.

Saya bisa:
1. 📸 Deteksi jenis sampah dari gambar
2. 💡 Rekomendasi pengelolaan sampah
3. 🗺️ Tunjukkan TPS terdekat (kirim lokasi atau ketik #tps)

Kirim gambar atau share lokasi ya!`
    );
  }

  // === Daftar TPS
  if (text === '#tps') {
    const list = daftarTPS.map((tps) => `📍 ${tps.nama}\n${tps.link}`).join('\n\n');
    return message.reply(`Daftar lokasi TPS:\n\n${list}`);
  }

  // === Media (gambar) → klasifikasi + rekomendasi Gemini
  if (message.hasMedia) {
    let media;
    try {
      media = await message.downloadMedia();
    } catch (e) {
      console.error('❌ Gagal download media:', e.message);
      return message.reply('❌ Gagal mengunduh gambar. Coba lagi ya.');
    }
    if (!media?.data) return message.reply('⚠️ Tidak ada gambar yang bisa diproses.');
    if (media.mimetype && !media.mimetype.startsWith('image/')) {
      return message.reply('⚠️ Kirim gambar ya, bukan file lain.');
    }

    const filePath = path.join(tempDir, `sampah_${Date.now()}.jpg`);
    try {
      fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));

      const formData = new FormData();
      formData.append('file', fs.createReadStream(filePath));

      const { data } = await axios.post(API_URL, formData, {
        headers: formData.getHeaders(),
        timeout: 60000 // antisipasi cold start
      });

      const parent = data?.parent?.label ?? '-';
      const pConf = Number(data?.parent?.confidence ?? 0);
      const sub = data?.sub?.label ?? '-';
      const sConf = Number(data?.sub?.confidence ?? 0);
      const unsure = !!data?.parent?.uncertain;

      let rekomendasi = hasGemini
        ? await getRekomendasiGemini(nice(sub))
        : 'Aktifkan GEMINI_API_KEY untuk rekomendasi.';
      rekomendasi = sanitizeForWhatsApp(rekomendasi);

      const top3 = (data?.top3_sub ?? [])
        .map((t, i) => `${i + 1}) ${nice(t.label)} (${Number(t.confidence * 100).toFixed(1)}%)`)
        .join('\n');

      await message.reply(
`♻️ Klasifikasi: ${parent} → ${nice(sub)}
• Parent: ${(pConf * 100).toFixed(1)}%${unsure ? ' (ragu)' : ''}
• Sub   : ${(sConf * 100).toFixed(1)}%
${top3 ? `\nTop-3 sub:\n${top3}\n` : ''}
💡 Rekomendasi:
${rekomendasi}`
      );
    } catch (e) {
      console.error('❌ Error kirim ke API HF:', e.message);
      await message.reply('⚠️ Gagal memproses gambar. Pastikan server AI aktif.');
    } finally {
      cleanupFile(filePath);
    }
    return;
  }

  // === Semua teks lain → langsung Gemini (dan disanitasi)
  if (hasGemini && text) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const prompt =
`Kamu adalah SKARA, asisten pengelolaan sampah untuk warga Karang Rejo.
Jawab singkat (maks 4 kalimat), jelas, dan mudah dipahami.
Jika pertanyaan tentang kategori sampah (misal "apakah plastik organik?" atau "kardus termasuk apa?"),
jawab langsung kategori (organik/anorganik/residu/B3 domestik) + 2–3 saran pengelolaan praktis.
Jika pertanyaan di luar topik sampah, tetap jawab ramah lalu arahkan agar relevan.

Pertanyaan pengguna:
"""${raw}"""`;
      const res = await model.generateContent(prompt);
      let ai = res?.response?.text?.() || '';
      ai = sanitizeForWhatsApp(ai);
      if (ai) return message.reply(ai);
    } catch (e) {
      console.error('❌ Gemini QA error:', e?.message || e);
    }
  }

  // === Fallback jika Gemini nonaktif/gagal
  if (text) {
    return message.reply(
      'Maaf aku belum bisa jawab sekarang. Aktifkan GEMINI_API_KEY atau coba lagi nanti.'
    );
  }
});

// ====== Gemini Helper ======
async function getRekomendasiGemini(jenis) {
  if (!hasGemini) return 'GEMINI_API_KEY belum di-set.';
  const prompt =
`Jenis sampah: ${jenis}
Berikan 3 cara pengelolaan terbaik (poin).
Gunakan bullet dengan simbol "•" (bukan asterisk).
Bahasa santai dan mudah dipahami masyarakat.`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    let teks = result?.response?.text?.() || '';
    return sanitizeForWhatsApp(teks);
  } catch (err) {
    console.error('❌ Gemini error:', err?.message || err);
    return 'AI sedang sibuk, coba lagi nanti.';
  }
}

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
