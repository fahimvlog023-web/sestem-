const express = require('express');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ─── 🌐 ওয়েবসাইটের ফ্রন্টএন্ড ───
app.get('/', (req, res) => {
    res.send(`<h2 style="font-family:sans-serif; text-align:center; margin-top:100px; color:#10b981;">🚀 FAHIM-BBZ API Server is Running Fully Active!</h2>`);
});

// ─── ⚙️ মেইন ফাস্ট এপিআই ইঞ্জিন ───
app.get('/code', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number is required" });

    num = num.replace(/[^0-9]/g, '');
    const sessionPath = path.join(__dirname, 'temp_pairs', num);

    try {
        // প্রতিবার ফ্রেশ কানেকশন তৈরি করার জন্য পুরানো ফোল্ডার থাকলে ডিলিট করা
        if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false
        });

        if (!sock.authState.creds.registered) {
            // রেন্ডার ফ্রি সার্ভারের জন্য ইনস্ট্যান্ট ৩ সেকেন্ড ডিলে দিয়ে কোড রিকোয়েস্ট করা
            await delay(3000); 
            let code = await sock.getPairingCode(num);
            
            // কোড জেনারেট হওয়া মাত্রই রেসপন্স পাঠানো
            if(code) {
                res.json({ code: code });
            } else {
                res.status(500).json({ error: "Could not generate code" });
            }

            // সার্ভার ক্লিনআপ (১ মিনিট পর ফোল্ডার ডিলিট)
            setTimeout(() => {
                try { sock.logout(); fs.rmSync(sessionPath, { recursive: true, force: true }); } catch(e){}
            }, 60000);

        } else {
            res.json({ error: "Already connected" });
        }

    } catch (err) {
        res.status(500).json({ error: err.message });
        try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch(e){}
    }
});

app.listen(PORT, () => {
    console.log(`🚀 API running on port ${PORT}`);
});
