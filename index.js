import { Client } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { GoogleGenAI } from '@google/genai';

config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== Konfigurasi API ======
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:8000/predict';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const client = new Client({
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
const nice = (s='') => s.replace(/_/g, ' ');

// ====== Daftar TPS ======
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
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ====== WhatsApp Lifecycle ======
client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('✅ Bot WhatsApp siap digunakan!'));
client.initialize();

// ====== Handler Pesan ======
client.on('message', async (message) => {
  const text = message.body?.toLowerCase().trim();

  // Jika kirim lokasi
  if (message.type === 'location') {
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

  // Jika sapaan
  const sapaan = ['halo','hai','assalamualaikum','selamat pagi','selamat siang','selamat sore','selamat malam'];
  if (sapaan.includes(text)) {
    return message.reply(
      `👋 Hai! Saya *SKARA* (Sampah Karang Rejo Assistant).\n\nSaya bisa:\n` +
      `1. 📸 Deteksi jenis sampah dari gambar\n` +
      `2. 💡 Rekomendasi pengelolaan sampah\n` +
      `3. 🗺️ Tunjukkan TPS terdekat (kirim lokasi)\n\n` +
      `Kirim gambar sampah 📷 atau share lokasi 📍 ya!`
    );
  }

  // Daftar TPS manual
  if (text === '#tps') {
    const list = daftarTPS.map(tps => `📍 ${tps.nama}\n${tps.link}`).join('\n\n');
    return message.reply(`Daftar lokasi TPS:\n\n${list}`);
  }

  // Jika kirim gambar
  if (message.hasMedia) {
    let media;
    try {
      media = await message.downloadMedia();
    } catch (e) {
      console.error('❌ Gagal download media:', e.message);
      return message.reply('❌ Gagal mengunduh gambar. Coba lagi ya.');
    }
    if (!media?.data) return message.reply('⚠️ Tidak ada gambar yang bisa diproses.');

    const buffer = Buffer.from(media.data, 'base64');
    const filePath = path.join(tempDir, `sampah_${Date.now()}.jpg`);
    fs.writeFileSync(filePath, buffer);

    try {
      // Kirim ke API HuggingFace (Flask/Gradio)
      const formData = new FormData();
      formData.append('file', fs.createReadStream(filePath));
      const { data } = await axios.post(API_URL, formData, {
        headers: formData.getHeaders(),
        timeout: 20000
      });

      const parent  = data?.parent?.label ?? '-';
      const pConf   = data?.parent?.confidence ?? 0;
      const sub     = data?.sub?.label ?? '-';
      const sConf   = data?.sub?.confidence ?? 0;
      const unsure  = !!data?.parent?.uncertain;

      // Panggil Gemini untuk rekomendasi
      const rekomendasi = await getRekomendasiGemini(nice(sub));

      const top3 = (data?.top3_sub ?? [])
        .map((t, i) => `${i+1}) ${nice(t.label)} (${(t.confidence*100).toFixed(1)}%)`)
        .join('\n');

      await message.reply(
        `♻️ Klasifikasi: *${parent} → ${nice(sub)}*\n` +
        `• Parent: ${(pConf*100).toFixed(1)}%${unsure ? ' (ragu)' : ''}\n` +
        `• Sub   : ${(sConf*100).toFixed(1)}%\n` +
        (top3 ? `\nTop-3 sub:\n${top3}\n` : '') +
        `\n💡 Rekomendasi:\n${rekomendasi}`
      );
    } catch (e) {
      console.error('❌ Error kirim ke API Flask:', e.message);
      await message.reply('⚠️ Gagal memproses gambar. Pastikan server AI aktif.');
    } finally {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
});

// ====== Gemini Helper ======
async function getRekomendasiGemini(jenis) {
  const prompt = `
Jenis sampah: ${jenis}
Berikan 3 cara pengelolaan terbaik (poin).
Format:
• ...
• ...
• ...
Bahasa santai dan mudah dipahami masyarakat.`;
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [{ parts: [{ text: prompt }] }]
    });
    return result?.candidates?.[0]?.content?.parts?.[0]?.text
           ?? '⚠️ Tidak ada rekomendasi dari AI.';
  } catch (err) {
    console.error('❌ Gemini error:', err.message);
    return '⚠️ AI sedang sibuk, coba lagi nanti.';
  }
}
