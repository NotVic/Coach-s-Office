const express = require('express');
const { buildYouthAcademy } = require('../services/youthAcademy');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(buildYouthAcademy());
});

module.exports = router;
