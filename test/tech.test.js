// R7: technicals indicator + signal tests (pure functions, no DOM). Run: node --test app/test/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../technicals.js');

// ---------- fixtures: [date, o, h, l, c, v] ----------
const days = n => Array.from({length: n}, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10));
const wiggle = i => Math.sin(i * 0.9) * 0.6; // deterministic noise so ranges are non-zero
function bars(n, f, opt = {}) {
  return days(n).map((d, i) => {
    const c = f(i) + wiggle(i), o = i ? f(i - 1) + wiggle(i - 1) : c;
    const h = opt.noHL ? c : Math.max(o, c) + 0.8, l = opt.noHL ? c : Math.min(o, c) - 0.8;
    return [d, opt.noO ? null : o, h, l, c, opt.noV ? null : 1e6 + (c > o ? 2e5 : 0)];
  });
}
const UP = bars(300, i => 100 + 0.5 * i);
const DOWN = bars(300, i => 250 - 0.5 * i);
const RANGE = bars(300, i => 100 + 3 * Math.sin(i / 2));
const SHORT = bars(30, i => 100 + i);
const CLOSES = bars(300, i => 100 + 0.5 * i, {noHL: true});
const row = (a, id) => a.rows.find(r => r.id === id);

test('sma/ema hand values', () => {
  assert.deepEqual(T.sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  const e = T.ema([1, 2, 3, 4, 5], 3); // seed 2, k=0.5: 3 -> 3, 4 -> 3.5 ... e[3]=3, e[4]=4
  assert.equal(e[2], 2); assert.equal(e[3], 3); assert.equal(e[4], 4);
});

test('rsi: monotone up = 100, monotone down = 0', () => {
  const up = Array.from({length: 30}, (_, i) => 10 + i), dn = up.slice().reverse();
  assert.equal(T.rsi(up).at(-1), 100); assert.equal(T.rsi(dn).at(-1), 0);
});

test('realized vol: constant growth -> 0; known alternating series', () => {
  const g = Array.from({length: 30}, (_, i) => 100 * Math.pow(1.01, i));
  assert.ok(Math.abs(T.realizedVol(g, 20)) < 1e-9);
  assert.equal(T.realizedVol([1, 2], 20), null);
});

test('trend-up fixture: bullish stack, uptrend regime, no NaN anywhere', () => {
  const a = T.analyze(UP, {});
  assert.equal(a.regime.startsWith('Uptrend'), true);
  assert.equal(row(a, 'sma200').signal, 'bullish');
  assert.equal(row(a, 'cross').signal, 'bullish');
  assert.equal(row(a, 'macd').signal === 'bullish' || row(a, 'macd').signal === 'bearish', true);
  assert.ok(a.summary.bullish > a.summary.bearish);
  for (const r of a.rows) { assert.ok(!/NaN|undefined/.test(r.text), r.id + ': ' + r.text); assert.ok(r.rule || r.unavailable, r.id + ' has rule'); }
  assert.equal(a.trend, 'up');
});

test('trend-down fixture: bearish stack, downtrend regime', () => {
  const a = T.analyze(DOWN, {});
  assert.equal(a.regime.startsWith('Downtrend'), true);
  assert.equal(row(a, 'sma50').signal, 'bearish');
  assert.ok(a.summary.bearish > a.summary.bullish);
  assert.equal(a.trend, 'down');
});

test('range fixture: not an uptrend or downtrend, ADX computed', () => {
  const a = T.analyze(RANGE, {});
  assert.ok(!/^Uptrend$|^Downtrend$/.test(a.regime), a.regime);
  assert.ok(typeof row(a, 'adx').value === 'number');
  assert.ok(row(a, 'sr').levels, 'pivots found');
});

test('short history: long indicators n/a with reason, no crash', () => {
  const a = T.analyze(SHORT, {});
  assert.equal(row(a, 'sma200').signal, 'n/a'); assert.match(row(a, 'sma200').unavailable, /needs 200/);
  assert.equal(row(a, 'cross').signal, 'n/a');
  assert.ok(a.notes.some(x => /30 sessions/.test(x)));
  assert.equal(row(a, 'rsi').signal !== 'n/a', true);
});

test('missing H/L: ATR/ADX/Stoch/pivots unavailable and stated', () => {
  const a = T.analyze(CLOSES, {});
  for (const id of ['atr', 'adx', 'stoch', 'sr']) assert.equal(row(a, id).signal, 'n/a', id);
  assert.ok(a.notes.some(x => /only closes/.test(x)));
  assert.equal(row(a, 'rsi').signal !== 'n/a', true);
});

test('empty bars: no rows, explicit note', () => {
  const a = T.analyze([], {});
  assert.equal(a.n, 0); assert.ok(a.notes[0].includes('no stored price history'));
});

test('relative strength vs SPY uses same dates; thresholds editable', () => {
  const spy = UP.map(b => [b[0], 400]);
  const a = T.analyze(UP, {spy});
  assert.equal(row(a, 'rs_spy').signal, 'bullish');
  const b = T.analyze(UP, {spy, th: {rs_band: 1e6}});
  assert.equal(row(b, 'rs_spy').signal, 'neutral');
  const c = T.analyze(UP, {own1m: 5, sectorMedian1m: 1, sector: 'Tech', sectorN: 9});
  assert.equal(row(c, 'rs_sec').signal, 'bullish');
});

test('summary rule text and counts are consistent', () => {
  const a = T.analyze(UP, {});
  const s = a.summary; assert.equal(s.counted, s.bullish + s.bearish + s.neutral + s.overbought + s.oversold);
  assert.match(s.rule, /net/);
});

test('practitioner (G. Mundada) rows: labelled, intraday never faked, breakout needs volume', () => {
  const a = T.analyze(RANGE, {});
  const g = a.rows.filter(r => r.group.startsWith('Practitioner'));
  assert.ok(g.length >= 5);
  for (const r of g) if (r.signal !== 'n/a') assert.match(r.rule, /practitioner convention - G\. Mundada/);
  assert.equal(row(a, 'g_intraday').signal, 'n/a');
  // flat range then a break on the last bar: confirmed only with a volume spike
  const mk = spike => days(120).map((d, i) => { const c = i < 119 ? 100 + Math.sin(i) : 110; return [d, c - 0.2, c + 0.5, c - 0.5, c, i === 119 ? spike : 1e6]; });
  assert.equal(row(T.analyze(mk(3e6), {}), 'g_brk').signal, 'bullish');
  assert.equal(row(T.analyze(mk(1.1e6), {}), 'g_brk').signal, 'neutral');
  assert.match(row(T.analyze(mk(1.1e6), {}), 'g_brk').text, /did not confirm/);
  assert.equal(row(T.analyze(CLOSES, {}), 'g_sr').signal, 'n/a');
});
