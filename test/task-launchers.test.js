'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../flow.js');

test('today assessment reports no coverage without inventing a favorable market', () => {
  const D = {rows: [], macro: {}, rel: {}, spy_close: []};
  for (const minInputs of [0, 4]) {
    const out = F.launcherAssessment(D, {...F.DEFAULT_RULES, minInputs});
    assert.equal(out.covered, false);
    assert.match(out.text, /Insufficient coverage/);
    assert.match(out.text, /volatility data is unavailable/);
    assert.equal(out.votes, 0);
  }
});

test('today assessment restates actual verdicts, measured source periods, and leaves data intact', () => {
  const D = require('../data/core.json');
  const before = JSON.stringify(D);
  const market = F.marketVerdict(F.marketInputs(D, F.DEFAULT_RULES), F.DEFAULT_RULES);
  const vol = F.volVerdict(F.volInputs(D), F.DEFAULT_RULES);
  const out = F.launcherAssessment(D);
  assert.equal(out.market, market.word);
  assert.equal(out.volatility, vol.word);
  assert.equal(out.votes, market.n);
  assert.equal(out.session, D.asof_session);
  assert.ok(out.providers.length > 0);
  assert.ok(out.periods.length > 0);
  assert.equal(JSON.stringify(D), before);
});

test('peer divergence compares same-sector same-session observed returns only', () => {
  const D = {asof_session: '2026-10-15', rows: [
    {t: 'LEAD', sec: 'Technology', d1: 3, pxd: '2026-10-15'},
    {t: 'MID', sec: 'Technology', d1: 1, pxd: '2026-10-15'},
    {t: 'LAG', sec: 'Technology', d1: -2, pxd: '2026-10-15'},
    {t: 'OLD', sec: 'Technology', d1: -99, pxd: '2026-10-14'}
  ]};
  assert.deepEqual(F.peerDivergence(D), {sector: 'Technology', laggard: 'LAG', leader: 'LEAD', laggardChange: -2, leaderChange: 3, gap: 5, date: D.asof_session, count: 3});
  assert.equal(F.peerDivergence({asof_session: D.asof_session, rows: D.rows.slice(2)}), null);
});
