import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '15mb' }));

const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Serve OneSignal Service Worker explicitly in both dev & production
app.get('/OneSignalSDKWorker.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.resolve(process.cwd(), 'OneSignalSDKWorker.js'));
});

// OneSignal Background Push Trigger API (wakes up minimized & closed devices)
app.post('/api/onesignal/send', async (req, res) => {
  try {
    const { title, message, url, image, icon } = req.body || {};
    if (!message) return res.status(400).json({ error: 'Message required' });

    const onesignalAppId = 'ec6e3411-17e1-42b0-a5e9-7e315612da70';
    const onesignalApiKey = 'os_v2_app_5rxdieix4fblbjpjpyyvmew2ob3d357wwzduy2usurusvefzxppx7ldixwbjn65tgdp6svdnqrq3boikgeir2hvcqce54yq22p7uyaq';
    const authHeader = onesignalApiKey.startsWith('os_v2_') ? `Bearer ${onesignalApiKey}` : `Key ${onesignalApiKey}`;
    const iconUrl = icon || image || undefined;

    const resp = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': authHeader
      },
      body: JSON.stringify({
        app_id: onesignalAppId,
        included_segments: ['All'],
        headings: { en: title || 'BD TOURNAMENT' },
        contents: { en: message },
        url: url || undefined,
        chrome_web_icon: iconUrl,
        chrome_icon: iconUrl,
        large_icon: iconUrl,
        big_picture: image || undefined
      })
    });
    const result = await resp.json();
    res.json({ success: true, result });
  } catch (err: any) {
    console.error('OneSignal Push Error:', err?.message || err);
    res.status(500).json({ error: 'Failed to send push' });
  }
});

// Route for Admin Master Console
app.get('/admin', (req, res) => {
  res.redirect('/admin.html');
});

// Full-stack API proxy for Gemini AI Assistant (Support & Rules Helper)
app.post('/api/gemini/chat', async (req, res) => {
  const { message, appContext } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    if (!ai) {
      const bal = appContext?.deposit !== undefined ? (appContext.deposit + (appContext.winning || 0)) : 0;
      return res.json({
        reply: `আমি BD TOURNAMENT AI সহকারী। আপনার বর্তমান মোট ওয়ালেট ব্যালেন্স ৳${bal} (ডিপোজিট: ৳${appContext?.deposit || 0}, উইনিং: ৳${appContext?.winning || 0})। আপনার কোন টুর্নামেন্ট বা নিয়মে সাহায্য দরকার?`,
        matchDraft: null
      });
    }

    const systemPrompt = `You are "BD TOURNAMENT AI Assistant & Arena Guide" (বিডি টুর্নামেন্ট স্মার্ট এআই সহকারী), the official in-app AI assistant for the BD TOURNAMENT mobile gaming arena in Bangladesh (Ludo King and Free Fire esports).
Current player & app state:
- Player Name: ${appContext?.username || 'Player'}
- Deposit Balance: ৳${appContext?.deposit || 0}
- Winning Balance: ৳${appContext?.winning || 0}
- Matches Played: ${appContext?.matchesPlayed || 0}
- Total Wins: ৳${appContext?.totalWins || 0}
- Joined Matches: ${JSON.stringify(appContext?.joinedMatches || [])}
- Available Matches: ${JSON.stringify(appContext?.availableMatches || [])}
- Payment Methods: bKash, Nagad, Rocket

Guidelines:
1. Always respond in fluent, natural Bengali (বাংলা).
2. You are strictly a support, automation guide, and rules helper assistant. Do NOT draft or create admin tournaments in AI chat.
3. Explain clearly when asked:
   - Custom Player Matches: হোম স্ক্রিনের 'কাস্টম ম্যাচ তৈরি করুন' / '+ ম্যাচ বানান' বাটনে চাপ দিয়ে খেলোয়াড়রা নিজেরাই ১v১ বা ২v২ ম্যাচ তৈরি করতে পারবেন (এডমিন ফি কেটে প্রাইজ নির্ধারিত হবে)।
   - Auto Ludo Room Flow: ২ জন জয়েন হলেই রেডি চেক + ৩ সেকেন্ডের ম্যাচ লঞ্চ ইন্টারস্টিশিয়াল প্রদর্শিত হয় এবং পুল বা হোস্টের স্ক্রিনশট/কোড AI স্ক্যান করে উভয়কে রুম কোড পাঠিয়ে অটো Ludo King ওপেন করে।
   - AI Win Proof Auto-Payout: ম্যাচ জয়ের আসল Ludo King উইনিং স্ক্রিনশট আপলোড করলে AI যাচাই করে নিখুঁত প্রমাণ পেলে সাথে সাথে উইনিং ব্যালেন্সে টাকা যোগ করে দেয়; কোনো সন্দেহ বা গলদ থাকলে টাকা যোগ না করে এডমিন রিভিউতে পাঠায়।
   - Profile Hub: ডেইলি মিশন, প্রোমো কুপন, রেফার, ওয়ালেট, এডমিন লাইভ চ্যাট ও নোটিফিকেশন সেটিংস প্রোফাইল সেকশনে রয়েছে।
4. Keep answers concise, clear, and mobile-friendly.`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: message,
      config: {
        systemInstruction: systemPrompt,
      },
    });

    const reply = response.text || 'আমি উত্তর প্রস্তুত করতে পারিনি, আবার চেষ্টা করুন।';
    res.json({ reply, matchDraft: null });
  } catch (err: any) {
    console.error('Gemini API Error:', err?.message || err);
    const bal = (appContext?.deposit || 0) + (appContext?.winning || 0);
    let smartReply = `আমি BD TOURNAMENT স্মার্ট সহকারী। আপনার বর্তমান ওয়ালেট ব্যালেন্স ৳${bal} (ডিপোজিট ৳${appContext?.deposit || 0}, উইনিং ৳${appContext?.winning || 0})। `;
    const q = String(message || '').toLowerCase();

    if (q.includes('তৈরি') || q.includes('ক্রিয়েট') || q.includes('create') || q.includes('বানাও')) {
      smartReply = `⚔️ **কাস্টম ম্যাচ তৈরি করার নিয়ম:**\nহোম স্ক্রিনের '+ ম্যাচ বানান' বাটনে চাপুন, গেম ও এন্ট্রি ফি নির্বাচন করুন। ২ জন জয়েন হলেই ৩ সেকেন্ডের প্রি-ম্যাচ এড/লঞ্চ স্ক্রিন শেষে রুম কোড ও Ludo King চালু হবে! 🏆`;
    } else if (q.includes('বোনাস') || q.includes('ক্যাশব্যাক') || q.includes('অফার')) {
      smartReply = `🎁 **ডিপোজিট ক্যাশব্যাক অফার:**\n• ৳১০০+ ডিপোজিটে ৳২০ ফ্রি\n• ৳৩০০+ ডিপোজিটে ৳৭৫ ফ্রি\n• ৳৫০০+ ডিপোজিটে ৳১৫০ বোনাস\n• ৳১০০০+ ডিপোজিটে ৳৩৫০ মেগা অফার!`;
    } else if (q.includes('মিশন') || q.includes('ডেইলি')) {
      smartReply = `🎯 **৭ দিনের ডেইলি মিশন:**\nপ্রোফাইল সেকশনে গিয়ে '৭ দিনের ডেইলি মিশন' কার্ড থেকে প্রতিদিন ম্যাচ খেলে বোনাস ক্লেইম করতে পারবেন!`;
    } else if (q.includes('ব্যালেন্স') || q.includes('টাকা')) {
      smartReply = `💰 আপনার ডিপোজিট ৳${appContext?.deposit || 0} ও উইনিং ৳${appContext?.winning || 0} (মোট ৳${bal})।`;
    } else if (q.includes('রুম') || q.includes('কোড') || q.includes('আইডি')) {
      if (appContext?.joinedMatches?.length > 0) {
        const jm = appContext.joinedMatches[0];
        smartReply = `🔑 আপনার ম্যাচ: **${jm.title || 'ম্যাচ'}**\n• রুম আইডি: ${jm.roomId || 'ম্যাচ শুরুর পূর্বে দেওয়া হবে'}\n• পাসওয়ার্ড: ${jm.roomPass || 'ম্যাচ শুরুর পূর্বে দেওয়া হবে'}`;
      } else {
        smartReply = `🔑 টুর্নামেন্টে জয়েন করার পর ২/২ স্লট পূর্ণ হলে অটো বা এডমিনের মাধ্যমে রুম কোড প্রকাশ করা হবে।`;
      }
    } else {
      smartReply += `টুর্নামেন্ট, রুম কোড অটোমেশন বা AI উইনিং স্ক্রিনশট ভেরিফিকেশন সম্পর্কে যেকোনো প্রশ্ন করুন।`;
    }
    res.json({ reply: smartReply, matchDraft: null });
  }
});

// AI Win Screenshot Forensic Verification & Auto-Payout Gate
app.post('/api/gemini/verify-proof', async (req, res) => {
  try {
    const { imageBase64, mimeType, matchTitle, playerName, playerIgn, prizePool, entryFee } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: 'Screenshot image is required' });
    }

    const cleanBase64 = String(imageBase64).replace(/^data:image\/\w+;base64,/, '').trim();
    const imageHash = crypto.createHash('sha256').update(cleanBase64).digest('hex');

    if (!ai) {
      return res.json({
        verified: false,
        isLudoKingWinScreen: false,
        confidence: 0,
        winnerNameDetected: '',
        suspectedTampering: false,
        reasonBn: 'AI ভেরিফিকেশন ইঞ্জিন অনুপলব্ধ থাকায় অটো-পেআউট স্থগিত করা হয়েছে। অ্যাডমিন ম্যানুয়ালি যাচাই করবেন।',
        imageHash
      });
    }

    const verificationPrompt = `You are a strict Esports Anti-Cheat Judge verifying a tournament win proof screenshot for BD TOURNAMENT.
Match Info:
- Title: ${matchTitle || 'Ludo / Esports Match'}
- Claiming Player Account Name: ${playerName || 'Unknown'}
- Claiming Player In-Game Name (IGN): ${playerIgn || 'Unknown'}
- Prize Pool: ৳${prizePool || 0}, Entry: ৳${entryFee || 0}

Analyze the uploaded image carefully:
1. Is this genuinely an in-game match victory / end-of-game leaderboard screen (especially Ludo King "Congratulations / 1st / Won" screen, or Free Fire "BOOYAH! / #1 Victory" screen)? Reject lobby screens, random photos, chat screenshots, black screens, "You Lost / 2nd / 3rd / 4th" defeat screens, or room waiting screens.
2. Check for signs of digital tampering/editing (mismatched fonts pasted over names, cropped stickers covering defeat ranks, fake text overlays).
3. Extract the visible #1 Winner's name if legible. If the claiming IGN/name is visible and is NOT #1 (e.g. ranked 2nd/3rd/lost), set verified = false! If the game screen is genuine 1st place / Victory and no tampering or contradiction with player IGN exists, set verified = true and confidence >= 0.85.
4. Provide a concise Bengali explanation in reasonBn explaining the decision clearly to the player.`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        {
          inlineData: {
            data: cleanBase64,
            mimeType: mimeType || 'image/jpeg',
          },
        },
        verificationPrompt,
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isLudoKingWinScreen: { type: Type.BOOLEAN },
            verified: { type: Type.BOOLEAN },
            confidence: { type: Type.NUMBER },
            winnerNameDetected: { type: Type.STRING },
            suspectedTampering: { type: Type.BOOLEAN },
            reasonBn: { type: Type.STRING },
          },
          required: ['isLudoKingWinScreen', 'verified', 'confidence', 'winnerNameDetected', 'suspectedTampering', 'reasonBn'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json({
      isLudoKingWinScreen: Boolean(parsed.isLudoKingWinScreen),
      verified: Boolean(parsed.verified),
      confidence: Number(parsed.confidence || 0),
      winnerNameDetected: String(parsed.winnerNameDetected || ''),
      suspectedTampering: Boolean(parsed.suspectedTampering),
      reasonBn: String(parsed.reasonBn || 'স্ক্রিনশট যাচাই সম্পন্ন হয়েছে।'),
      imageHash
    });
  } catch (err: any) {
    console.error('Verify Proof AI Error:', err?.message || err);
    res.status(500).json({
      verified: false,
      isLudoKingWinScreen: false,
      confidence: 0,
      winnerNameDetected: '',
      suspectedTampering: false,
      reasonBn: 'AI স্ক্রিনশট বিশ্লেষণে সাময়িক ত্রুটি হয়েছে। টাকা যোগ করা হয়নি; অ্যাডমিন রিভিউতে পাঠানো হয়েছে।'
    });
  }
});

// AI Ludo King Room Code OCR / Validation Endpoint
app.post('/api/gemini/verify-ludo-room', async (req, res) => {
  try {
    const { imageBase64, mimeType, roomCodeText } = req.body || {};

    if (!imageBase64 && roomCodeText) {
      const cleaned = String(roomCodeText).replace(/[^A-Za-z0-9]/g, '');
      const match = cleaned.match(/\d{6,10}/) || cleaned.match(/[A-Za-z0-9]{6,10}/);
      if (match) {
        return res.json({
          valid: true,
          roomCode: match[0],
          reasonBn: `রুম কোড ${match[0]} সফলভাবে ভেরিফাই হয়েছে!`
        });
      }
      return res.json({
        valid: false,
        roomCode: '',
        reasonBn: 'সঠিক ৭-১০ ডিজিটের Ludo King রুম কোড দিন।'
      });
    }

    if (!imageBase64) {
      return res.status(400).json({ valid: false, roomCode: '', reasonBn: 'স্ক্রিনশট বা রুম কোড প্রদান করুন।' });
    }

    if (!ai) {
      return res.json({ valid: false, roomCode: '', reasonBn: 'AI ভিশন অনুপলব্ধ — দয়া করে হাতে রুম কোড লিখুন।' });
    }

    const cleanBase64 = String(imageBase64).replace(/^data:image\/\w+;base64,/, '').trim();
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        {
          inlineData: {
            data: cleanBase64,
            mimeType: mimeType || 'image/jpeg',
          },
        },
        'Extract the Ludo King Room Code (usually a 7 to 9 digit Room ID / Code shown on the "Play with Friends -> Create Room" screen). Return valid=true and roomCode if clearly visible, otherwise valid=false with a short Bengali reasonBn.'
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            valid: { type: Type.BOOLEAN },
            roomCode: { type: Type.STRING },
            reasonBn: { type: Type.STRING },
          },
          required: ['valid', 'roomCode', 'reasonBn'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json({
      valid: Boolean(parsed.valid && parsed.roomCode),
      roomCode: String(parsed.roomCode || '').trim(),
      reasonBn: String(parsed.reasonBn || 'রুম কোড স্ক্যান সম্পন্ন হয়েছে।')
    });
  } catch (err: any) {
    console.error('Verify Ludo Room Error:', err?.message || err);
    res.status(500).json({ valid: false, roomCode: '', reasonBn: 'রুম কোড স্ক্যান করা যায়নি, অনুগ্রহ করে কোডটি লিখে দিন।' });
  }
});

async function start() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static('dist'));
    app.get('*', (req, res) => {
      res.sendFile('dist/index.html', { root: '.' });
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

start();
