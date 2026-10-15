// R7: strategy engine tests: hand-computed payoff vertices for every library strategy, BS reference values,
// recommend() ordering on fixtures. Run: node --test app/test/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../strategies.js');
const near = (a, b, tol = 1e-6, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, want ${b}`);

test('Black-Scholes reference values (S=K=100, T=1, r=5%, vol=20%) + put-call parity', () => {
  near(S.bs('call', 100, 100, 1, 0.05, 0.2), 10.4506, 1e-3, 'call');
  near(S.bs('put', 100, 100, 1, 0.05, 0.2), 5.5735, 1e-3, 'put');
  const c = S.bs('call', 120, 110, 0.3, 0.04, 0.35), p = S.bs('put', 120, 110, 0.3, 0.04, 0.35);
  near(c - p, 120 - 110 * Math.exp(-0.04 * 0.3), 1e-6, 'parity');
  near(S.probAbove(100, 100, 1, 0, 0.2), 0.4602, 1e-3, 'N(d2)');
});

// [id, strikes, premiums (per leg, stock leg = entry price), {maxGain, maxLoss, be:[...], at:[[ST, pnl]...]}] - computed by hand
const INF = Infinity;
const CASES = [
  ['long_stock', [], [100], {maxGain: INF, maxLoss: -100, be: [100], at: [[120, 20]]}],
  ['short_stock', [], [100], {maxGain: 100, maxLoss: -INF, be: [100], at: [[80, 20]]}],
  ['long_call', [105], [2], {maxGain: INF, maxLoss: -2, be: [107], at: [[110, 3], [100, -2]]}],
  ['long_put', [95], [2], {maxGain: 93, maxLoss: -2, be: [93], at: [[90, 3]]}],
  ['covered_call', [105], [100, 2], {maxGain: 7, maxLoss: -98, be: [98], at: [[110, 7], [100, 2]]}],
  ['cash_secured_put', [95], [3], {maxGain: 3, maxLoss: -92, be: [92], at: [[90, -2]]}],
  ['wheel', [95], [3], {maxGain: 3, maxLoss: -92, be: [92]}],
  ['protective_put', [95], [100, 2], {maxGain: INF, maxLoss: -7, be: [102], at: [[120, 18]]}],
  ['married_put', [95], [100, 2], {maxGain: INF, maxLoss: -7, be: [102]}],
  ['collar', [95, 105], [100, 2, 1.5], {maxGain: 4.5, maxLoss: -5.5, be: [100.5]}],
  ['bull_call_spread', [100, 110], [5, 2], {maxGain: 7, maxLoss: -3, be: [103]}],
  ['bear_put_spread', [90, 100], [2, 5], {maxGain: 7, maxLoss: -3, be: [97]}],
  ['bull_put_spread', [90, 95], [1, 2.5], {maxGain: 1.5, maxLoss: -3.5, be: [93.5]}],
  ['bear_call_spread', [105, 110], [2.5, 1], {maxGain: 1.5, maxLoss: -3.5, be: [106.5]}],
  ['long_straddle', [100, 100], [3, 3], {maxGain: INF, maxLoss: -6, be: [94, 106]}],
  ['short_straddle', [100, 100], [3, 3], {maxGain: 6, maxLoss: -INF, be: [94, 106]}],
  ['long_strangle', [90, 110], [1, 1], {maxGain: INF, maxLoss: -2, be: [88, 112]}],
  ['short_strangle', [90, 110], [1, 1], {maxGain: 2, maxLoss: -INF, be: [88, 112]}],
  ['iron_condor', [85, 90, 110, 115], [0.5, 1.5, 1.5, 0.5], {maxGain: 2, maxLoss: -3, be: [88, 112]}],
  ['iron_butterfly', [90, 100, 100, 110], [1, 4, 4, 1], {maxGain: 6, maxLoss: -4, be: [94, 106]}],
  ['butterfly', [90, 100, 110], [12, 5, 1.5], {maxGain: 6.5, maxLoss: -3.5, be: [93.5, 106.5]}],
  ['bwb', [85, 95, 100], [0.5, 2, 4], {maxGain: 4.5, maxLoss: -5.5, be: [90.5, 99.5], at: [[120, -0.5]]}],
  ['jade_lizard', [90, 105, 110], [2, 1.5, 0.5], {maxGain: 3, maxLoss: -87, be: [87, 108], at: [[150, -2]]}],
  ['call_ratio', [100, 110], [5, 2], {maxGain: 9, maxLoss: -INF, be: [101, 119]}],
  ['put_ratio', [90, 100], [2, 5], {maxGain: 9, maxLoss: -81, be: [81, 99]}],
  ['call_backspread', [100, 110], [5, 2], {maxGain: INF, maxLoss: -9, be: [101, 119], at: [[50, 1]]}],
  ['put_backspread', [90, 100], [2, 5], {maxGain: 81, maxLoss: -9, be: [81, 99], at: [[150, 1]]}],
  ['synthetic_long', [100, 100], [3, 2.5], {maxGain: INF, maxLoss: -100.5, be: [100.5], at: [[110, 9.5]]}],
  ['synthetic_short', [100, 100], [3, 2.5], {maxGain: 99.5, maxLoss: -INF, be: [99.5]}],
];

for (const [id, strikes, premiums, want] of CASES) {
  test(`payoff vertices: ${id}`, () => {
    const p = S.payoff(id, {S: 100, days: 30, strikes, premiums});
    assert.ok(p.ok, p.reason);
    assert.equal(p.maxGain === INF ? INF : +p.maxGain.toFixed(6), want.maxGain, 'maxGain');
    assert.equal(p.maxLoss === -INF ? -INF : +p.maxLoss.toFixed(6), want.maxLoss, 'maxLoss');
    assert.equal(p.breakevens.length, want.be.length, 'breakeven count ' + p.breakevens);
    want.be.forEach((b, i) => near(p.breakevens[i], b, 1e-6, 'be' + i));
    for (const [x, y] of want.at || []) near(p.pnlAt(x), y, 1e-9, 'pnl@' + x);
    assert.match(p.label, /user-entered/);
  });
}

test('every priceable library strategy has a test case or is a model-only time spread', () => {
  const tested = new Set(CASES.map(c => c[0]));
  const untested = S.list().filter(s => !tested.has(s.id) && s.legs.length && !s.legs.some(l => l.far)).map(s => s.id);
  assert.deepEqual(untested, []);
  assert.ok(S.list().length >= 30, 'expansive library');
  for (const s of S.list()) for (const k of ['id', 'name', 'family', 'level', 'plain', 'fits', 'shape', 'maxGain', 'maxLoss', 'be', 'risks', 'tax']) assert.ok(s[k] != null && s[k] !== '', `${s.id}.${k}`);
});

test('time spreads (calendar, diagonal, PMCC): loss capped at the debit, peak near the short strike', () => {
  for (const id of ['calendar', 'diagonal', 'pmcc']) {
    const p = S.payoff(id, {S: 100, iv: 30, days: 30, r: 0.04});
    assert.ok(p.ok, id); assert.ok(p.net < 0, id + ' is a debit');
    near(p.maxLoss, p.net, 0.05, id + ' max loss ~ debit');
    const shortK = p.legs.find(l => l.side < 0).k;
    assert.ok(p.pnlAt(shortK) > p.pnlAt(shortK * 0.7) && p.pnlAt(shortK) > p.pnlAt(shortK * 1.4), id + ' peak near short strike');
  }
});

test('model pricing: labelled, strikes on increments, expected move band, no fabrication without IV', () => {
  const p = S.payoff('iron_condor', {S: 182.4, iv: 32, days: 30, r: 0.0428});
  assert.ok(p.ok); assert.match(p.label, /model estimate .* not a market quote/);
  for (const k of p.strikes) near(k / 2.5, Math.round(k / 2.5), 1e-9, 'increment');
  assert.ok(p.expMove.lo < 182.4 && p.expMove.hi > 182.4);
  assert.ok(p.pop > 0 && p.pop < 1);
  const q = S.payoff('iron_condor', {S: 182.4, iv: null, days: 30});
  assert.equal(q.ok, false); assert.match(q.reason, /IV missing/);
  const st = S.payoff('long_stock', {S: 182.4, iv: null, days: 30});
  assert.ok(st.ok, 'stock needs no IV'); assert.equal(st.pop, null);
  assert.equal(S.payoff('pairs_relative', {S: 100, iv: 30}).ok, false);
  assert.equal(S.payoff('cash_defensive', {S: 100, iv: 30}).maxLoss, 0);
});

const base = {ticker: 'FIX', price: 100, horizon_days: 30, risk_tolerance: 'medium'};
const top = r => r.ranked.map(x => S.get(x.id));

test('recommend: bullish + low vol -> bullish, long-vol / stock first', () => {
  const r = S.recommend(Object.assign({}, base, {stance: 'bullish', trend: 'up', iv: 22, realized_vol: 25, regime: 70, horizon_days: 45}));
  assert.ok(['long_call', 'long_stock'].includes(r.ranked[0].id), r.ranked[0].id);
  for (const s of top(r).slice(0, 3)) assert.ok(s.dir > 0, s.id);
  assert.ok(r.ranked.length >= 5 && r.ranked.length <= 8);
  assert.ok(r.whyNot.length > 0 && r.whyNot.every(w => w.why));
});

test('recommend: neutral + high vol -> short-vol defined-risk first', () => {
  const r = S.recommend(Object.assign({}, base, {stance: 'neutral', trend: 'flat', iv: 40, realized_vol: 25, regime: 55}));
  assert.ok(['iron_condor', 'iron_butterfly'].includes(r.ranked[0].id), r.ranked[0].id);
  for (const s of top(r).slice(0, 3)) assert.ok(s.vol < 0, s.id);
});

test('recommend: bearish + earnings week -> bearish defined risk first, short-vol pushed down', () => {
  const r = S.recommend(Object.assign({}, base, {stance: 'bearish', trend: 'down', iv: 45, realized_vol: 30, regime: 35, horizon_days: 10, days_to_earnings: 4}));
  const s0 = S.get(r.ranked[0].id);
  assert.ok(s0.dir < 0 && s0.risk === 'defined', s0.id);
  const ss = r.whyNot.find(w => w.id === 'short_strangle'); assert.ok(ss && /Earnings/.test(ss.why), 'short strangle ruled out for earnings');
});

test('recommend: missing IV -> stock first, option payoffs unavailable with reason, input listed missing', () => {
  const r = S.recommend(Object.assign({}, base, {stance: 'bullish', trend: 'up', regime: 60}));
  assert.equal(r.ranked[0].id, 'long_stock');
  assert.ok(r.missing.includes('iv'));
  const opt = r.ranked.find(x => S.get(x.id).legs.some(l => l.type !== 'stock'));
  assert.ok(opt && opt.payoff.unavailable && /IV/.test(opt.payoff.unavailable));
  assert.ok(opt.parts.some(p => p.rule === 'noiv'));
});

test('recommend: every ranked entry shows the rules that scored it and a flip line', () => {
  const r = S.recommend(Object.assign({}, base, {stance: 'neutral', trend: 'flat', iv: 30, realized_vol: 30}));
  for (const x of r.ranked) { assert.ok(Array.isArray(x.parts)); assert.ok(x.flip); assert.ok(isFinite(x.score)); }
  assert.ok(r.rules.length >= 10 && r.rules.every(R => R.desc));
});

test('flowHint (Flow step 4 hook): ranked names from the flow inputs, no NaN, missing inputs listed', () => {
  const prev = globalThis.SO2;
  globalThis.SO2 = {D: () => ({rel: {regime: {score: 55}, vol_breadth: {term_ratio: {value: 0.9}}}, macro: {curve: [{id: 'us3m', v: 4.28}]}})};
  try {
    const h = S.flowHint({ticker: 'FIX', price: 100, iv: 40, realized_vol: 25, days_to_earnings: 50, horizon_days: 30, name_word: 'MIXED'});
    assert.match(h, /Strategy engine \(top 5 of \d+, stance neutral/);
    assert.ok(!/NaN|undefined/.test(h.replace(/<[^>]+>/g, '')));
    const h2 = S.flowHint({ticker: 'FIX', price: 100, name_word: 'STRONG'});
    assert.match(h2, /stance bullish/); assert.match(h2, /missing: iv/);
  } finally { globalThis.SO2 = prev; }
});
