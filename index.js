// WhatsApp Bot using Meta WhatsApp Cloud API + OpenAI (GPT)
// Dependencies: express, body-parser, openai, axios, dotenv

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');
const axios = require('axios');

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
        role: 'system',
        content: 'Eres un asistente de WhatsApp para el Estudio Geller, Especialistas en Accidentes de Tránsito. Presentate como Laura, asesora especializada y dale la bienvenida al usuario, preguntale qué necesita y cuál es su urgencia. Deberás recopilar sus datos completos. Luego redireccionalo con un asistente humano a estudiogeller@gmail.com.'
      }
    ];
  }
  return sessions[user];
}

// Webhook verification (Meta requirement)
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Webhook handler (Meta Cloud API)
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    const changes = body.entry?.[0]?.changes?.[0]?.value;
    const message = changes?.messages?.[0];
    const phoneNumberId = changes?.metadata?.phone_number_id;
    const from = message?.from;
    const msgText = message?.text?.body;

    if (!from || !msgText) return res.sendStatus(200);

    console.log(`Incoming message from ${from}: ${msgText}`);

    const session = getSession(from);
    session.push({ role: 'user', content: msgText });

    try {
      const gptReply = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: session,
      });
      console.log('🤖 GPT says:', gptReply.choices[0].message.content);

      const replyText = gptReply.choices[0].message.content;
      session.push({ role: 'assistant', content: replyText });

      await axios.post(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, {
        messaging_product: "whatsapp",
        to: from,
        text: { body: replyText }
      }, {
        headers: {
          Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }).then(response => {
        console.log('Message sent successfully:', response.data);
      }).catch(error => {
          console.error('❌ Meta send error:', error.response?.data || error.message);
      });

      if (replyText.includes('[human]')) {
        console.log(`Human handoff triggered for ${from}`);
      }

      res.sendStatus(200);
    } catch (err) {
      console.error('Error sending reply:', err);
      res.sendStatus(500);
    }
  } else {
    res.sendStatus(404);
  }
});

app.listen(port, () => {
  console.log(`🚀 WhatsApp bot server running on port ${port}`);
});
