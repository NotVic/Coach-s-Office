const express = require('express');
const { getSetting, setSetting, deleteSetting } = require('../db');
const chpp = require('./client');
const { runFullSync } = require('../services/sync');

const router = express.Router();

function credentials() {
  const consumerKey = getSetting('chpp_consumer_key') || process.env.CHPP_CONSUMER_KEY || '';
  const consumerSecret = getSetting('chpp_consumer_secret') || process.env.CHPP_CONSUMER_SECRET || '';
  return { consumerKey, consumerSecret };
}

router.get('/status', (req, res) => {
  const { consumerKey, consumerSecret } = credentials();
  res.json({
    consumerKeysConfigured: Boolean(consumerKey && consumerSecret),
    connected: Boolean(getSetting('chpp_access_token')),
    teamId: getSetting('chpp_team_id'),
    teamName: getSetting('chpp_team_name'),
    lastSyncAt: getSetting('last_sync_at'),
  });
});

router.post('/consumer-keys', express.json(), (req, res) => {
  const { consumerKey, consumerSecret } = req.body || {};
  if (!consumerKey || !consumerSecret) {
    return res.status(400).json({ error: 'Both a consumer key and consumer secret are required.' });
  }
  setSetting('chpp_consumer_key', consumerKey.trim());
  setSetting('chpp_consumer_secret', consumerSecret.trim());
  res.json({ ok: true });
});

// Step 1: get a request token and hand back the hattrick.org URL the user
// needs to open. They'll approve there and get a verification code back —
// there's no callback URL because CHPP's OAuth flow is out-of-band.
router.post('/connect', async (req, res) => {
  const { consumerKey, consumerSecret } = credentials();
  if (!consumerKey || !consumerSecret) {
    return res.status(400).json({ error: 'Add your CHPP consumer key and secret first.' });
  }
  try {
    const { token, tokenSecret } = await chpp.getRequestToken(consumerKey, consumerSecret);
    setSetting('chpp_request_token', token);
    setSetting('chpp_request_token_secret', tokenSecret);
    res.json({ authorizeUrl: chpp.buildAuthorizeUrl(token) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Step 2: the user pastes back the verification code Hattrick showed them.
router.post('/verify', express.json(), async (req, res) => {
  const { verifier } = req.body || {};
  if (!verifier || !verifier.trim()) {
    return res.status(400).json({ error: 'Paste the verification code Hattrick showed you.' });
  }
  const { consumerKey, consumerSecret } = credentials();
  const requestToken = getSetting('chpp_request_token');
  const requestTokenSecret = getSetting('chpp_request_token_secret');
  if (!requestToken || !requestTokenSecret) {
    return res.status(400).json({ error: 'No connect attempt in progress — click Connect again first.' });
  }
  try {
    const { token, tokenSecret } = await chpp.getAccessToken(
      consumerKey, consumerSecret, requestToken, requestTokenSecret, verifier.trim()
    );
    setSetting('chpp_access_token', token);
    setSetting('chpp_access_token_secret', tokenSecret);
    deleteSetting('chpp_request_token');
    deleteSetting('chpp_request_token_secret');

    const result = await runFullSync({ isInitial: true });
    res.json({ ok: true, sync: result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/disconnect', (req, res) => {
  ['chpp_access_token', 'chpp_access_token_secret', 'chpp_request_token', 'chpp_request_token_secret']
    .forEach(deleteSetting);
  res.json({ ok: true });
});

router.post('/sync-now', async (req, res) => {
  if (!getSetting('chpp_access_token')) {
    return res.status(400).json({ error: 'Connect to Hattrick first.' });
  }
  try {
    const result = await runFullSync({ isInitial: false });
    res.json({ ok: true, sync: result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = { router, credentials };
