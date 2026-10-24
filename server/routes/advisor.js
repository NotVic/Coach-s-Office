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

// Streams the answer as server-sent events over the POST response:
// start → (tool | text)* → done | error.
router.post('/chat', express.json(), async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message is empty.' });
  if (message.length > 4000) return res.status(400).json({ error: 'Message is too long (max 4000 characters).' });

  const conv = advisor.getConversation(req.body?.conversationId);
  if (conv.busy) return res.status(409).json({ error: 'Still answering the previous question.' });
  conv.busy = true;

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
    res.end();
  }
});

module.exports = router;
