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
        return res.status(400).json({ status: false, error: "Please provide a phone number." });
    }

    num = num.replace(/[^0-9]/g, '');

    // 💡 ইউনিক আইডি দিয়ে প্রতিবার একদম আলাদা ফোল্ডার তৈরি করা (যাতে জ্যাম না লাগে)
    const uniqueId = `auth_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const authFolder = path.join(__dirname, uniqueId);
    
    let sock = null;

    try {
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'fatal' }),
            // 🌐 আপনার মেইন বটের সাথে ম্যাচ করে ব্রাউজার সিগন্যাল সেট করা হলো ভাই
            browser: ["Ubuntu", "Chrome", "20.0.04"] 
        });

        if (!sock.authState.creds.registered) {
            // হোয়াটসঅ্যাপ সার্ভারের সাথে স্টেবল কানেকশন হওয়ার জন্য একটু সময় দেওয়া
            await delay(3000); 
            
            try {
                const code = await sock.requestPairingCode(num);
                // কোড পাওয়ার সাথে সাথে ক্লায়েন্টকে রেসপন্স পাঠিয়ে দেওয়া
                res.status(200).json({ status: true, code: code });
            } catch (errCode) {
                console.error("Error requesting code:", errCode);
                if (!res.headersSent) {
                    res.status(500).json({ status: false, error: "Failed to fetch pairing code." });
                }
            }
        } else {
            res.status(400).json({ status: false, error: "Already registered." });
        }

        // 🔥 ম্যাজিক ফিক্স: কোড জেনারেট হওয়ার সাথে সাথে সেশন ফোল্ডার ও মেমোরি সম্পূর্ণ ডিলিট করা
        setTimeout(() => {
            try {
                if (sock) sock.end();
                if (fs.existsSync(authFolder)) {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                    console.log(`[CLEANED] Cache folder ${uniqueId} cleared successfully!`);
                }
            } catch (e) {
                console.error("Cleanup error:", e.message);
            }
        }, 3000); // ৩ সেকেন্ড পর ব্যাকএন্ডের সব ময়লা সাফ

    } catch (error) {
        console.error("Server Main Error:", error);
        if (!res.headersSent) {
            res.status(500).json({ status: false, error: "Internal Server Error" });
        }
        // এরর খেলেও ফোল্ডার ডিলিট করার সেফটি মেকানিজম
        try {
            if (fs.existsSync(authFolder)) fs.rmSync(authFolder, { recursive: true, force: true });
        } catch (e) {}
    }
});

app.listen(PORT, () => {
    console.log(`Server running smoothly on port ${PORT}`);
});
       
