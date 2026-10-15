// R6: verdict-rule tests for app/flow.js (pure functions, no DOM). Run: node --test app/test/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../flow.js');
const R = Object.assign({}, F.DEFAULT_RULES);

// ---------- fixtures ----------
const days = n => Array.from({length: n}, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10));
const ramp = (n, a, b) => days(n).map((d, i) => [d, a + (b - a) * i / (n - 1)]);
function core({spyFrom, spyTo, spyPath, regime, breadth, tenFrom, tenTo, hyFrom, hyTo, term, vix, vrp}) {
  const D = {asof_session: '2026-10-15', spy_close: spyPath || ramp(260, spyFrom, spyTo), calendar: [], rows: [],
    rel: {regime: {score: regime, tier: 'X'}, vol_breadth: {breadth_rsp_spy_20d: {value: breadth}, term_ratio: {value: term}, vrp: {value: vrp}}, insights: []},
    macro: {rates: [{id: 'us10y', v: tenTo, h: ramp(260, tenFrom, tenTo), provider: 'FRED', period: '2026-10-14'}],
      credit: [{id: 'hy_oas', v: hyTo, h: ramp(260, hyFrom, hyTo), provider: 'FRED'}],
      vol: [{id: 'vix', v: vix, h: ramp(260, 12, vix), provider: 'Cboe'}]}};
  return D;
}
const BULL = core({spyFrom: 400, spyTo: 600, regime: 77, breadth: 2.5, tenFrom: 4.6, tenTo: 4.0, hyFrom: 400, hyTo: 300, term: 0.85, vix: 14, vrp: 3});
const BEAR = core({spyFrom: 600, spyTo: 400, regime: 25, breadth: -3, tenFrom: 3.5, tenTo: 4.8, hyFrom: 300, hyTo: 500, term: 1.12, vix: 34, vrp: -2});
// up 200 sessions then down 60: price below the 50d (-1) but above the 200d (+1) -> trend votes cancel
const upDown = days(260).map((d, i) => [d, i < 200 ? 400 + 0.6 * i : 520 - (i - 200) * (20 / 59)]);
const NEUT = core({spyPath: upDown,regime: 50, breadth: 0.2, tenFrom: 4.2, tenTo: 4.2, hyFrom: 350, hyTo: 350, term: 0.9, vix: 17, vrp: 1});

// ---------- L1 market ----------
test('market: bullish fixture -> Lean bullish', () => {
  const v = F.marketVerdict(F.marketInputs(BULL, R), R);
  assert.equal(v.word, 'Lean bullish'); assert.ok(v.sum >= R.leanVotes); assert.equal(v.n, 7);
});
test('market: bearish fixture -> Lean bearish', () => {
  const v = F.marketVerdict(F.marketInputs(BEAR, R), R);
  assert.equal(v.word, 'Lean bearish'); assert.ok(v.sum <= -R.leanVotes);
});
test('market: neutral fixture -> Neutral', () => {
  const mi = F.marketInputs(NEUT, R), v = F.marketVerdict(mi, R);
  assert.equal(v.word, 'Neutral'); assert.ok(Math.abs(v.sum) < R.leanVotes);
});
test('market: missing data -> Insufficient data, reasons kept, no NaN', () => {
  const D = {asof_session: '2026-10-15', spy_close: [], rel: {}, macro: {}, calendar: [], rows: []};
  const mi = F.marketInputs(D, R), v = F.marketVerdict(mi, R);
  assert.equal(v.word, 'Insufficient data'); assert.equal(v.n, 0);
  for (const i of mi) { assert.equal(i.vote ?? null, null, i.id); assert.ok(i.why, 'missing input has a reason: ' + i.id); assert.ok(!Number.isNaN(i.value)); }
});
test('market: put/call and survey sentiment are declared unavailable, never voted', () => {
  const mi = F.marketInputs(BULL, R);
  for (const id of ['putcall', 'aaii']) { const i = mi.find(x => x.id === id); assert.equal(i.vote, null); assert.match(i.why, /unavailable/); }
});
test('market: thresholds are tunable (raising leanVotes turns bullish into neutral)', () => {
  const R2 = Object.assign({}, R, {leanVotes: 99});
  assert.equal(F.marketVerdict(F.marketInputs(BULL, R2), R2).word, 'Neutral');
});

// ---------- L2 vol ----------
test('vol: bands low / normal / elevated / stress', () => {
  const w = vix => F.volVerdict({vix, term: 0.9}, R).word;
  assert.equal(w(12), 'Low'); assert.equal(w(17), 'Normal'); assert.equal(w(24), 'Elevated'); assert.equal(w(35), 'Stress');
});
test('vol: backwardation raises Normal to Elevated but never lowers Stress', () => {
  const v = F.volVerdict({vix: 17, term: 1.05}, R); assert.equal(v.word, 'Elevated'); assert.ok(v.bumped);
  assert.equal(F.volVerdict({vix: 35, term: 1.05}, R).word, 'Stress');
});
test('vol: missing VIX -> Unknown', () => { assert.equal(F.volVerdict({vix: null}, R).word, 'Unknown'); });
test('vol: inputs from fixture carry percentile and VRP', () => {
  const x = F.volInputs(BEAR); assert.equal(x.vix, 34); assert.equal(x.vrp, -2); assert.equal(x.vixPct, 100);
});

// ---------- L3 names ----------
const spark = (a, b) => Array.from({length: 63}, (_, i) => a + (b - a) * i / 62);
const peers = Array.from({length: 6}, (_, i) => ({t: 'P' + i, sec: 'Tech', pef: 20}));
test('names: strong name (cheap, buy +20%, uptrend, GOOD snapshot) -> STRONG', () => {
  const r = {t: 'AAA', sec: 'Tech', pef: 15, rating: 'buy', up: 20, px: 130, m1: 5, spark: spark(100, 130), sam: {q: 'GOOD', trend: 80}};
  const dr = F.nameDrivers(r, F.sectorPE(peers.concat([r])), R), v = F.nameVerdict(dr, R);
  assert.equal(v.word, 'STRONG'); assert.equal(dr.length, 4); assert.ok(dr.every(d => d.chip));
});
test('names: weak name (rich, hold, downtrend, WEAK snapshot) -> WEAK', () => {
  const r = {t: 'BBB', sec: 'Tech', pef: 40, rating: 'hold', up: -5, px: 70, m1: -8, spark: spark(100, 70), sam: {q: 'WEAK', trend: 20}};
  assert.equal(F.nameVerdict(F.nameDrivers(r, F.sectorPE(peers.concat([r])), R), R).word, 'WEAK');
});
test('names: no data -> N/A with reasons, small sector -> valuation n/a', () => {
  const r = {t: 'CCC', sec: 'Tiny'}; const dr = F.nameDrivers(r, F.sectorPE([r]), R);
  assert.equal(F.nameVerdict(dr, R).word, 'N/A'); assert.ok(dr.every(d => d.vote === null && d.detail));
});

// ---------- L4 playbook ----------
const MV = {word: 'Neutral'}, VV = {word: 'Elevated'};
const base = {t: 'X', px: 100, spark: spark(95, 100).map((v, i) => v + (i % 2 ? 1.5 : -1.5))};
test('playbook: rich IV, no catalyst, MIXED -> iron condor with band from IV', () => {
  const r = Object.assign({}, base, {iv: 60, ivx: '2026-11-20', ern: 40});
  const p = F.playbook(r, {word: 'MIXED'}, MV, VV, R, '2026-10-15');
  assert.equal(p.setup, 'Iron condor candidate'); assert.equal(p.dte, 36);
  assert.ok(Math.abs(p.em - 100 * 0.6 * Math.sqrt(36 / 365)) < 1e-9); assert.ok(p.invalid); assert.match(p.label, /not causation/);
});
test('playbook: earnings inside window + IV not rich -> long strangle', () => {
  const rv = F.realizedVol(base.spark, 20);
  const r = Object.assign({}, base, {iv: rv * 1.0, ivx: '2026-10-30', ern: 7});
  assert.equal(F.playbook(r, {word: 'MIXED'}, MV, VV, R, '2026-10-15').setup, 'Long strangle candidate');
});
test('playbook: STRONG, no IV -> baseline, band from realized and labeled', () => {
  const r = Object.assign({}, base, {iv: null, ern: 60});
  const p = F.playbook(r, {word: 'STRONG'}, {word: 'Lean bullish'}, {word: 'Normal'}, R, '2026-10-15');
  assert.equal(p.setup, 'CSP / covered call (baseline)'); assert.equal(p.dte, R.dteDefault); assert.match(p.volSrc, /realized/);
});
test('playbook: WEAK in bearish market, no IV -> No rule matched with reasons', () => {
  const p = F.playbook(Object.assign({}, base, {iv: null}), {word: 'WEAK'}, {word: 'Lean bearish'}, VV, R, '2026-10-15');
  assert.equal(p.setup, 'No rule matched'); assert.match(p.why, /no ATM IV/); assert.match(p.why, /bearish/);
});
test('playbook: missing price -> no band, never NaN', () => {
  const p = F.playbook({t: 'Y', spark: []}, {word: 'MIXED'}, MV, VV, R, '2026-10-15');
  assert.equal(p.band, null); assert.equal(p.em, null);
});

// ---------- math ----------
test('math: realized vol of a constant series is 0, sma and pctRank sane', () => {
  assert.equal(F.realizedVol(Array(30).fill(10), 20), 0);
  assert.equal(F.sma([1, 2, 3, 4], 2), 3.5); assert.equal(F.sma([1], 2), null);
  assert.equal(F.pctRank([[0, 1], [0, 2], [0, 3], [0, 4]], 2), 50);
});
test('upcoming: filters to window and adds scoped earnings', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const D = {calendar: [{type: 'CPI', title: 'CPI', scheduled_et: '2026-10-20T08:30:00-04:00'}, {type: 'GDP', title: 'GDP', scheduled_et: '2026-11-30T08:30:00-05:00'}]};
  const ev = F.upcoming(D, [{t: 'AMZN', er: '2026-10-18', ern: 3}, {t: 'MSFT', er: '2026-12-01', ern: 47}], now, 7);
  assert.deepEqual(ev.map(e => e.type), ['CPI', 'EARN']);
});
test('upcoming: macro first, watchlist earnings next, remaining sourced names last', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const D = {calendar:[{type:'CPI',title:'CPI',scheduled_et:'2026-10-20T08:30:00-04:00'}]};
  const rows = [{t:'IBKR',er:'2026-10-15',ern:0},{t:'AMZN',er:'2026-10-19',ern:4}];
  const ev=F.upcoming(D,rows,now,7,['AMZN']);
  assert.deepEqual(ev.map(e=>e.type==='CPI'?'CPI':e.tk),['CPI','AMZN','IBKR']);
  assert.equal(ev[1].watched,true);assert.equal(ev[2].watched,false);
});
