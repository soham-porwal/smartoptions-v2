'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const E=require('../explore.js');
test('peer participation uses same-date industry peers; stale and missing returns never become laggards',()=>{
  const data={rows:[{t:'A',ind:'chips',sec:'tech',pxd:'2026-10-15',d1:2},
    {t:'B',ind:'chips',sec:'tech',pxd:'2026-10-15',d1:3},
    {t:'C',ind:'chips',sec:'tech',pxd:'2026-10-15',d1:-1},
    {t:'OLD',ind:'chips',sec:'tech',pxd:'2026-10-14',d1:-99},
    {t:'MISS',ind:'chips',sec:'tech',pxd:'2026-10-15',d1:null},
    {t:'OTHER',ind:'software',sec:'tech',pxd:'2026-10-15',d1:9}]};
  assert.deepEqual(E.peerRows(data,'A').rows.map(r=>r.t),['B','C']);
  assert.match(E.peerRows(data,'A').group,/Industry/);
  assert.deepEqual(E.peerRows(data,'MISSING').rows,[]);
});
test('factor exposures require measured coefficient and sufficient t-stat; sign is retained',()=>{
  const data={rows:[{t:'POS',rel:{c:{vix:2},t:{vix:3}}},{t:'NEG',rel:{c:{vix:-4},t:{vix:-2}}},
    {t:'WEAK',rel:{c:{vix:8},t:{vix:1}}},{t:'NULL',rel:{c:{vix:null},t:{vix:9}}}]};
  assert.deepEqual(E.factorRows(data,'vix',2).rows.map(r=>r.t),['POS','NEG']);
  assert.equal(E.factorRows(data,'vix',2).matched,2);
  assert.deepEqual(E.factorRows(data,'unemployment',2).rows,[]);
});
