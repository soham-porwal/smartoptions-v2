// R8: model-confidence tests (monotonicity, weights, ranking stability, reasons present, no NaN). Run: node --test app/test/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../confidence.js');

const sig = (n, s) => Array.from({length: n}, (_, i) => ({label: 'sig' + i, text: 'x', signal: s, rule: 'r'}));
const row = (o) => Object.assign({t: 'AAA', up: 10, ern: 45, er: '2026-11-30', st: {price: 'ok', chg: 'ok', pe_forward: 'ok', earnings: 'ok'},
  rel: {t: {spy: 5, vix: -1}, r2: 0.4, n: 252}, sam: {q: 'GOOD', opp: 40, trend: 60, risk: 'SAFE', flags: 'CLEAR', label: 'SmartOptions snapshot 2026-07-25'}}, o || {});
const base = (o) => Object.assign({ticker: 'AAA', row: row(), tech: {rows: sig(4, 'bullish'), asof: '2026-10-15', n: 260}, patterns: {detections: [], n: 260, asof: '2026-10-15'},
  flow: null, regime: {score: 77, tier: 'FAVORABLE'}, cycle: {phase: 'expanding'}, events: [], asof: '2026-10-15'}, o || {});

test('label is verbatim and weights sum to 1', () => {
  assert.equal(C.LABEL, 'model confidence: agreement and data quality, NOT probability of profit');
  assert.equal(Math.round(Object.values(C.WEIGHTS).reduce((a, b) => a + b, 0) * 1e9) / 1e9, 1);
});

test('more agreement -> higher score', () => {
  const agree = C.compute(base()).score;
  const split = C.compute(base({tech: {rows: sig(2, 'bullish').concat(sig(3, 'bearish')), asof: '2026-10-15', n: 260}})).score;
  assert.ok(agree > split, `${agree} > ${split}`);
});

test('missing / non-ok data -> lower score, and the missing fields are named in the reasons', () => {
  const full = C.compute(base());
  const gaps = C.compute(base({row: row({st: {price: 'ok', chg: 'stale', pe_forward: 'missing', earnings: 'ok'}})}));
  assert.ok(full.score > gaps.score);
  const d = gaps.components.find(c => c.key === 'data');
  assert.ok(d.reasons.some(r => r.name === 'pe_forward' && r.value === 'missing'));
  const noRel = C.compute(base({row: row({rel: null})})); assert.ok(noRel.score < full.score);
});

test('earnings inside 7 days and FOMC lower the event component', () => {
  const far = C.compute(base()).components.find(c => c.key === 'events').score;
  const near = C.compute(base({row: row({ern: 3}), events: [{type: 'FOMC', date: '2026-10-20', days: 5}]})).components.find(c => c.key === 'events').score;
  assert.ok(far > near);
});

test('regime fit uses Sam tiers and mirrors for a bearish lean', () => {
  const bullFav = C.compute(base()).components.find(c => c.key === 'regime').score;
  const bullDef = C.compute(base({regime: {score: 30, tier: 'DEFENSIVE'}})).components.find(c => c.key === 'regime').score;
  assert.ok(bullFav > bullDef);
  const bear = C.compute(base({tech: {rows: sig(5, 'bearish'), asof: '2026-10-15', n: 260}, row: row({up: -5, sam: null}), regime: {score: 30, tier: 'DEFENSIVE'}}));
  assert.equal(bear.direction, 'bearish'); assert.ok(bear.components.find(c => c.key === 'regime').score > bullDef);
});

test('ranking is stable (ties by ticker) and every result has a plain-language why with no NaN', () => {
  const a = C.compute(base({ticker: 'BBB'})), b = C.compute(base({ticker: 'AAA'})), c = C.compute(base({ticker: 'CCC', row: row({ern: 2})}));
  const r1 = C.rank([a, b, c]).map(x => x.ticker), r2 = C.rank([c, b, a]).map(x => x.ticker);
  assert.deepEqual(r1, r2); assert.deepEqual(r1.slice(0, 2), ['AAA', 'BBB']);
  for (const x of [a, b, c]) {
    assert.ok(x.headline.length > 40); assert.ok(x.components.length === 5 && x.components.every(k => k.reasons.length));
    assert.ok(!/NaN|undefined/.test(JSON.stringify(x)), JSON.stringify(x)); assert.ok(x.score >= 0 && x.score <= 100);
  }
  const empty = C.compute({ticker: 'ZZZ', row: {}, events: []}); assert.ok(!/NaN|undefined/.test(JSON.stringify(empty))); assert.equal(empty.direction, 'neutral');
});

test("Sam's scores are carried beside, not merged into the score", () => {
  const withSam = C.compute(base({row: row({sam: {q: 'OK', opp: 99, trend: 99, risk: 'SAFE', flags: 'CLEAR'}})}));
  const otherOpp = C.compute(base({row: row({sam: {q: 'OK', opp: 1, trend: 1, risk: 'AVOID', flags: 'LOW_IV'}})}));
  assert.equal(withSam.score, otherOpp.score); assert.equal(withSam.sam.opportunity, 99);
});
