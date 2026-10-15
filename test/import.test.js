// R5: classify() + watchlist tests (pure, no DOM). Run: node --test app/test/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../import.js');
const W = require('../overview.js');

const KNOWN = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'BRK-B', 'JPM', 'XOM', 'A'];

test('broker CSV with preamble, ** money-market symbol and footer -> book', () => {
  const csv = [
    'Brokerage Account Positions as of 10/14/2026',
    '',
    'Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total,Average Cost Basis',
    'X123,Individual,SPAXX**,HELD IN MONEY MARKET,,,$1,234.56,,',
    'X123,Individual,AAPL,APPLE INC,10,$230.10,"$2,301.00","$1,500.00",$150.00',
    'X123,Individual,MSFT,MICROSOFT CORP,5,$410.00,"$2,050.00","$1,800.00",$360.00',
    'X123,Individual,BRK.B,BERKSHIRE HATHAWAY CL B,2,$450.00,$900.00,$700.00,$350.00',
    'X123,Individual,ZZZZ,UNKNOWN CO,1,$1.00,$1.00,$1.00,$1.00',
    '"The data and information in this spreadsheet is provided to you solely for your use"',
  ].join('\n');
  const r = I.classify(csv, 'Portfolio_Positions.csv', KNOWN);
  assert.equal(r.kind, 'book');
  assert.equal(r.tickerColumn, 'Symbol');
  assert.deepEqual(Object.keys(r.book).sort(), ['AAPL', 'BRK-B', 'MSFT']);
  assert.equal(r.book.AAPL.qty, 10);
  assert.equal(r.book.MSFT.qty, 5);
  assert.ok(r.unknown.includes('ZZZZ'));
  assert.match(r.summary, /3 tickers matched/);
});

test('ticker per line -> watchlist', () => {
  const r = I.classify('AAPL\nmsft\nNVDA\n$JPM\nAAPL\n', 'list.txt', KNOWN);
  assert.equal(r.kind, 'watchlist');
  assert.deepEqual(r.matched, ['AAPL', 'MSFT', 'NVDA', 'JPM']);
});

test('JSON array of strings -> watchlist; unknown reported', () => {
  const r = I.classify('["AAPL","XOM","QQQQ"]', 'w.json', KNOWN);
  assert.equal(r.kind, 'watchlist');
  assert.deepEqual(r.matched, ['AAPL', 'XOM']);
  assert.deepEqual(r.unknown, ['QQQQ']);
});

test('JSON array of objects with shares -> book', () => {
  const r = I.classify('[{"symbol":"NVDA","shares":12,"avg_cost":95.5},{"symbol":"AMZN","shares":"3","avg_cost":"120"}]', 'h.json', KNOWN);
  assert.equal(r.kind, 'book');
  assert.deepEqual(r.book.NVDA, {qty: 12, cost: 95.5});
  assert.deepEqual(r.book.AMZN, {qty: 3, cost: 120});
});

test('metrics table (ticker + numeric, no position words) -> metrics', () => {
  const tsv = 'Ticker\tMy score\tShort interest %\nAAPL\t7.5\t0.8%\nMSFT\t6\t0.6%\nGOOGL\t(1.2)\tn/a\n';
  const r = I.classify(tsv, 'scores.tsv', KNOWN);
  assert.equal(r.kind, 'metrics');
  assert.deepEqual(r.metrics.columns, ['My score', 'Short interest %']);
  assert.equal(r.metrics.rows.GOOGL['My score'], -1.2);
  assert.equal(r.metrics.rows.GOOGL['Short interest %'], null);
  assert.equal(r.metrics.rows.AAPL['Short interest %'], 0.8);
});

test('FRED-style date,value -> series sorted ascending, "." treated as missing', () => {
  const csv = 'observation_date,T10Y2Y\n2026-10-03,0.52\n2026-10-01,0.50\n2026-10-02,.\n2026-10-06,0.55\n';
  const r = I.classify(csv, 'T10Y2Y.csv', KNOWN);
  assert.equal(r.kind, 'series');
  assert.equal(r.dateColumn, 'observation_date');
  assert.deepEqual(r.series[0].points, [['2026-10-01', 0.5], ['2026-10-03', 0.52], ['2026-10-06', 0.55]]);
});

test('classification is by content, not filename', () => {
  const r = I.classify('AAPL\nMSFT\nNVDA', 'macro_series.csv', KNOWN);
  assert.equal(r.kind, 'watchlist');
});

test('garbage prose -> unknown with a reason', () => {
  const r = I.classify('Dear Sam, here are my thoughts on the market this week. Rates look high.', 'note.txt', KNOWN);
  assert.equal(r.kind, 'unknown');
  assert.ok(r.reason.length > 0);
  assert.match(r.summary, /could not place/);
});

test('empty and broken JSON -> unknown, no throw', () => {
  assert.equal(I.classify('', 'x', KNOWN).kind, 'unknown');
  assert.equal(I.classify('{"a": [1, 2', 'x.json', KNOWN).kind, 'unknown');
});

test('single-letter ticker A matches only when known', () => {
  assert.deepEqual(I.classify('A\nAAPL', 'x', KNOWN).matched, ['A', 'AAPL']);
});

test('num parses $, commas, %, parentheses negatives', () => {
  assert.equal(I.num('$1,234.50'), 1234.5);
  assert.equal(I.num('(3.2)'), -3.2);
  assert.equal(I.num('12%'), 12);
  assert.equal(I.num('--'), null);
  assert.equal(I.num('abc'), null);
});

function memStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m};
}

test('watchlist: defaults, add/remove/normalize, persists under so_watchlist_v1, reset', () => {
  const st = memStorage();
  const w = W.createWatchlist(st, () => ['MSFT', 'AAPL']);
  assert.deepEqual(w.get(), ['MSFT', 'AAPL']);
  w.add(['nvda', 'AAPL', 'bad ticker!']);
  assert.deepEqual(w.get(), ['MSFT', 'AAPL', 'NVDA']);
  w.remove('msft');
  assert.deepEqual(JSON.parse(st.getItem('so_watchlist_v1')), ['AAPL', 'NVDA']);
  const w2 = W.createWatchlist(st, () => ['XOM']);
  assert.deepEqual(w2.get(), ['AAPL', 'NVDA']);
  w2.reset();
  assert.equal(st.getItem('so_watchlist_v1'), null);
  assert.deepEqual(w2.get(), ['XOM']);
});

test('watchlist: corrupt storage falls back to defaults and reports', () => {
  const msgs = [];
  const w = W.createWatchlist(memStorage({so_watchlist_v1: '{not json'}), () => ['AAPL'], m => msgs.push(m));
  assert.deepEqual(w.get(), ['AAPL']);
  assert.ok(msgs.some(m => /invalid/.test(m || '')));
});

test('watchlist: storage that throws on write keeps changes in memory', () => {
  const st = memStorage(); st.setItem = () => { throw new Error('quota'); };
  const w = W.createWatchlist(st, () => []);
  w.add('JPM');
  assert.deepEqual(w.get(), ['JPM']);
});
