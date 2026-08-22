require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const express = require('express');

const { router: chppRouter } = require('./chpp/routes');
const dashboardRouter = require('./routes/dashboard');
const playersRouter = require('./routes/players');
const matchPrepRouter = require('./routes/matchPrep');
const digestRouter = require('./routes/digest');
const settingsRouter = require('./routes/settings');
const scheduler = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Optional shared-password gate. Off by default (fine on a LAN-only home
// server); set APP_PASSWORD if this is ever reachable from the internet.
const APP_PASSWORD = process.env.APP_PASSWORD || '';
if (APP_PASSWORD) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [, suppliedPassword = ''] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
      const supplied = Buffer.from(suppliedPassword);
      const expected = Buffer.from(APP_PASSWORD);
      if (supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)) {
        return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="Coach\'s Office"');
    res.status(401).send('Authentication required.');
  });
}

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/chpp', chppRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/players', playersRouter);
app.use('/api/match-prep', matchPrepRouter);
app.use('/api/digest', digestRouter);
app.use('/api/settings', settingsRouter);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => {
  console.log(`Coach's Office listening on port ${PORT}`);
  scheduler.start();
});
