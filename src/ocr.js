const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Scan nota/receipt image using Gemini Vision API
 * Returns structured data from the receipt
 */
async function scanReceipt(imagePath) {
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

        // Read image and convert to base64
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString('base64');
        const mimeType = getMimeType(imagePath);

        // Upload to ImgBB
        let receiptUrl = null;
        const imgbbKey = process.env.IMGBB_API_KEY;
        if (imgbbKey && !imgbbKey.startsWith('GANTI_')) {
            try {
                const formData = new URLSearchParams();
                formData.append('key', imgbbKey);
                formData.append('image', base64Image);
                const res = await fetch('https://api.imgbb.com/1/upload', {
                    method: 'POST',
                    body: formData
                });
                const imgData = await res.json();
                if (imgData && imgData.data && imgData.data.url) {
                    receiptUrl = imgData.data.url;
                }
            } catch (err) {
                console.error("ImgBB upload error:", err.message);
            }
        }

        const prompt = `Kamu adalah asisten yang ahli membaca nota/struk belanja Indonesia.
Analisis gambar nota/struk ini dan extract informasi dengan format JSON berikut:

{
    "store_name": "nama toko/warung (jika terlihat)",
    "date": "tanggal transaksi (format YYYY-MM-DD, jika terlihat)",
    "items": [
        {
            "name": "nama barang",
            "qty": jumlah,
            "price": harga_satuan,
            "total": harga_total
        }
    ],
    "subtotal": jumlah_subtotal,
    "total": jumlah_total,
    "category_suggestion": "kategori yang paling cocok dari pilihan: Makanan & Minuman, Listrik, Air, Internet/WiFi, Kebersihan, Perlengkapan Kos, Kesehatan, Hiburan, Lainnya",
    "description": "deskripsi singkat belanja ini dalam 1 kalimat"
}

PENTING:
- Semua angka harga dalam Rupiah (tanpa "Rp" atau titik pemisah ribuan)
- Jika ada item yang tidak terbaca jelas, tulis "tidak terbaca" 
- Jika tanggal tidak terlihat, gunakan tanggal hari ini
- Pastikan total benar
- HANYA kembalikan JSON, tanpa teks lain`;

        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    mimeType: mimeType,
                    data: base64Image
                }
            }
        ]);

        const response = result.response.text();
        
        // Extract JSON from response (handle markdown code blocks)
        let jsonStr = response;
        const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1];
        }
        
        // Try to parse JSON
        const parsed = JSON.parse(jsonStr.trim());
        if (receiptUrl) {
            parsed.receipt_url = receiptUrl;
        }
        
        return {
            success: true,
            data: parsed
        };
    } catch (error) {
        console.error('OCR Error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Parse manual text input for quick expense entry
 * Format: "50000 beli sabun" or "Rp 50.000 beli sabun"
 */
function parseManualInput(text) {
    // Remove "Rp" prefix and dots
    let cleaned = text.replace(/[Rr]p\.?\s*/g, '').replace(/\./g, '');
    
    // Try to extract amount and description
    const match = cleaned.match(/^(\d+)\s+(.+)$/);
    if (match) {
        return {
            amount: parseInt(match[1]),
            description: match[2].trim()
        };
    }
    
    return null;
}

/**
 * Auto-categorize expense based on description
 */
function autoCategorizee(description) {
    const desc = description.toLowerCase();
    
    const categories = {
        'Makanan & Minuman': ['makan', 'minum', 'nasi', 'ayam', 'sayur', 'buah', 'snack', 'kopi', 'teh', 'susu', 'roti', 'mie', 'indomie', 'warung', 'resto', 'gorengan', 'tempe', 'tahu', 'telur', 'beras', 'gula', 'kecap', 'bumbu', 'lauk', 'soto', 'bakso', 'sate', 'rendang', 'sambal'],
        'Listrik': ['listrik', 'token', 'pln', 'kwh', 'pulsa listrik'],
        'Air': ['air', 'pdam', 'galon', 'aqua'],
        'Internet/WiFi': ['internet', 'wifi', 'indihome', 'first media', 'biznet', 'kuota', 'data'],
        'Kebersihan': ['sabun', 'deterjen', 'pewangi', 'sapu', 'pembersih', 'tisu', 'tissue', 'sampah', 'pel', 'lap', 'sikat'],
        'Perlengkapan Kos': ['lampu', 'ember', 'bantal', 'selimut', 'kasur', 'gantungan', 'cermin', 'rak', 'meja', 'kursi', 'jemuran'],
        'Kesehatan': ['obat', 'vitamin', 'masker', 'plester', 'betadine', 'paracetamol', 'antimo', 'minyak kayu putih'],
        'Hiburan': ['nonton', 'main', 'game', 'netflix', 'spotify', 'jalan-jalan', 'wisata', 'karaoke'],
        'Transportasi': ['bensin', 'grab', 'gojek', 'ojek', 'bus', 'angkot', 'parkir'],
    };

    for (const [category, keywords] of Object.entries(categories)) {
        for (const keyword of keywords) {
            if (desc.includes(keyword)) {
                return category;
            }
        }
    }

    return 'Lainnya';
}

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const types = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp'
    };
    return types[ext] || 'image/jpeg';
}

module.exports = {
    scanReceipt,
    parseManualInput,
    autoCategorizee,
};
