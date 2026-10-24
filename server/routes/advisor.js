const express = require('express');
const { setSetting, deleteSetting } = require('../db');
const advisor = require('../services/advisor');

const router = express.Router();

router.get('/status', (req, res) => {
  const source = advisor.keySource();
  res.json({
    configured: Boolean(source),
    source,
    model: advisor.currentModel().id,
    // Without APP_PASSWORD anyone who can reach the app can spend the key.
    passwordProtected: Boolean(process.env.APP_PASSWORD),
    maxPerHour: MAX_PER_HOUR,
    models: advisor.MODELS.map(({ id, label, note }) => ({ id, label, note })),
  });
});

router.post('/model', express.json(), (req, res) => {
  const model = String(req.body?.model || '');
  if (!advisor.MODELS.some((m) => m.id === model)) return res.status(400).json({ error: `Unknown model "${model}".` });
  advisor.setModel(model);
  res.json({ ok: true, model });
});

// The key is checked against the API before it's stored, so a typo shows
// up here rather than as a failed chat later. It's never sent back out.
router.post('/key', express.json(), async (req, res) => {
  const { apiKey, clear } = req.body || {};
  if (clear) {
    deleteSetting('anthropic_api_key');
    return res.json({ ok: true, source: advisor.keySource() });
  }
  const key = String(apiKey || '').trim();
  if (!key) return res.status(400).json({ error: 'Paste an API key first.' });
  try {
    await advisor.verifyKey(key);
  } catch (err) {
    return res.status(400).json({ error: advisor.describeError(err) });
  }
  setSetting('anthropic_api_key', key);
  res.json({ ok: true, source: advisor.keySource() });
});

// Spending guard: every question is billed to the manager's Anthropic
// account, so cap how many can start per hour and how many run at once,
// app-wide (one club, one key; per-IP limits mean little behind a home
// router or reverse proxy). Tune with ADVISOR_MAX_PER_HOUR.
const MAX_PER_HOUR = Number(process.env.ADVISOR_MAX_PER_HOUR) || 30;
const MAX_CONCURRENT = 2;
const recentStarts = [];
let running = 0;

function rateLimitError() {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  while (recentStarts.length && recentStarts[0] < hourAgo) recentStarts.shift();
  if (recentStarts.length >= MAX_PER_HOUR) {
    const minutes = Math.ceil((recentStarts[0] - hourAgo) / 60000);
    return `Question limit reached (${MAX_PER_HOUR} per hour). Try again in ~${minutes} min.`;
  }
  if (running >= MAX_CONCURRENT) return 'Already answering other questions. Try again in a moment.';
  return null;
}

// Streams the answer as server-sent events over the POST response:
// start → (tool | text)* → done | error.
router.post('/chat', express.json(), async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message is empty.' });
  if (message.length > 4000) return res.status(400).json({ error: 'Message is too long (max 4000 characters).' });

  const limited = rateLimitError();
  if (limited) return res.status(429).json({ error: limited });

  const conv = advisor.getConversation(req.body?.conversationId);
  if (conv.busy) return res.status(409).json({ error: 'Still answering the previous question.' });
  conv.busy = true;
  recentStarts.push(Date.now());
  running += 1;

  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Closing the tab (or the Stop button) aborts the API call too.
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  emit('start', { conversationId: conv.id });
  try {
    await advisor.chat(conv, message, emit, controller.signal);
    emit('done', {});
  } catch (err) {
    if (!controller.signal.aborted) {
      console.error('Advisor chat failed:', err);
      emit('error', { message: advisor.describeError(err) });
    }
  } finally {
    conv.busy = false;
    running -= 1;
    res.end();
  }
});

module.exports = router;
