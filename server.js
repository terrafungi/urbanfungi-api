// server.js
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const BTC_ADDRESS = process.env.BTC_ADDRESS;

if (!BOT_TOKEN || !ADMIN_CHAT_ID || !BTC_ADDRESS) {
  console.error("❌ Missing env: BOT_TOKEN / ADMIN_CHAT_ID / BTC_ADDRESS");
}

function randCode() {
  return "CMD-" + Math.floor(1000 + Math.random() * 9000);
}

async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: ADMIN_CHAT_ID,
      text,
      // parse_mode: "Markdown" // optionnel
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(JSON.stringify(data));
  return data;
}

app.get("/", (req, res) => res.send("OK"));

app.post("/api/create-order", async (req, res) => {
  try {
    const { user, items, totalEur } = req.body;

    if (!user?.id || !Array.isArray(items) || items.length === 0 || typeof totalEur !== "number") {
      return res.status(400).json({ ok: false, error: "Bad payload" });
    }

    const orderCode = randCode();
    const lines = items
      .map((i) => `- ${i.nom} x${i.qty} — ${Number(i.prix).toFixed(2)} €`)
      .join("\n");

    const msg =
      `🧾 NOUVELLE COMMANDE ${orderCode}\n` +
      `Client: @${user.username || "inconnu"} (id ${user.id})\n\n` +
      `Produits:\n${lines}\n\n` +
      `💶 Total: ${totalEur.toFixed(2)} €\n` +
      `💰 Paiement: BTC (manuel)\n` +
      `Adresse BTC: ${BTC_ADDRESS}\n` +
      `Statut: EN ATTENTE`;

    await sendTelegramMessage(msg);

    res.json({ ok: true, orderCode, btcAddress: BTC_ADDRESS });
  } catch (e) {
    console.error("❌ create-order error:", e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ API listening on", PORT));

