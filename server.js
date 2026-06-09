// server.js – Blocket Proxy + Notifieringar
// Kör med: node server.js
// Kräver: npm install express cors node-fetch

const express = require("express");
const cors = require("cors");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ── Hälsokoll ──────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "ok", service: "blocket-proxy" }));

// ── Proxy mot Blockets API ─────────────────────────────────
app.get("/api/search", async (req, res) => {
  try {
    const blocketUrl = req.query.url;
    if (!blocketUrl || !blocketUrl.includes("blocket.se")) {
      return res.status(400).json({ error: "Ogiltig URL" });
    }

    // Bygg API-URL från söklänken
    const u = new URL(blocketUrl);
    const apiUrl = `https://api.blocket.se/search_bff/v1/content?${u.searchParams.toString()}&lim=40&offset=0&gl=3&include=extend_with_shipping&st=s`;

    const resp = await fetch(apiUrl, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; BlocketMonitor/1.0)"
      }
    });

    if (!resp.ok) throw new Error(`Blocket svarade: ${resp.status}`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Skicka Slack-notis ─────────────────────────────────────
app.post("/api/notify/slack", async (req, res) => {
  const { webhook, ad } = req.body;
  if (!webhook || !ad) return res.status(400).json({ error: "Saknar webhook eller annons" });

  const price = ad.price?.value
    ? `${parseInt(ad.price.value).toLocaleString("sv-SE")} kr`
    : "Pris saknas";
  const link = ad.share_url || `https://www.blocket.se${ad.url || ""}`;
  const img = ad.images?.[0]?.url;

  const body = {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🆕 *Ny Blocket-annons!*\n*${ad.subject || "Okänd"}*\n💰 ${price}\n📍 ${ad.location?.name || ""}`
        },
        ...(img ? { accessory: { type: "image", image_url: img + "?type=mob_iphone_vi_normal_2x", alt_text: ad.subject || "bild" } } : {})
      },
      { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Öppna annons ↗" }, url: link }] }
    ]
  };

  try {
    await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Skicka WhatsApp-notis via Twilio ───────────────────────
app.post("/api/notify/whatsapp", async (req, res) => {
  const { sid, token, to, from, ad } = req.body;
  if (!sid || !token || !to || !from || !ad) {
    return res.status(400).json({ error: "Saknar Twilio-uppgifter eller annons" });
  }

  const price = ad.price?.value
    ? `${parseInt(ad.price.value).toLocaleString("sv-SE")} kr`
    : "Pris saknas";
  const link = ad.share_url || `https://www.blocket.se${ad.url || ""}`;
  const msg = `🆕 Ny Blocket-annons!\n*${ad.subject || "Okänd"}*\n💰 ${price}\n${link}`;

  try {
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({ From: `whatsapp:${from}`, To: `whatsapp:${to}`, Body: msg })
      }
    );
    const data = await resp.json();
    if (resp.ok) res.json({ ok: true });
    else res.status(400).json({ error: data.message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`✅ Proxy körs på port ${PORT}`));
