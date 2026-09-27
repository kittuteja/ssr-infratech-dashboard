import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { libsqlDatabase } from '../server/libsql.mjs';
import { migrate,loadMigrations } from '../scripts/migrations.mjs';
import { digest } from '../server/auth.mjs';
import { financeApi } from '../server/finance-api.mjs';
import { today,report,personSummary,csv,decimalINR } from '../server/finance-model.mjs';
import worker from '../dist/server/index.js';

const origin='https://finance-dev.example',now=today(), project='Nakshatra';
const personBody={name:'Test Person',code:'EMP-1',email:'test@example.test',phone:'+91 99999 00001',roles:['Employee','Engineer'],projects:[project],active:true,notes:'Synthetic test profile'};
const paymentBody=(personId,overrides={})=>({personId,project,direction:'out',category:'Salary',transactionDate:now,amountPaise:10000,mode:'Bank transfer',status:'completed',reference:crypto.randomUUID(),notes:'',...overrides});
const dueBody=(personId,overrides={})=>({personId,project,direction:'out',category:'Salary',issuedOn:now,dueOn:now,amountPaise:10000,status:'open',reference:'',notes:'',...overrides});
async function fixture(t,{migrations}={}) {
  const client=createClient({url:':memory:'});t.after(()=>client.close());
  await migrate(client,migrations||await loadMigrations());const DB=libsqlDatabase(client),sessions={};
  for(const [id,role,token] of [['admin','admin','a'],['staff','staff','b'],['second','admin','c']]) {
    await client.execute({sql:'INSERT INTO users (id,username,name,role,active,password_hash,must_change,auth_version,created_at,updated_at) VALUES (?,?,?,?,1,?,0,1,?,?)',args:[id,id,'Test '+id,role,'not-a-login-hash',new Date().toISOString(),new Date().toISOString()]});
    await client.execute({sql:'INSERT INTO sessions (token_hash,user_id,csrf,auth_version,expires_at) VALUES (?,?,?,1,?)',args:[await digest(token.repeat(64)),id,'csrf-'+id,Date.now()+3600000]});
    sessions[id]={cookie:'__Host-ssr_session='+token.repeat(64),'x-csrf-token':'csrf-'+id};
  }
  async function call(path,method='GET',body,options={}) {
    const request=new Request(origin+(options.page?'':'/api/finance/')+path,{method,headers:{origin,'content-type':'application/json','idempotency-key':options.key||crypto.randomUUID(),...sessions[options.user||'admin'],...options.headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return (options.page?worker.fetch(request,{DB}):financeApi(request,{DB}));
  }
  async function ok(path,method='GET',body,options={}) {const r=await call(path,method,body,options);const data=await r.json();assert.equal(r.status,options.expected||(['POST'].includes(method)?201:200),data.error);return data;}
  async function expect(status,path,method,body,options){const r=await call(path,method,body,options);const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;}
  const person=async(overrides={})=>(await ok('people','POST',{...personBody,...overrides})).id;
  return {client,DB,call,ok,expect,person,sessions};
}

test('finance is Admin-only for APIs, history, CSV and protected pages; CSRF and account state enforced',async t=>{
  const f=await fixture(t);
  for(const path of ['state','export?type=payments','people/'+crypto.randomUUID(),'history?entityType=people&id='+crypto.randomUUID()]) {
    await f.expect(403,path,'GET',undefined,{user:'staff'});
    await f.expect(401,path,'GET',undefined,{headers:{cookie:''}});
  }
  for(const path of ['/people-payments','/finance.html','/finance.js','/finance.css'])assert.equal((await f.call(path,'GET',undefined,{page:true,user:'staff'})).status,403);
  assert.equal((await f.call('/people-payments','GET',undefined,{page:true})).status,200);
  await f.expect(403,'people','POST',personBody,{user:'staff'});
  await f.expect(403,'people','POST',personBody,{headers:{origin:'https://other.example'}});
  await f.expect(403,'people','POST',personBody,{headers:{'x-csrf-token':'wrong'}});
  await f.client.execute("UPDATE users SET must_change=1,password_expires=9999999999999 WHERE id='admin'");
  await f.expect(403,'state');
  await f.client.execute("UPDATE users SET active=0 WHERE id='admin'");await f.expect(401,'state');
  assert.equal((await f.client.execute('SELECT * FROM pp_people')).rows.length,0);
});

test('profiles support multiple roles/projects, duplicate checks, audited confirmation and deactivation without history loss',async t=>{
  const f=await fixture(t),id=await f.person({projects:[project,'HM Grandeur']});
  await f.expect(409,'people','POST',{...personBody,name:'Someone else'});
  const duplicate=await f.expect(409,'people','POST',{...personBody,code:'EMP-2',name:'  TEST   PERSON  '});assert.equal(duplicate.duplicateConfirmationRequired,true);assert.equal(duplicate.duplicates[0].id,id);
  const second=await f.person({code:'EMP-2',duplicateReason:'Different person with the same shared contact'});
  const p=(await f.ok('people/'+id)).person;assert.deepEqual(p.roles,['Employee','Engineer']);assert.equal(p.projects.length,2);
  await f.ok('payments','POST',paymentBody(id));
  await f.ok('people/'+id,'PATCH',{...personBody,active:false,version:1,reason:'Employee has left this project'});
  await f.expect(422,'payments','POST',paymentBody(id));
  await f.expect(422,'dues','POST',dueBody(id));
  const detail=await f.ok('people/'+id);assert.equal(detail.payments.length,1);assert.equal(detail.person.active,0);
  await f.expect(405,'people/'+id,'DELETE');
  const audit=await f.ok('history?entityType=people&id='+second);assert.match(audit.history[0].reason,/Separate duplicate confirmed/);
});

test('idempotency covers all mutations; retries return the original result and changed/other-user payloads conflict',async t=>{
  const f=await fixture(t),key=crypto.randomUUID();
  const a=await f.ok('people','POST',personBody,{key}),b=await f.ok('people','POST',personBody,{key});assert.deepEqual(a,b);
  await f.expect(409,'people','POST',{...personBody,name:'Changed'},{key});
  await f.expect(409,'people','POST',personBody,{key,user:'second'});
  const pay=paymentBody(a.id),payKey=crypto.randomUUID();const [r1,r2]=await Promise.all([f.ok('payments','POST',pay,{key:payKey}),f.ok('payments','POST',pay,{key:payKey})]);assert.deepEqual(r1,r2);
  assert.equal((await f.ok('state')).payments.length,1);
  assert.equal((await f.client.execute('SELECT * FROM pp_requests')).rows.length,2);
  assert.equal((await f.client.execute('SELECT * FROM pp_audit')).rows.length,2);
});

test('server rejects fractional/zero/unsafe amounts, invalid dates, categories and cross-project profiles',async t=>{
  const f=await fixture(t),id=await f.person();
  for(const amountPaise of [0,-1,10.5,'100',1000000000001,Number.MAX_SAFE_INTEGER])await f.expect(422,'payments','POST',paymentBody(id,{amountPaise}));
  for(const overrides of [{transactionDate:'2025-02-30'},{transactionDate:'9999-01-01'},{category:'Customer payment'},{direction:'bad'},{mode:'Crypto'},{project:'HM Grandeur'},{personId:'bad'},{status:'void'}])await f.expect(422,'payments','POST',paymentBody(id,overrides));
  await f.expect(422,'dues','POST',dueBody(id,{dueOn:'1900-01-01'}));
  await f.expect(422,'people','POST',{...personBody,roles:['Admin']});
  await f.expect(422,'people','POST',{...personBody,roles:['Employee','Employee']});
  await f.expect(422,'payments','POST',paymentBody(id),{headers:{'idempotency-key':'missing'}});
  assert.equal((await f.ok('state')).payments.length,0);
});

test('obligations and pending/void entries do not count as cash; paise stay exact',async t=>{
  const f=await fixture(t),id=await f.person();
  await f.ok('dues','POST',dueBody(id,{amountPaise:3000}));
  await f.ok('payments','POST',paymentBody(id,{status:'pending',amountPaise:2000}));
  const p=await f.ok('payments','POST',paymentBody(id,{amountPaise:8000}));
  const old=(await f.ok('state')).payments.find(r=>r.id===p.id);
  await f.ok('payments/'+p.id,'PATCH',paymentBody(id,{reference:old.reference,amountPaise:8000,status:'void',version:1,reason:'Entry recorded against the wrong receipt'}));
  await f.ok('payments','POST',paymentBody(id,{amountPaise:10}));await f.ok('payments','POST',paymentBody(id,{amountPaise:20}));
  const state=await f.ok('state');assert.equal(state.summary.paidPaise,30);assert.equal(state.summary.payablesPaise,3000);assert.equal(state.summary.receivedPaise,0);assert.equal(decimalINR(state.summary.paidPaise),'0.30');
});

test('multiple partial payments and one payment split across obligations reduce dues without double-counting cash',async t=>{
  const f=await fixture(t),id=await f.person(),d1=await f.ok('dues','POST',dueBody(id)),d2=await f.ok('dues','POST',dueBody(id,{amountPaise:5000}));
  const p1=await f.ok('payments','POST',paymentBody(id,{amountPaise:7000})),p2=await f.ok('payments','POST',paymentBody(id,{amountPaise:8000}));
  const first={paymentId:p1.id,dueId:d1.id,amountPaise:7000},key=crypto.randomUUID();const a=await f.ok('allocations','POST',first,{key});assert.deepEqual(await f.ok('allocations','POST',first,{key}),a);
  let state=await f.ok('state');assert.equal(state.dues.find(d=>d.id===d1.id).settlementStatus,'partially_paid');assert.equal(state.summary.payablesPaise,8000);
  await f.ok('allocations','POST',{paymentId:p2.id,dueId:d1.id,amountPaise:3000});
  await f.ok('allocations','POST',{paymentId:p2.id,dueId:d2.id,amountPaise:5000});
  state=await f.ok('state');assert.equal(state.summary.payablesPaise,0);assert.equal(state.summary.paidPaise,15000);assert.equal(state.dues.every(d=>d.settlementStatus==='paid'),true);
  await f.expect(409,'allocations','POST',{paymentId:p1.id,dueId:d1.id,amountPaise:1});
  assert.equal((await f.client.execute('SELECT * FROM pp_allocations')).rows.length,3);
});

test('concurrent applications cannot overspend and rejected requests leave no audit or idempotency writes',async t=>{
  const f=await fixture(t),id=await f.person(),due=await f.ok('dues','POST',dueBody(id)),payment=await f.ok('payments','POST',paymentBody(id));
  const keys=[crypto.randomUUID(),crypto.randomUUID()];
  const results=await Promise.all(keys.map(key=>f.call('allocations','POST',{paymentId:payment.id,dueId:due.id,amountPaise:7000},{key})));
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  const failed=keys[results.findIndex(r=>r.status===409)];assert.equal((await f.client.execute({sql:'SELECT * FROM pp_requests WHERE id=?',args:[failed]})).rows.length,0);
  assert.equal((await f.client.execute("SELECT * FROM pp_audit WHERE entity_type='allocations'")).rows.length,1);
  assert.equal((await f.ok('state')).summary.payablesPaise,3000);
  const other=await f.person({name:'Different Person',code:'EMP-2',email:'other@example.test',phone:''});
  const wrong=await f.ok('dues','POST',dueBody(other));await f.expect(422,'allocations','POST',{paymentId:payment.id,dueId:wrong.id,amountPaise:1});
});

test('advances count as cash once, reduce salary only through allocation, and preserve separate salary measures',async t=>{
  const f=await fixture(t),id=await f.person(),due=await f.ok('dues','POST',dueBody(id,{amountPaise:20000}));
  const advance=await f.ok('payments','POST',paymentBody(id,{category:'Advance paid',amountPaise:5000}));
  let d=await f.ok('people/'+id);assert.equal(d.summary.pendingSalaryPaise,20000);assert.equal(d.summary.salaryPaidPaise,0);assert.equal(d.summary.unappliedAdvancesPaise,5000);
  await f.ok('allocations','POST',{paymentId:advance.id,dueId:due.id,amountPaise:5000});
  const salary=await f.ok('payments','POST',paymentBody(id,{amountPaise:10000}));await f.ok('allocations','POST',{paymentId:salary.id,dueId:due.id,amountPaise:10000});
  d=await f.ok('people/'+id);assert.equal(d.summary.salaryPaidPaise,10000);assert.equal(d.summary.salarySettledPaise,15000);assert.equal(d.summary.pendingSalaryPaise,5000);assert.equal(d.summary.advancesPaidPaise,5000);assert.equal(d.summary.unappliedAdvancesPaise,0);
  assert.equal((await f.ok('state')).summary.paidPaise,15000);
});

test('refunds require free balance, reserve pending amounts, use opposite cash direction and retain linked history',async t=>{
  const f=await fixture(t),id=await f.person(),due=await f.ok('dues','POST',dueBody(id)),p=await f.ok('payments','POST',paymentBody(id));
  const a=await f.ok('allocations','POST',{paymentId:p.id,dueId:due.id,amountPaise:8000});
  const refund=paymentBody(id,{refundOf:p.id,direction:'in',category:'Other',amountPaise:3000});
  await f.expect(409,'payments','POST',refund);
  await f.ok('allocations/'+a.id+'/reverse','POST',{reason:'Return part of the salary payment'}, {expected:200});
  const pending={...refund,status:'pending'},r=await f.ok('payments','POST',pending);
  let state=await f.ok('state');assert.equal(state.summary.receivedPaise,0);assert.equal(state.options.payments.find(r=>r.id===p.id).availablePaise,7000);assert.equal(state.summary.payablesPaise,10000);
  await f.expect(409,'payments','POST',{...refund,amountPaise:8000,reference:crypto.randomUUID()});
  await f.ok('payments/'+r.id,'PATCH',{...pending,status:'completed',version:1,reason:'Refund confirmed against bank statement'});
  state=await f.ok('state');assert.equal(state.summary.paidPaise,10000);assert.equal(state.summary.receivedPaise,3000);assert.equal(state.summary.refundsReceivedPaise,3000);
  assert.equal((await f.ok('people/'+id)).summary.salaryPaidPaise,7000);
  await f.expect(422,'allocations','POST',{paymentId:r.id,dueId:due.id,amountPaise:100});
  await f.expect(422,'payments','POST',paymentBody(id,{refundOf:r.id,direction:'out',category:'Other',amountPaise:100}));
  await f.expect(422,'payments','POST',paymentBody(id,{refundOf:p.id,direction:'out',category:'Other',amountPaise:100}));
});

test('corrections require reasons and versions; financial changes are audited and linked records must be reversed before void/cancel',async t=>{
  const f=await fixture(t),id=await f.person(),body=paymentBody(id),p=await f.ok('payments','POST',body),dBody=dueBody(id),d=await f.ok('dues','POST',dBody);
  await f.expect(422,'payments/'+p.id,'PATCH',{...body,version:1,amountPaise:9000});
  await f.ok('payments/'+p.id,'PATCH',{...body,version:1,amountPaise:9000,reason:'Correct amount from original receipt'});
  await f.expect(409,'payments/'+p.id,'PATCH',{...body,version:1,reason:'Stale correction from another tab'});
  const a=await f.ok('allocations','POST',{paymentId:p.id,dueId:d.id,amountPaise:8000});
  await f.expect(409,'payments/'+p.id,'PATCH',{...body,version:2,amountPaise:8500,reason:'Attempt to change linked payment'});
  await f.expect(409,'payments/'+p.id,'PATCH',{...body,version:2,amountPaise:9000,status:'void',reason:'Attempt to void an applied payment'});
  await f.expect(409,'dues/'+d.id,'PATCH',{...dBody,version:1,status:'cancelled',reason:'Attempt to cancel an applied obligation'});
  await f.ok('allocations/'+a.id+'/reverse','POST',{reason:'Reverse the incorrect application'},{expected:200});
  await f.expect(409,'allocations/'+a.id+'/reverse','POST',{reason:'Duplicate reversal must be blocked'});
  await f.expect(409,'payments/'+p.id,'PATCH',{...body,version:2,amountPaise:8500,reason:'Historical dimensions must stay intact'});
  await f.ok('payments/'+p.id,'PATCH',{...body,version:2,amountPaise:9000,status:'void',reason:'Void incorrect original payment'});
  await f.ok('dues/'+d.id,'PATCH',{...dBody,version:1,status:'cancelled',reason:'Cancel incorrect salary obligation'});
  const state=await f.ok('state');assert.equal(state.summary.paidPaise,0);assert.equal(state.summary.payablesPaise,0);assert.equal(state.payments.length,1);
  const history=await f.ok('history?entityType=payments&id='+p.id);assert.equal(history.history.length,3);assert.equal(history.history[1].before.amount_paise,10000);assert.equal(history.history[1].after.amount_paise,9000);assert.equal(history.history[1].actor_id,'admin');assert.ok(history.history[1].recorded_at);
  await assert.rejects(f.client.execute('DELETE FROM pp_payments'),/cannot be deleted/);
  await assert.rejects(f.client.execute("UPDATE pp_audit SET reason='tamper'"),/immutable/);
  await assert.rejects(f.client.execute('DELETE FROM pp_audit'),/cannot be deleted/);
  await assert.rejects(f.client.execute('UPDATE pp_allocations SET amount_paise=1'),/reversed once/);
});

test('reference duplicates are hard conflicts; matching unreferenced payments require an audited explanation',async t=>{
  const f=await fixture(t),id=await f.person(),body=paymentBody(id,{reference:' bank-ref-001 '});await f.ok('payments','POST',body);
  await f.expect(409,'payments','POST',{...body,reference:'BANK-REF-001',duplicateReason:'Should not override a duplicate bank reference'});
  const cash=paymentBody(id,{mode:'Cash',reference:''});await f.ok('payments','POST',cash);
  const result=await f.expect(409,'payments','POST',cash);assert.equal(result.duplicateConfirmationRequired,true);
  const other=await f.ok('payments','POST',{...cash,duplicateReason:'Separate verified cash voucher of the same value'});
  assert.match((await f.ok('history?entityType=payments&id='+other.id)).history[0].reason,/Separate duplicate confirmed/);
});

test('reports filter projects, person, role, category, dates and statuses; CSV labels dates/INR and escapes formulas',async t=>{
  const f=await fixture(t),id=await f.person({name:'=HYPERLINK("bad")'});
  await f.ok('payments','POST',paymentBody(id,{transactionDate:'2025-01-01',amountPaise:12345,notes:'comma, quote " and\nnewline'}));
  await f.ok('payments','POST',paymentBody(id,{status:'pending',amountPaise:100}));
  const query=new URLSearchParams({from:'2025-01-01',to:'2025-12-31',project,personId:id,role:'Employee',category:'Salary',direction:'out',status:'completed'});
  const r=await f.ok('state?'+query);assert.equal(r.summary.paidPaise,12345);assert.equal(r.payments.length,1);
  assert.equal((await f.ok('state?role=Vendor')).payments.length,0);
  assert.equal((await f.ok('state?project=HM%20Grandeur')).payments.length,0);
  assert.equal((await f.ok('state?status=pending')).summary.paidPaise,0);
  await f.expect(422,'state?from=2025-12-31&to=2025-01-01');
  const response=await f.call('export?type=payments&'+query);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/csv/);
  const text=await response.text();assert.match(text,/Payment date \(YYYY-MM-DD\)/);assert.match(text,/Amount \(INR\)/);assert.match(text,/123\.45/);assert.match(text,/'=HYPERLINK/);assert.match(text,/comma, quote "" and\nnewline/);assert.match(text,/Test admin/);
  assert.equal(JSON.stringify(r).includes('password_hash'),false);assert.equal(JSON.stringify(r).includes('token_hash'),false);
});

test('as-of balances respect application/reversal dates and future dues, without counting obligations as cash',()=>{
  const person={id:'person',name:'Person',code:'',roles_json:'["Customer"]',projects_json:'["Nakshatra"]',active:1};
  const payment={id:'p',person_id:'person',project,direction:'in',category:'Advance received',amount_paise:10000,status:'completed',transaction_date:'2025-01-01'};
  const due={id:'d',person_id:'person',project,direction:'in',category:'Installment',amount_paise:12000,status:'open',issued_on:'2025-01-01',due_on:'2025-01-15'};
  const data={people:[person],payments:[payment],dues:[due],allocations:[{payment_id:'p',due_id:'d',amount_paise:5000,applied_on:'2025-02-01',reversed_on:'2025-03-01'}]};
  assert.equal(report(data,{to:'2025-01-14'}).summary.receivablesPaise,0);
  assert.equal(report(data,{to:'2025-01-31'}).summary.receivablesPaise,12000);
  assert.equal(report(data,{to:'2025-02-28'}).summary.receivablesPaise,7000);
  assert.equal(report(data,{to:'2025-03-31'}).summary.receivablesPaise,12000);
  assert.equal(report(data,{from:'2025-02-01',to:'2025-02-28'}).summary.receivedPaise,0);
  assert.equal(personSummary(data,'person').summary.advancesReceivedPaise,10000);
  assert.match(csv(['Text'],[['  +SUM(1,2)']]),/"'  \+SUM/);
});

test('additive finance migration preserves accounts, sessions, material stock and prior migration hashes',async t=>{
  const migrations=await loadMigrations(),f=await fixture(t,{migrations:migrations.slice(0,2)});
  await f.client.execute("INSERT INTO materials (id,name,category,brand,supplier,specification,project,unit,quantity100,minimum100,price100,version,created_at,updated_at,created_by,updated_by) VALUES ('old-stock','Existing cement','Cement','Existing','','','Nakshatra','Bags',1500,200,40000,3,'2025-01-01','2025-01-01','admin','admin')");
  const before={};for(const table of ['users','sessions','materials','ssr_migrations'])before[table]=(await f.client.execute('SELECT * FROM '+table)).rows.map(r=>({...r}));
  assert.equal(await migrate(f.client,migrations),1);
  for(const table of ['users','sessions','materials'])assert.deepEqual((await f.client.execute('SELECT * FROM '+table)).rows.map(r=>({...r})),before[table]);
  const hashes=(await f.client.execute('SELECT * FROM ssr_migrations ORDER BY name')).rows;assert.deepEqual(hashes.slice(0,2).map(r=>({...r})),before.ssr_migrations);
  assert.equal((await f.ok('state')).people.length,0);assert.equal((await f.ok('state')).payments.length,0);
  assert.equal(await migrate(f.client,migrations),0);
});

test('an audit-write failure rolls back payment creation and its retry marker together',async t=>{
  const f=await fixture(t),id=await f.person(),key=crypto.randomUUID(),body=paymentBody(id);
  await f.client.execute("CREATE TRIGGER test_audit_failure BEFORE INSERT ON pp_audit WHEN NEW.entity_type='payments' BEGIN SELECT RAISE(ABORT,'Simulated audit write failure'); END");
  await f.expect(503,'payments','POST',body,{key});
  assert.equal((await f.client.execute('SELECT * FROM pp_payments')).rows.length,0);
  assert.equal((await f.client.execute({sql:'SELECT * FROM pp_requests WHERE id=?',args:[key]})).rows.length,0);
  await f.client.execute('DROP TRIGGER test_audit_failure');
  await f.ok('payments','POST',body,{key});
  assert.equal((await f.ok('state')).payments.length,1);
});
