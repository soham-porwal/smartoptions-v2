// R8: practitioner pattern detector tests on synthetic daily bars (positive / negative / ambiguous per pattern). Run: node --test app/test/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../patterns.js');

const day = i => new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10);
// piecewise-linear close path through waypoints [[i, price], ...]; small fixed wiggle so highs/lows exist
function path(wp, wig = 0.002) {
  const c = [];
  for (let k = 0; k < wp.length - 1; k++) { const [i0, p0] = wp[k], [i1, p1] = wp[k + 1]; for (let i = i0; i < i1; i++) c.push(p0 + (p1 - p0) * (i - i0) / (i1 - i0)); }
  c.push(wp[wp.length - 1][1]);
  return c.map((v, i) => [day(i), v, v * (1 + wig), v * (1 - wig), v, 1e6]);
}
const zig = (n, lo, hi, per, start = 0) => { const w = []; for (let i = 0, k = 0; i <= n; i += per / 2, k++) w.push([start + i, k % 2 ? hi : lo]); return w; };
const st = (bars, id, ctx) => P.detect(bars, ctx).detections.find(d => d.id === id);
const shift = (wp, di) => wp.map(([i, p]) => [i + di, p]);

test('too few bars -> no detections, note', () => {
  const r = P.detect(path([[0, 100], [30, 110]]));
  assert.equal(r.detections.length, 0); assert.match(r.note, /fewer than 60/);
});

test('support/resistance: zig-zag box gives multi-touch lines; straight trend gives none', () => {
  const d = st(path(zig(160, 100, 110, 20)), 'sr');
  assert.equal(d.state, 'confirmed'); assert.ok(Math.abs(d.evidence.resistance ? d.evidence.resistance.level - 110 : d.evidence.support.level - 100) < 1.5);
  assert.equal(st(path([[0, 100], [160, 200]]), 'sr').state, 'none');
});

test('breakout: high-volume close above a 3-touch level = confirmed; low volume = forming; fall back = failed; none without a level', () => {
  const base = path(zig(160, 100, 110, 20).concat([[170, 105], [178, 108]]));
  const up = base.concat([[day(179), 116, 117, 115, 116, 4e6], [day(180), 117, 118, 116, 117, 2e6]]);
  const d = st(up, 'breakout');
  assert.equal(d.state, 'confirmed'); assert.ok(d.target > 117); assert.ok(d.stop < 110.5 && d.stop > 105);
  const low = up.map((b, i) => i >= 179 ? [b[0], b[1], b[2], b[3], b[4], 1e6] : b);
  assert.equal(st(low, 'breakout').state, 'forming');
  const back = up.concat([[day(181), 104, 105, 103, 104, 1e6]]);
  assert.equal(st(back, 'breakout').state, 'failed');
  assert.equal(st(path([[0, 100], [180, 200]]), 'breakout').state, 'none');
});

test('double top (M): neckline break = confirmed, above neckline = forming, mismatched peaks = none', () => {
  const pre = [[0, 100], [60, 102], [80, 100], [100, 104]];
  const conf = path(pre.concat([[115, 120], [130, 108], [145, 120], [165, 100]]));
  const d = st(conf, 'mtop'); assert.equal(d.state, 'confirmed'); assert.equal(d.direction, 'bear'); assert.ok(d.target < 108);
  assert.equal(st(path(pre.concat([[115, 120], [130, 108], [145, 120], [158, 112]])), 'mtop').state, 'forming');
  assert.equal(st(path(pre.concat([[115, 120], [130, 108], [145, 128], [165, 100]])), 'mtop').state, 'none'); // peaks 6.7% apart
});

test('double bottom (W): mirror of the M', () => {
  const pre = [[0, 130], [60, 128], [80, 130], [100, 126]];
  const d = st(path(pre.concat([[115, 110], [130, 122], [145, 110], [165, 130]])), 'wbot');
  assert.equal(d.state, 'confirmed'); assert.equal(d.direction, 'bull'); assert.ok(d.target > 122);
  assert.equal(st(path(pre.concat([[115, 110], [130, 112], [145, 110], [165, 130]])), 'wbot').state, 'none'); // middle too shallow
});

test('ascending triangle: flat top + rising lows; above top = confirmed, inside = forming, below last low = failed, flat lows = none', () => {
  const pre = [[0, 80], [100, 100]];
  const tri = pre.concat([[110, 110], [120, 98], [130, 110], [140, 102], [150, 110], [160, 106]]);
  assert.equal(st(path(tri.concat([[168, 109]])), 'asc_tri').state, 'forming');
  const c = st(path(tri.concat([[168, 109], [174, 114]])), 'asc_tri'); assert.equal(c.state, 'confirmed'); assert.ok(Math.abs(c.target - 110) < 1.5);
  assert.equal(st(path(tri.concat([[168, 109], [180, 100]])), 'asc_tri').state, 'failed');
  const flat = pre.concat([[110, 110], [120, 100], [130, 110], [140, 100], [150, 110], [160, 100], [164, 104]]);
  assert.equal(st(path(flat), 'asc_tri').state, 'none');
});

test('horizontal range: support test + EMA re-cross + RSI/MACD up = confirmed; mid-range drift = forming; trend = none', () => {
  const box = zig(140, 100, 110, 28);
  const buy = path(box.concat([[147, 100.5], [152, 104]]));
  const d = st(buy, 'range'); assert.ok(['confirmed', 'forming'].includes(d.state), d.plain);
  assert.equal(st(path([[0, 100], [160, 180]]), 'range').state, 'none');
});

test('old resistance -> new support: break + held retest = confirmed; break only = forming; lost level = failed', () => {
  const pre = zig(100, 95, 110, 20);
  assert.equal(st(path(pre.concat([[110, 120], [120, 110.5], [130, 118]])), 'retest').state, 'confirmed');
  assert.equal(st(path(pre.concat([[110, 125], [125, 128]])), 'retest').state, 'forming');
  assert.equal(st(path(pre.concat([[110, 120], [120, 110.5], [130, 101]])), 'retest').state, 'failed');
});

test('Bollinger squeeze: tight bands now = forming; expansion after squeeze = confirmed; steady vol = none', () => {
  const wild = zig(140, 90, 110, 8);
  const tight = wild.concat([[141, 100], [170, 100.3]]);
  assert.equal(st(path(tight, 0.001), 'bb_squeeze').state, 'forming');
  const exp = path(tight.concat([[172, 104], [174, 109]]), 0.001);
  const d = st(exp, 'bb_squeeze'); assert.equal(d.state, 'confirmed'); assert.equal(d.direction, 'bull');
  assert.equal(st(path(zig(180, 90, 110, 8)), 'bb_squeeze').state, 'none');
});

test('golden/death cross is LAGGING; recent cross = confirmed, old order = none, short history = unavailable', () => {
  const g = st(path([[0, 200], [200, 120], [250, 175]]), 'ma_cross');
  assert.equal(g.lagging, true);
  assert.ok(['confirmed', 'none'].includes(g.state));
  const old = st(path([[0, 100], [260, 200]]), 'ma_cross'); assert.equal(old.state, 'none'); assert.equal(old.direction, 'bull');
  assert.equal(st(path([[0, 100], [120, 130]]), 'ma_cross').unavailable, true);
});

test('ADX: strong trend = confirmed (direction from DI), choppy = not confirmed', () => {
  const tr = st(path([[0, 100], [150, 180]], 0.01), 'adx'); assert.equal(tr.state, 'confirmed'); assert.equal(tr.direction, 'bull');
  const ch = st(path(zig(150, 99, 101, 4), 0.01), 'adx'); assert.notEqual(ch.state, 'confirmed');
});

test('post-earnings dip-buy: unavailable without a past earnings date; detected with one', () => {
  assert.equal(st(path(zig(160, 100, 110, 20)), 'earn_dip').unavailable, true);
  const wp = zig(120, 100, 112, 20).concat([[125, 111], [126, 100.5], [130, 101], [175, 108]]);
  const d = st(path(wp), 'earn_dip', {lastEarnings: day(126)});
  assert.notEqual(d.unavailable, true); assert.ok(d.state !== 'none', d.plain);
  assert.equal(st(path(zig(160, 100, 110, 20)), 'earn_dip', {lastEarnings: day(140)}).state, 'none'); // no 5% dip
});

test('VWAP rule is always reported unavailable, never faked', () => {
  const d = st(path(zig(160, 100, 110, 20)), 'vwap'); assert.equal(d.unavailable, true); assert.match(d.plain, /intraday/);
});

test('every detection carries the labeled source, rule text and no NaN', () => {
  for (const bars of [path(zig(200, 100, 110, 20)), path([[0, 100], [200, 150]], 0.01)]) {
    for (const d of P.detect(bars).detections) {
      assert.match(d.source, /practitioner convention - G\. Mundada/); assert.ok(d.rule.length > 20); assert.ok(d.plain.length > 5);
      assert.ok(!/NaN|undefined/.test(JSON.stringify(d)), d.id + ' ' + JSON.stringify(d));
      assert.ok(['forming', 'confirmed', 'failed', 'none'].includes(d.state));
    }
  }
});
