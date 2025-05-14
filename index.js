// WhatsApp Chatbot using Twilio + OpenAI (GPT-4)
// Dependencies: express, body-parser, twilio, openai, dotenv

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;
const { OpenAI } = require('openai');

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Session store (in-memory for demo)
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

app.get('/', (req, res) => {
  res.send('WhatsApp bot is running.');
});

app.post('/webhook', async (req, res) => {
  const incomingMsg = req.body.Body;
  const userNumber = req.body.From;

  const session = getSession(userNumber);
  session.push({ role: 'user', content: incomingMsg });

  try {
    const gptReply = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: session,
    });

    const replyText = gptReply.choices[0].message.content;
    session.push({ role: 'assistant', content: replyText });

    const twiml = new MessagingResponse();
    twiml.message(replyText);

    // You could trigger a handoff alert here:
    if (replyText.includes('[human]')) {
      console.log(`Handoff needed for ${userNumber}`);
      // Send an email, alert, or WhatsApp message to human
    }

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());

  } catch (err) {
    console.error('GPT Error:', err);
    const twiml = new MessagingResponse();
    twiml.message("Sorry, there was an error. We'll get back to you soon.");
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
  }
});

app.listen(port, () => {
  console.log(`🚀 WhatsApp bot running at http://localhost:${port}`);
});
