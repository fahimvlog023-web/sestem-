const express = require('express');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.status(200).json({ status: true, message: "LUCKY-XD Pairing API Server is Online! Created by Fahim Hussain." });
});

app.get('/code', async (req, res) => {
    let num = req.query.number;
    
    if (!num) {
        return res.status(400).json({ status: false, error: "Please provide a phone number. Example: /code?number=88017xxxxxxxx" });
    }

    // নম্বর থেকে প্লাস বা স্পেস ক্লিন করা
    num = num.replace(/[^0-9]/g, '');

    // প্রতিবার ফ্রেশ সেশন আইডি জেনারেট করার জন্য র্যান্ডম ফোল্ডার পাথ তৈরি
    const authFolder = path.join(__dirname, `auth_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'fatal' }),
            browser: ["Chrome (Linux)", "", ""]
        });

        // যদি কানেকশন মেকানিজম অলরেডি রেজিস্টার্ড না থাকে
        if (!sock.authState.creds.registered) {
            await delay(1500); // সেফটি ডিলে
            
            try {
                // মেইন পেয়ারিং কোড রিকোয়েস্ট
                const code = await sock.requestPairingCode(num);
                
                // ক্লায়েন্টকে কোড রেসপন্স পাঠানো
                res.status(200).json({ status: true, code: code });
            } catch (errCode) {
                console.error("Error requesting code:", errCode);
                res.status(500).json({ status: false, error: "Failed to fetch pairing code from WhatsApp." });
            }
        } else {
            res.status(400).json({ status: false, error: "This session is already registered." });
        }

        // রেন্ডার সার্ভারের মেমোরি ক্লিয়ার রাখার জন্য ৫ সেকেন্ড পর লোকাল ক্যাশ ফোল্ডার ডিলিট করা
        setTimeout(() => {
            try {
                sock.end();
                if (fs.existsSync(authFolder)) {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                }
            } catch (e) {}
        }, 5000);

    } catch (error) {
        console.error("Server Main Error:", error);
        if (!res.headersSent) {
            res.status(500).json({ status: false, error: "Internal Server Error" });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running smoothly on port ${PORT}`);
});
