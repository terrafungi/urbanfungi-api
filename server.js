require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = Number(process.env.ADMIN_CHAT_ID || "0");
const BTC_ADDRESS = process.env.BTC_ADDRESS || "";

if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
  console.error("❌ BOT_TOKEN ou ADMIN_CHAT_ID manquant dans .env");
}

const orders = new Map(); // orderCode -> { user, items, totalEur, status, createdAt }

async function tgSend(chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...extra,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) console.error("Telegram sendMessage error:", data);
  return data;
}

function money(n) {
  return Number(n || 0).toFixed(2);
}

app.get("/health", (req, res) => res.json({ ok: true }));

// 1) Création commande (appelée par la Mini App)
app.post("/api/create-order", async (req, res) => {
  try {
    const { user, items, totalEur } = req.body || {};
    if (!user?.id) return res.status(400).json({ ok: false, error: "Missing user.id" });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ ok: false, error: "Empty items" });

    const orderCode = `CMD-${Math.floor(1000 + Math.random() * 9000)}`;
    const order = {
      orderCode,
      user: { id: user.id, username: user.username || null },
      items,
      totalEur: Number(totalEur || 0),
      status: "EN_ATTENTE",
      createdAt: new Date().toISOString(),
    };
    orders.set(orderCode, order);

    const itemsText = items.map(i => `- ${i.nom} x${i.qty} — ${money(i.prix)} €`).join("\n");
    const adminText =
      `🧾 <b>NOUVELLE COMMANDE ${orderCode}</b>\n` +
      `Client: @${order.user.username || "inconnu"} (id ${order.user.id})\n\n` +
      `<b>Produits:</b>\n${itemsText}\n\n` +
      `💶 Total: <b>${money(order.totalEur)} €</b>\n` +
      `💰 Paiement: <b>BTC / Transcash</b>\n` +
      `Adresse BTC: <code>${BTC_ADDRESS}</code>\n` +
      `Statut: <b>${order.status}</b>`;

    await tgSend(ADMIN_CHAT_ID, adminText, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Confirmer payé", callback_data: `ok:${orderCode}` }],
          [{ text: "❌ Annuler", callback_data: `cancel:${orderCode}` }],
          [{ text: "📦 Expédié", callback_data: `ship:${orderCode}` }],
        ],
      },
    });

    res.json({
      ok: true,
      orderCode,
      btcAddress: BTC_ADDRESS,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// 2) Le client clique "J'ai payé (BTC)"
app.post("/api/client-paid-btc", async (req, res) => {
  try {
    const { orderCode, user } = req.body || {};
    if (!orderCode) return res.status(400).json({ ok: false, error: "Missing orderCode" });

    const o = orders.get(orderCode);
    if (!o) return res.status(404).json({ ok: false, error: "Order not found" });

    const adminText =
      `🔔 <b>CLIENT A CLIQUÉ "J'AI PAYÉ (BTC)"</b>\n` +
      `Commande: <b>${orderCode}</b>\n` +
      `Client: @${(user?.username || o.user.username) || "inconnu"} (id ${(user?.id || o.user.id)})\n` +
      `Total: <b>${money(o.totalEur)} €</b>\n` +
      `Adresse BTC: <code>${BTC_ADDRESS}</code>`;

    await tgSend(ADMIN_CHAT_ID, adminText);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// 3) Le client envoie un code Transcash
app.post("/api/submit-transcash", async (req, res) => {
  try {
    const { orderCode, code, user } = req.body || {};
    if (!orderCode) return res.status(400).json({ ok: false, error: "Missing orderCode" });
    if (!code || String(code).trim().length < 6) return res.status(400).json({ ok: false, error: "Invalid code" });

    const o = orders.get(orderCode);
    if (!o) return res.status(404).json({ ok: false, error: "Order not found" });

    const clean = String(code).trim();

    const adminText =
      `🎫 <b>CODE TRANSCASH REÇU</b>\n` +
      `Commande: <b>${orderCode}</b>\n` +
      `Client: @${(user?.username || o.user.username) || "inconnu"} (id ${(user?.id || o.user.id)})\n` +
      `Total: <b>${money(o.totalEur)} €</b>\n\n` +
      `➡️ Code: <code>${clean}</code>`;

    await tgSend(ADMIN_CHAT_ID, adminText);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// 4) Admin met à jour le statut (appelé par le bot quand vous cliquez sur les boutons)
app.post("/api/admin-status", async (req, res) => {
  try {
    const { orderCode, status } = req.body || {};
    if (!orderCode || !status) return res.status(400).json({ ok: false });

    const o = orders.get(orderCode);
    if (!o) return res.status(404).json({ ok: false, error: "Order not found" });

    o.status = status;
    orders.set(orderCode, o);

    // notifier le client si possible
    if (o.user?.id) {
      let msg = "";
      if (status === "PAYE") msg = `✅ Paiement confirmé pour ${orderCode}. Merci !`;
      else if (status === "ANNULE") msg = `❌ Votre commande ${orderCode} a été annulée.`;
      else if (status === "EXPEDIE") msg = `📦 Votre commande ${orderCode} a été expédiée.`;
      if (msg) await tgSend(o.user.id, msg);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("API listening on", PORT));
