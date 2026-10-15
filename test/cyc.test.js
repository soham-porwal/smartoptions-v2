// R8: macro-cycle classifier tests on synthetic core.json fragments. Run: node --test app/test/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../cycles.js');

const daily = (n, f) => Array.from({length: n}, (_, i) => [new Date(Date.UTC(2025, 9, 1) + i * 864e5 * 1.45).toISOString().slice(0, 10), f(i, n)]);
const monthly = (n, f) => Array.from({length: n}, (_, i) => [new Date(Date.UTC(2023, 9 + i, 1)).toISOString().slice(0, 10), f(i, n)]);
const ob = (id, h, extra) => Object.assign({id, label: id, unit: 'x', provider: 'test', series: id, url: 'https://example.test/' + id, period: h.length ? h[h.length - 1][0] : null, status: 'ok', v: h.length ? h[h.length - 1][1] : null, h}, extra || {});
function core({ff = 4, ff0 = 4, y10 = [4, 4], sp = [50, 50], ur = i => 4, pay = i => 150, gdp = [2, 2, 2, 2, 2.5], oas = [300, 300], vix = 15, cpi = [3, 0.25], pce = [3, 0.25]} = {}) {
  const lin = (a, b) => (i, n) => a + (b - a) * i / (n - 1);
  return {asof_session: '2026-10-15', rel: {regime_hist: [['2026-10-14', 60], ['2026-10-15', 70]], regime: {score: 70, tier: 'FAVORABLE'}}, macro: {
    policy: [ob('fed_target_upper', daily(260, lin(ff0, ff))), ob('effective_fed_funds', daily(260, lin(ff0 - 0.1, ff - 0.1)))],
    curve: [ob('us10y', daily(260, lin(y10[0], y10[1]))), ob('us2y', daily(260, lin(y10[0] - 0.3, y10[1] - 0.3))), ob('spread_10y_2y', daily(260, lin(sp[0], sp[1])))],
    inflation: [ob('cpi_core', monthly(36, () => cpi[0])), ob('cpi_core_mom', monthly(36, () => cpi[1])), ob('pce_core', monthly(36, () => pce[0])), ob('pce_core_mom', monthly(36, () => pce[1]))],
    labor: [ob('unemployment', monthly(36, ur)), ob('payrolls', monthly(36, pay))],
    growth: [ob('real_gdp_saar', gdp.map((v, i) => [`202${4 + Math.floor(i / 4)}-0${1 + 3 * (i % 4)}-01`.replace('-010-', '-10-'), v]))],
    credit_funding: [ob('hy_oas', daily(260, lin(oas[0], oas[1])))], volatility: [ob('vix', daily(260, () => vix))],
  }};
}
const P = (s, name) => s.pillars.concat(s.context).find(p => p.pillar === name);

test('label, fiscal always missing with a reason, no NaN/undefined anywhere', () => {
  const s = C.state(core());
  assert.equal(s.label, 'practitioner framing; measured association, not forecast');
  assert.equal(P(s, 'Fiscal policy').phase, 'missing'); assert.match(P(s, 'Fiscal policy').reason, /not inferred/);
  assert.ok(!/NaN|undefined/.test(JSON.stringify(s)));
  assert.match(s.note, /could not be extracted/);
});

test('Fed policy: cut 50bp -> easing, hike -> tightening, flat -> on hold', () => {
  assert.equal(P(C.state(core({ff0: 4.5, ff: 4})), 'Fed policy').phase, 'easing');
  assert.equal(P(C.state(core({ff0: 3.5, ff: 4})), 'Fed policy').phase, 'tightening');
  assert.equal(P(C.state(core()), 'Fed policy').phase, 'on hold');
});

test('rates + curve: 10Y up ~50bp in 3m rising, bear steepening when spread widens with yields up; inverted when spread < 0', () => {
  const r = P(C.state(core({y10: [4, 6], sp: [0, 120]})), 'Interest rates');
  assert.equal(r.phase, 'rising'); assert.equal(r.curve.phase, 'bear steepening');
  assert.equal(P(C.state(core({y10: [6, 4], sp: [120, 0]})), 'Interest rates').phase, 'falling');
  assert.match(P(C.state(core({sp: [-20, -30]})), 'Interest rates').curve.phase, /^inverted/);
});

test('inflation: 3m annualized above YoY = accelerating, below = decelerating; monotone in the MoM input', () => {
  assert.equal(P(C.state(core({cpi: [3, 0.4], pce: [3, 0.4]})), 'Inflation').phase, 'accelerating');
  assert.equal(P(C.state(core({cpi: [3, 0.1], pce: [3, 0.1]})), 'Inflation').phase, 'decelerating');
  assert.equal(P(C.state(core({cpi: [3, 0.2466], pce: [3, 0.2466]})), 'Inflation').phase, 'steady');
});

test('employment: Sahm trigger -> contracting; healthy -> expanding; weakening payrolls -> peaking', () => {
  assert.equal(P(C.state(core({ur: (i, n) => i < n - 4 ? 4 : 5, pay: (i, n) => i < n - 3 ? 100 : -50})), 'Employment').phase, 'contracting');
  assert.equal(P(C.state(core()), 'Employment').phase, 'expanding');
  assert.equal(P(C.state(core({pay: (i, n) => i < n - 3 ? 200 : 60})), 'Employment').phase, 'peaking');
});

test('GDP quadrant + overall read: agree -> phase, disagree -> mixed', () => {
  assert.equal(P(C.state(core({gdp: [2, 2, 2, 2, -1]})), 'GDP').phase, 'contracting');
  assert.equal(P(C.state(core({gdp: [2, 2, 2, -1, 1]})), 'GDP').phase, 'troughing');
  assert.equal(C.state(core()).overall.phase, 'expanding');
  assert.equal(C.state(core({gdp: [2, 2, 2, 2, -1]})).overall.phase, 'mixed');
});

test('missing series stay missing; overall says so', () => {
  const c = core(); delete c.macro.labor; delete c.macro.growth; c.macro.curve = [];
  const s = C.state(c);
  assert.equal(P(s, 'Employment').phase, 'missing'); assert.equal(P(s, 'GDP').phase, 'missing'); assert.equal(P(s, 'Interest rates').phase, 'missing');
  assert.equal(s.overall.phase, 'unavailable');
  assert.equal(C.state(null).overall.phase, 'unavailable');
});

test('credit + VIX context bands, thresholds editable', () => {
  assert.equal(P(C.state(core({oas: [300, 500]})), 'Credit spread').phase, 'widening');
  assert.equal(P(C.state(core({vix: 32})), 'Volatility (VIX)').phase, 'stress');
  assert.equal(P(C.state(core({vix: 32}), {vix_stress: 40}), 'Volatility (VIX)').phase, 'elevated');
});
