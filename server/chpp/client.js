// Thin client for Hattrick's CHPP API: OAuth 1.0a (three-legged, out-of-band
// verifier flow — Hattrick has no callback-URL concept, it shows the user a
// code on its own site) plus signed GET requests against chppxml.ashx.
//
// Endpoints and flow confirmed against the official CHPP manual and the
// pychpp reference client (chpp.hattrick.org uses GET + HMAC-SHA1 for every
// OAuth step; oauth_callback=oob is required on the request-token call).
const crypto = require('crypto');
const OAuth = require('oauth-1.0a');
const { XMLParser } = require('fast-xml-parser');

const REQUEST_TOKEN_URL = 'https://chpp.hattrick.org/oauth/request_token.ashx';
const AUTHORIZE_URL = 'https://chpp.hattrick.org/oauth/authorize.aspx';
const ACCESS_TOKEN_URL = 'https://chpp.hattrick.org/oauth/access_token.ashx';
const DATA_URL = 'https://chpp.hattrick.org/chppxml.ashx';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  trimValues: true,
  // fast-xml-parser only produces an array when a tag repeats; CHPP list
  // elements (a squad with one player, a fixture list with one match) would
  // otherwise silently collapse to a single object. Force these to always
  // be arrays so downstream parsing code doesn't special-case count === 1.
  isArray: (tagName) => ['Player', 'Match', 'Trophy', 'Staff', 'StaffMember'].includes(tagName),
});

function makeOAuth(consumerKey, consumerSecret) {
  return new OAuth({
    consumer: { key: consumerKey, secret: consumerSecret },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString, key) {
      return crypto.createHmac('sha1', key).update(baseString).digest('base64');
    },
  });
}

function parseFormEncoded(text) {
  return Object.fromEntries(new URLSearchParams(text));
}

class ChppError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'ChppError';
    this.status = status;
    this.body = body;
  }
}

/** Step 1: get a request token. oauth_callback=oob because CHPP has no web callback. */
async function getRequestToken(consumerKey, consumerSecret) {
  const oauth = makeOAuth(consumerKey, consumerSecret);
  const requestData = { url: REQUEST_TOKEN_URL, method: 'GET', data: { oauth_callback: 'oob' } };
  const headers = oauth.toHeader(oauth.authorize(requestData));
  const qs = new URLSearchParams(requestData.data).toString();
  const res = await fetch(`${REQUEST_TOKEN_URL}?${qs}`, { headers });
  const text = await res.text();
  if (!res.ok) throw new ChppError('Could not get a CHPP request token — check the consumer key/secret.', { status: res.status, body: text });
  const parsed = parseFormEncoded(text);
  if (!parsed.oauth_token) throw new ChppError('CHPP did not return a request token.', { body: text });
  return { token: parsed.oauth_token, tokenSecret: parsed.oauth_token_secret };
}

/** Step 2: the URL to send the user to. They approve on hattrick.org and get a verifier code back. */
function buildAuthorizeUrl(requestToken) {
  return `${AUTHORIZE_URL}?oauth_token=${encodeURIComponent(requestToken)}`;
}

/** Step 3: exchange the request token + the verifier code the user pasted back for an access token. */
async function getAccessToken(consumerKey, consumerSecret, requestToken, requestTokenSecret, verifier) {
  const oauth = makeOAuth(consumerKey, consumerSecret);
  const requestData = { url: ACCESS_TOKEN_URL, method: 'GET', data: { oauth_verifier: verifier } };
  const token = { key: requestToken, secret: requestTokenSecret };
  const headers = oauth.toHeader(oauth.authorize(requestData, token));
  const qs = new URLSearchParams(requestData.data).toString();
  const res = await fetch(`${ACCESS_TOKEN_URL}?${qs}`, { headers });
  const text = await res.text();
  if (!res.ok) throw new ChppError('Could not exchange the verifier code for an access token — double-check the code and try connecting again.', { status: res.status, body: text });
  const parsed = parseFormEncoded(text);
  if (!parsed.oauth_token) throw new ChppError('CHPP did not return an access token.', { body: text });
  return { token: parsed.oauth_token, tokenSecret: parsed.oauth_token_secret };
}

/**
 * Call a CHPP data file (e.g. file=teamdetails&version=3.4) with the stored
 * access token, and return it parsed from XML into a plain JS object.
 */
async function callChpp({ consumerKey, consumerSecret, accessToken, accessTokenSecret, file, version, params = {} }) {
  const oauth = makeOAuth(consumerKey, consumerSecret);
  const data = { file, version, ...params };
  const requestData = { url: DATA_URL, method: 'GET', data };
  const token = { key: accessToken, secret: accessTokenSecret };
  const headers = oauth.toHeader(oauth.authorize(requestData, token));
  const qs = new URLSearchParams(
    Object.entries(data).filter(([, v]) => v !== undefined && v !== null)
  ).toString();
  const res = await fetch(`${DATA_URL}?${qs}`, { headers });
  const text = await res.text();
  if (!res.ok) throw new ChppError(`CHPP request for file=${file} failed (HTTP ${res.status}).`, { status: res.status, body: text });

  const parsed = xmlParser.parse(text);
  const root = parsed.HattrickData;
  if (root && root.Error) {
    const err = root.Error;
    throw new ChppError(`CHPP error ${err.Code ?? ''}: ${err.Message ?? 'unknown error'}`.trim(), { body: text });
  }
  return root ?? parsed;
}

module.exports = {
  ChppError,
  getRequestToken,
  buildAuthorizeUrl,
  getAccessToken,
  callChpp,
};
