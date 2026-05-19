const express = require('express');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// একটি অবজেক্ট যেখানে লাইভ থাকা সব কাস্টমার বটের কানেকশন ট্র্যাক রাখা হবে
const activeBots = {};

// ─── 🌐 ১. ওয়েবসাইটের আকর্ষণীয় ফ্রন্টএন্ড ───
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Fahim Multi-Bot Active Center</title>
            <style>
                body { font-family: 'Segoe UI', sans-serif; background-color: #0f172a; color: #f8fafc; text-align: center; padding: 50px 20px; margin: 0; }
                .box { background: #1e293b; padding: 40px 30px; border-radius: 16px; display: inline-block; box-shadow: 0 10px 25px rgba(0,0,0,0.3); max-width: 400px; width: 100%; }
                h2 { color: #10b981; margin-top: 0; font-size: 24px; }
                p { color: #94a3b8; font-size: 14px; }
                input { padding: 12px; width: 85%; border-radius: 8px; border: 2px solid #334155; background: #0f172a; color: white; margin-bottom: 20px; font-size: 16px; text-align: center; outline: none; }
                input:focus { border-color: #10b981; }
                button { padding: 12px 25px; background: #10b981; border: none; border-radius: 8px; color: white; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.3s; width: 90%; }
                button:hover { background: #059669; }
                #codeBox { margin-top: 25px; font-size: 26px; font-weight: bold; color: #fbbf24; letter-spacing: 3px; }
                .status-msg { margin-top: 15px; font-size: 14px; color: #38bdf8; }
            </style>
        </head>
        <body>
            <div class="box">
                <h2>🤖 Fahim Bot Instant Activation</h2>
                <p>আপনার হোয়াটসঅ্যাপ নম্বরটি কান্ট্রি কোডসহ দিন (যেমন: 88018XXXXXXXX)</p>
                <input type="text" id="num" placeholder="88017XXXXXXXX"><br>
                <button onclick="getPairingCode()">বট একটিভ করুন</button>
                <div id="codeBox"></div>
                <div id="statusBox" class="status-msg"></div>
            </div>

            <script>
                async function getPairingCode() {
                    const num = document.getElementById('num').value;
                    const codeBox = document.getElementById('codeBox');
                    const statusBox = document.getElementById('statusBox');
                    if(!num) return alert('দয়া করে ফোন নম্বরটি দিন ভাই!');
                    
                    codeBox.innerHTML = '🔄 কোডিং হচ্ছে...';
                    statusBox.innerText = 'হোয়াটসঅ্যাপ সার্ভার থেকে পেয়ারিং কোড আনা হচ্ছে...';
                    
                    try {
                        const res = await fetch('/api/start-bot?number=' + num);
                        const data = await res.json();
                        if(data.code) {
                            codeBox.innerHTML = '<span style="font-size:14px; color:#94a3b8;">আপনার কোড:</span><br><span style="background:#0f172a; padding:8px 20px; border-radius:8px; display:inline-block; margin-top:10px;">' + data.code + '</span>';
                            statusBox.innerText = '💡 এই কোডটি কপি করে আপনার WhatsApp-এর Linked Devices-এ বসান। বসানোর সাথে সাথে বট অটো চালু হয়ে যাবে!';
                        } else {
                            codeBox.innerText = '';
                            statusBox.innerText = '❌ এরর: ' + data.error;
                        }
                    } catch(e) {
                        codeBox.innerText = '';
                        statusBox.innerText = '❌ রিকোয়েস্ট ফেইল্ড!';
                    }
                }
            </script>
        </body>
        </html>
    `);
});

// ─── ⚙️ ২. ব্যাকএন্ড মাল্টি-বট কোর ইঞ্জিন ───
async function initWhatsAppBot(num, res = null) {
    const sessionPath = path.join(__dirname, 'multisessions', num);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    activeBots[num] = sock;

    // সেশন ক্রেডেনশিয়াল সেভ করা
    sock.ev.on('creds.update', saveCreds);

    // পেয়ারিং কোড জেনারেট করার লজিক (যদি নতুন ইউজার হয়)
    if (!sock.authState.creds.registered && res) {
        try {
            await delay(2500);
            let code = await sock.getPairingCode(num);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            return res.json({ code: code });
        } catch (err) {
            return res.status(500).json({ error: "Code generation timeout! Try again." });
        }
    } else if (sock.authState.creds.registered && res) {
        return res.json({ error: "আপনার নম্বর অলরেডি এই সার্ভারে একটিভ আছে ভাই!" });
    }

    // ─── 💬 ৩. কাস্টমারদের বটের মেসেজ হ্যান্ডলার (নয়ন ভাইয়ের মেইন বেস) ───
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const msg = chatUpdate.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const from = msg.key.remoteJid;
            const messageType = Object.keys(msg.message)[0];
            const body = (messageType === 'conversation') ? msg.message.conversation : 
                         (messageType === 'extendedTextMessage') ? msg.message.extendedTextMessage.text : '';

            // বেসিক টেস্ট কমান্ড (যেমন: .menu বা .all)
            if (body.startsWith('.')) {
                const command = body.slice(1).trim().toLowerCase();

                if (command === 'menu' || command === 'help') {
                    let menuText = `🤖 *FAHIM MULTI-BOT SYSTEM*\n`;
                    menuText += `───────────────────\n`;
                    menuText += `✅ আপনার আইডিতে বট সফলভাবে কাজ করছে!\n\n`;
                    menuText += `📌 *কমান্ড সমূহ:*\n`;
                    menuText += `🔹 *.tagall* - গ্রুপের সবাইকে মেনশন দিতে\n`;
                    menuText += `🔹 *.ping* - বটের স্পিড চেক করতে\n`;
                    menuText += `🔹 *.alive* - বট অনলাইন আছে কি না দেখতে`;
                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                }

                if (command === 'ping') {
                    await sock.sendMessage(from, { text: '🤖 *Pong!* বট একদম রানিং স্পিডে আছে ভাই।' }, { quoted: msg });
                }

                if (command === 'alive') {
                    await sock.sendMessage(from, { text: '👋 জি ভাই, আমি সচল আছি! আপনার সেবায় নিয়োজিত।' }, { quoted: msg });
                }

                // 📢 আপনার কাঙ্ক্ষিত ট্যাগঅল (Tagall) কমান্ড
                if (command === 'tagall' || command === 'all') {
                    if (!from.endsWith('@g.us')) return await sock.sendMessage(from, { text: '❌ এই কমান্ডটি শুধু গ্রুপে ব্যবহার করা যাবে ভাই।' }, { quoted: msg });
                    
                    const groupMetadata = await sock.groupMetadata(from);
                    const participants = groupMetadata.participants;
                    
                    let mentionText = `📢 *ট্যাগঅল কমান্ড একটিভ* 📢\n───────────────────\n`;
                    let mentions = [];

                    for (let participant of participants) {
                        mentionText += `👉 @${participant.id.split('@')[0]}\n`;
                        mentions.push(participant.id);
                    }

                    await sock.sendMessage(from, { text: mentionText, mentions: mentions }, { quoted: msg });
                }
            }
        } catch (e) {
            console.log("Error handling message: ", e);
        }
    });

    // কানেকশন কেটে গেলে অটো-রিস্টার্ট লুপ
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log(`Reconnecting bot for: ${num}`);
                initWhatsAppBot(num); // অটো ব্যাকঅনলাইন ট্রিক
            } else {
                console.log(`Logged out session for: ${num}`);
                try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch(e){}
                delete activeBots[num];
            }
        } else if (connection === 'open') {
            console.log(`🚀 Bot successfully opened and running for: ${num}`);
        }
    });
}

// ─── 🚀 ৪. এক্সপ্রেস এপিআই রাউট ───
app.get('/api/start-bot', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number is required" });
    num = num.replace(/[^0-9]/g, '');

    // বটের নতুন সেশন চালু করে কোড রেসপন্স করা
    initWhatsAppBot(num, res);
});

// সার্ভার অন হওয়ার সময় অলরেডি কানেক্টেড থাকা সব কাস্টমারের বট অটো ব্যাকগ্রাউন্ডে চালু করার ট্রিক
const loadSavedSessions = () => {
    const sessionsDir = path.join(__dirname, 'multisessions');
    if (fs.existsSync(sessionsDir)) {
        const folders = fs.readdirSync(sessionsDir);
        folders.forEach(num => {
            console.log(`🔄 Automatically restarting saved bot session for: ${num}`);
            initWhatsAppBot(num);
        });
    }
};

app.listen(PORT, () => {
    console.log(`🚀 Multi-Bot Panel server running on port ${PORT}`);
    loadSavedSessions();
});
