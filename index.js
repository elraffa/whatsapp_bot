// WhatsApp Bot using Meta WhatsApp Cloud API + OpenAI (GPT-3.5)
// Dependencies: express, body-parser, openai, axios, dotenv

require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");
const axios = require("axios");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory session store (demo only)
const sessions = {};
function getSession(user) {
  if (!sessions[user]) {
    sessions[user] = [
      {
        role: "system",
        content:
          'Eres un asistente virtual para MKTDigital Ideas, una agencia de marketing digital. Responde a las preguntas de los usuarios y proporciona información útil sobre nuestros servicios. Si el usuario menciona "humano", transfiere la conversación a un agente humano. Inicia la conversación con un saludo amigable, tu nombre es Laura. No contestes preguntas sobre temas fuera de marketing digital, ni respondas mas de 3 preguntas del usuario. Puedes usar emojis y lenguaje informal. Pidele al cliente su nombre para seguir contestando preguntas. No interactues con usuarios que no sean clientes de MKTDigital Ideas. Si el usuario menciona "humano", o si hacen mas de tres preguntas, transfiere la conversación a un agente humano. No uses el nombre de OpenAI ni menciones que eres un bot. No hables sobre tus capacidades como asistente virtual. No respondas mas de 3 veces a la misma pregunta.',
      },
    ];
  }
  return sessions[user];
}

// Webhook verification (Meta requirement)
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    res.status(200).send(challenge);
  } else {
    console.log("❌ Webhook verification failed");
    res.sendStatus(403);
  }
});

// Basic input sanitizer
function sanitizeText(text) {
  if (typeof text !== "string") return "";
  return text.replace(/[<>]/g, "").trim().substring(0, 1000); // max 1000 chars
}

// Log summary to Google Sheets using GPT
async function logToSheetSummary({ phone, session }) {
  try {
    const serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const doc = new GoogleSpreadsheet(
      process.env.GOOGLE_SHEET_ID,
      serviceAccountAuth
    );
    await doc.loadInfo();
    console.log("Available sheets:", Object.keys(doc.sheetsByTitle));

    const sheet = doc.sheetsByTitle["Leads"];
    if (!sheet) throw new Error('Sheet "Leads" not found');

    const summaryMessages = [
      {
        role: "system",
        content:
          "Sos un analista que resume conversaciones entre clientes y asistentes virtuales.",
      },
      ...session,
      {
        role: "user",
        content:
          "Por favor, resumí esta conversación en una oración incluyendo el nombre del cliente (si se menciona), qué necesita y cuán urgente es. Sé claro y directo.",
      },
    ];

    const summaryResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: summaryMessages,
    });

    const summary = summaryResponse.choices[0].message.content;

    await sheet.addRow({
      Timestamp: new Date().toISOString(),
      Phone: phone,
      Summary: summary,
    });

    console.log("✅ Summary logged to Google Sheets");
  } catch (err) {
    console.error(
      "❌ Failed to log summary to Google Sheets:",
      err.message || err
    );
  }
}

// Webhook handler (Meta Cloud API)
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "whatsapp_business_account") {
    const changes = body.entry?.[0]?.changes?.[0]?.value;
    const message = changes?.messages?.[0];
    const phoneNumberId = changes?.metadata?.phone_number_id;
    const from = message?.from;
    const msgText = sanitizeText(message?.text?.body);

    if (!from || !msgText) return res.sendStatus(200);

    console.log(`📥 Incoming message from ${from}: ${msgText}`);

    const session = getSession(from);
    session.push({ role: "user", content: msgText });

    // Limit GPT to 3 assistant replies per session
    const assistantReplies = session.filter(m => m.role === 'assistant').length;
    if (assistantReplies >= 6) {
      console.log(`🛑 Assistant reply limit reached for ${from}. No further replies.`);
      return res.sendStatus(200); // or optionally trigger a final message here
    }

    try {
      const gptReply = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: session,
      });

      const replyText = gptReply.choices[0].message.content;
      session.push({ role: "assistant", content: replyText });
      console.log("🤖 GPT says:", replyText);

      const response = await axios.post(
        `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: { body: replyText },
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("✅ Message sent successfully:", response.data);

      // Remove [human] string check, use length instead
      if (session.length >= 8) {
        console.log(`📣 Human handoff triggered for ${from}`);

        try {
          await logToSheetSummary({ phone: from, session });
        } catch (sheetErr) {
          console.error(
            "❌ Failed to log summary to Google Sheets:",
            sheetErr.message
          );
        }
      }

      res.sendStatus(200);
    } catch (err) {
      console.error(
        "❌ GPT or Meta send error:",
        err.response?.data || err.message
      );
      res.sendStatus(500);
    }
  } else {
    res.sendStatus(404);
  }
});

app.listen(port, () => {
  console.log(`🚀 WhatsApp bot server running on port ${port}`);
});
