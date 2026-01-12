const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json());

// ---- ENV
const BOT_TOKEN = process.env.BOT_TOKEN; // utilisé seulement pour sendMessage côté API
const ADMIN_CHAT_ID = Number(process.env.ADMIN_CHAT_ID || "0");
const BTC_ADDRESS =
  process.env.BTC_ADDRESS || "bc1q7ttd985n9nlky9gqe9vxwqq33u007ssvq0dnql";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

// Sécurité admin pour endpoints (IMPORTANT)
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";

if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
  console.error("❌ BOT_TOKEN ou ADMIN_CHAT_ID manquant (Render > Environment)");
}

app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// ---- In-memory store (⚠️ reset au restart Render)
const orders = new Map(); // orderCode -> { user, items, totalEur, status, createdAt, updatedAt }

function money(n) {
  return Number(n || 0).toFixed(2);
}

async function tgSend(chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!data.ok) console.error("Telegram sendMessage error:", data);
  return data;
}

// ---- Health
app.get("/", (req, res) => res.send("UrbanFungi API OK"));
app.get("/health", (req, res) => res.json({ ok: true }));

// 1) Create order (Mini App)
app.post("/api/create-order", async (req, res) => {
  try {
    const { user, items, totalEur } = req.body || {};
    if (!user?.id) return res.status(400).json({ ok: false, error: "Missing user.id" });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "Empty items" });
    }

    const orderCode = `CMD-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date().toISOString();

    const order = {
      orderCode,
      user: { id: user.id, username: user.username || null },
      items,
      totalEur: Number(totalEur || 0),
      status: "EN_ATTENTE",
      createdAt: now,
      updatedAt: now,
    };
    orders.set(orderCode, order);

    const itemsText = items
      .map((i) => `- ${i.nom} x${i.qty} — ${money(i.prix)} €`)
      .join("\n");

    const adminText =
      `🧾 <b>NOUVELLE COMMANDE ${orderCode}</b>\n` +
      `Client: @${order.user.username || "inconnu"} (id ${order.user.id})\n\n` +
      `<b>Produits:</b>\n${itemsText}\n\n` +
      `💶 Total: <b>${money(order.totalEur)} €</b>\n` +
      `💰 Paiement: <b>BTC / Transcash</b>\n` +
      `Adresse BTC: <code>${BTC_ADDRESS}</code>\n` +
      `Statut: <b>${order.status}</b>`;

    // ⚠️ IMPORTANT : on garde les boutons dans le message admin
    if (BOT_TOKEN && ADMIN_CHAT_ID) {
      await tgSend(ADMIN_CHAT_ID, adminText, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Confirmer payé", callback_data: `ok:${orderCode}` }],
            [{ text: "❌ Annuler", callback_data: `cancel:${orderCode}` }],
            [{ text: "📦 Expédié", callback_data: `ship:${orderCode}` }],
          ],
        },
      });
    }

    res.json({ ok: true, orderCode, btcAddress: BTC_ADDRESS });
  } catch (e) {
    console.error("create-order error:", e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// 2) Client clique “J’ai payé (BTC)” => notif admin (sans changer le statut)
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

    if (BOT_TOKEN && ADMIN_CHAT_ID) await tgSend(ADMIN_CHAT_ID, adminText);
    res.json({ ok: true });
  } catch (e) {
    console.error("client-paid-btc error:", e);
    res.status(500).json({ ok: false });
  }
});

// 3) Client envoie un code Transcash => notif admin
app.post("/api/submit-transcash", async (req, res) => {
  try {
    const { orderCode, code, user } = req.body || {};
    if (!orderCode) return res.status(400).json({ ok: false, error: "Missing orderCode" });

    const clean = String(code || "").trim();
    if (clean.length < 6) return res.status(400).json({ ok: false, error: "Invalid code" });

    const o = orders.get(orderCode);
    if (!o) return res.status(404).json({ ok: false, error: "Order not found" });

    const adminText =
      `🎫 <b>CODE TRANSCASH REÇU</b>\n` +
      `Commande: <b>${orderCode}</b>\n` +
      `Client: @${(user?.username || o.user.username) || "inconnu"} (id ${(user?.id || o.user.id)})\n` +
      `Total: <b>${money(o.totalEur)} €</b>\n\n` +
      `➡️ Code: <code>${clean}</code>`;

    if (BOT_TOKEN && ADMIN_CHAT_ID) await tgSend(ADMIN_CHAT_ID, adminText);
    res.json({ ok: true });
  } catch (e) {
    console.error("submit-transcash error:", e);
    res.status(500).json({ ok: false });
  }
});

// ✅ ADMIN: update status (sécurisé)
app.post("/api/admin/status", (req, res) => {
  try {
    const { secret, orderCode, status } = req.body || {};
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    if (!orderCode || !status) return res.status(400).json({ ok: false, error: "Missing data" });

    const o = orders.get(orderCode);
    if (!o) return res.status(404).json({ ok: false, error: "Order not found" });

    o.status = status;
    o.updatedAt = new Date().toISOString();
    orders.set(orderCode, o);

    res.json({ ok: true, order: o });
  } catch (e) {
    console.error("admin/status error:", e);
    res.status(500).json({ ok: false });
  }
});

// ✅ ADMIN: historique simple (sécurisé)
app.get("/api/admin/orders", (req, res) => {
  try {
    const secret = req.query.secret || "";
    const limit = Math.min(Number(req.query.limit || 10), 50);

    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const list = Array.from(orders.values())
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .slice(0, limit);

    res.json({ ok: true, orders: list });
  } catch (e) {
    console.error("admin/orders error:", e);
    res.status(500).json({ ok: false });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("API listening on", PORT));
