export function formatGeminiResponse(jenis, text) {
  return (
    `♻️ *Rekomendasi Pengelolaan Sampah ${capitalize(jenis)}*:\n\n` +
    formatWithEmojis(text) +
    `\n\n🌱 Terima kasih telah peduli lingkungan!`
  );
}

function formatWithEmojis(text) {
  return text
    // Pecah kalimat di titik agar jadi paragraf WhatsApp-friendly
    .replace(/\. (?=[^0-9A-Z])/g, '.\n')
    // Tambah emoji berdasarkan kata
    .replace(/\bdibersih\w*/gi, '✅ dibersihkan')
    .replace(/\b(disimpan|simpan|kumpulkan)\b/gi, '📦 $1')
    .replace(/\b(dikirim|serahkan|antar)\b/gi, '🏭 $1')
    .replace(/\b(jual|menjual|dijual)\b/gi, '💰 $1')
    .replace(/\b(hindari|jangan)\b/gi, '⚠️ $1')
    .replace(/\b(gunakan ulang|gunakan kembali)\b/gi, '🔁 gunakan kembali')
    // Hilangkan simbol yang bikin format salah
    .replace(/[*_~]/g, '')
    // Hilangkan spasi ganda
    .replace(/[ \t]+\n/g, '\n');
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
