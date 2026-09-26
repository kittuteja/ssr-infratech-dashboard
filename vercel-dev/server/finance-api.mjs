import { authorize, database, json, digest, AuthError } from './auth.mjs';
import * as model from './finance-model.mjs';

const tables = { people:'pp_people', payments:'pp_payments', dues:'pp_dues', allocations:'pp_allocations' };
const get = (db, kind, id) => db.prepare(`SELECT * FROM ${tables[kind]} WHERE id=?`).bind(id).first();
async function required(db, kind, id) { const row=await get(db,kind,model.uuid(id)); if (!row) model.fail(404,'Record not found.'); return {...row}; }
async function insert(db, table, values) {
  const keys=Object.keys(values);
  await db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).bind(...Object.values(values)).run();
}
async function update(db, table, id, values) {
  await db.prepare(`UPDATE ${table} SET ${Object.keys(values).map(k=>k+'=?').join(',')} WHERE id=?`).bind(...Object.values(values),id).run();
}
async function audit(db, user, kind, before, after, action, reason) {
  await insert(db,'pp_audit',{entity_type:kind,entity_id:after.id,action,reason,before_json:before?JSON.stringify(before):null,after_json:JSON.stringify(after),actor_id:user.id,actor_name:user.name,recorded_at:new Date().toISOString()});
}
async function load(db) {
  const result=await db.batch(Object.values(tables).map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY created_at DESC, id DESC`)));
  const users=await db.prepare('SELECT id,name FROM users').all();
  const names=Object.fromEntries(users.results.map(u=>[u.id,u.name]));
  return Object.fromEntries(Object.keys(tables).map((key,i)=>[key,result[i].results.map(r=>({...r,createdByName:names[r.created_by],updatedByName:names[r.updated_by],reversedByName:names[r.reversed_by]}))]));
}
async function readBody(request) {
  if (!(request.headers.get('content-type')||'').startsWith('application/json')) model.fail(415,'Use JSON for this request.');
  const reader=request.body?.getReader(), chunks=[]; let size=0;
  if (reader) while (true) { const r=await reader.read(); if(r.done)break; size+=r.value.length; if(size>20000){await reader.cancel();model.fail(413,'The request is too large.');} chunks.push(r.value); }
  const bytes=new Uint8Array(size); let offset=0; for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
  try {const value=JSON.parse(new TextDecoder().decode(bytes));if(value&&typeof value==='object'&&!Array.isArray(value))return value;}catch{}
  model.fail(400,'Invalid request data.');
}
function revision(before,input) {
  if(!Number.isInteger(input.version)||input.version!==before.version)model.fail(409,'This record changed. Refresh it before making a correction.');
  return model.reason(input.reason);
}
async function linkedPerson(db, row, before) {
  const p=await required(db,'people',row.person_id);
  if ((!before||before.person_id!==row.person_id||before.project!==row.project) && (!p.active||!JSON.parse(p.projects_json).includes(row.project))) model.fail(422,'Choose an active person associated with this project.');
}
async function checkPersonDuplicates(db,row,id,input) {
  const all=(await db.prepare('SELECT * FROM pp_people WHERE id<>?').bind(id||'').all()).results;
  if(row.code_key && all.some(p=>p.code_key===row.code_key))model.fail(409,'This employee/vendor code is already reserved by another profile, including inactive profiles.');
  const phone=row.phone.replace(/\D/g,'');
  const duplicates=all.filter(p=>p.name_key===row.name_key||(row.email&&p.email===row.email)||(phone&&p.phone.replace(/\D/g,'')===phone));
  if(duplicates.length&&!input.duplicateReason) model.fail(409,'A similar profile exists. Review it before creating a separate profile.',{duplicates:duplicates.map(({id,name,code,active})=>({id,name,code,active})),duplicateConfirmationRequired:true});
  if(duplicates.length)model.reason(input.duplicateReason);
}
async function checkPayment(db,row,before,input) {
  await linkedPerson(db,row,before);
  if(!before&&row.status==='void')model.fail(422,'A new payment must be pending or completed.');
  if(before) {
    if(before.status==='void')model.fail(409,'Void payments are final. Create a replacement entry.');
    if(before.status==='completed'&&row.status==='pending')model.fail(422,'A completed payment can be corrected or voided, but cannot return to pending.');
    if(before.refund_of!==row.refund_of)model.fail(422,'The original refund link cannot be changed. Void and replace this entry.');
    const links=(await db.prepare('SELECT id FROM pp_allocations WHERE payment_id=? UNION ALL SELECT id FROM pp_payments WHERE refund_of=?').bind(before.id,before.id).all()).results;
    const immutable=['person_id','project','direction','category','amount_paise','transaction_date'];
    if(links.length&&immutable.some(k=>before[k]!==row[k]))model.fail(409,'This payment has allocation or refund history. Reverse active allocations/refunds, void this entry, then create a replacement to correct financial details.');
    if(row.status==='void') {
      const active=await db.prepare("SELECT id FROM pp_allocations WHERE payment_id=? AND reversed_on IS NULL UNION ALL SELECT id FROM pp_payments WHERE refund_of=? AND status<>'void' LIMIT 1").bind(before.id,before.id).first();
      if(active)model.fail(409,'Reverse allocations and void linked refunds before voiding this payment.');
    }
  }
  if(row.status!=='void'&&row.reference_key) {
    const duplicate=await db.prepare("SELECT id FROM pp_payments WHERE mode=? AND direction=? AND reference_key=? AND status<>'void' AND id<>?").bind(row.mode,row.direction,row.reference_key,before?.id||'').first();
    if(duplicate)model.fail(409,'A payment with this mode, direction and reference already exists.');
  }
  if(row.status!=='void'&&!row.reference_key) {
    const duplicates=(await db.prepare("SELECT id FROM pp_payments WHERE person_id=? AND project=? AND direction=? AND transaction_date=? AND amount_paise=? AND mode=? AND status<>'void' AND id<>?").bind(row.person_id,row.project,row.direction,row.transaction_date,row.amount_paise,row.mode,before?.id||'').all()).results;
    if(duplicates.length&&!input.duplicateReason)model.fail(409,'A matching payment exists. Check the ledger before recording another.',{duplicateConfirmationRequired:true,duplicates});
    if(duplicates.length)model.reason(input.duplicateReason);
  }
  if(row.refund_of&&row.status!=='void') {
    const original=await required(db,'payments',row.refund_of);
    if(original.status!=='completed'||original.refund_of||original.person_id!==row.person_id||original.project!==row.project||original.direction===row.direction||row.category!=='Other'||row.transaction_date<original.transaction_date)model.fail(422,'A refund must reverse a completed original payment for the same person and project, use Other, and be dated on or after the original.');
    const allocations=(await db.prepare('SELECT amount_paise FROM pp_allocations WHERE payment_id=? AND reversed_on IS NULL').bind(original.id).all()).results;
    const refunds=(await db.prepare("SELECT amount_paise FROM pp_payments WHERE refund_of=? AND status<>'void' AND id<>?").bind(original.id,before?.id||'').all()).results;
    const remaining=original.amount_paise-model.sum([...allocations,...refunds].map(a=>a.amount_paise));
    if(row.amount_paise>remaining)model.fail(409,'Refund exceeds the unallocated balance. Reverse the relevant allocations first; pending refunds also reserve money.');
  }
}
async function checkDue(db,row,before) {
  await linkedPerson(db,row,before);
  if(!before&&row.status!=='open')model.fail(422,'A new amount due must be open.');
  if(before) {
    if(before.status==='cancelled')model.fail(409,'Cancelled obligations are final. Create a replacement.');
    const allocations=(await db.prepare('SELECT * FROM pp_allocations WHERE due_id=?').bind(before.id).all()).results;
    if(allocations.length&&['person_id','project','direction','category','amount_paise','issued_on','due_on'].some(k=>row[k]!==before[k]))model.fail(409,'This obligation has payment history. Reverse active allocations, cancel it, then create a replacement to correct its amount or dates.');
    if(row.status==='cancelled'&&allocations.some(a=>!a.reversed_on))model.fail(409,'Reverse allocations before cancelling this obligation.');
  }
}
async function saveRecord(db,user,kind,id,input) {
  const before=id?await required(db,kind,id):null;
  const why=before?revision(before,input):'Created record';
  const row=kind==='people'?model.personInput(input):kind==='payments'?model.paymentInput(input):model.dueInput(input);
  if(kind==='people'&&(!before||['name_key','code_key','email','phone'].some(k=>row[k]!==before[k])))await checkPersonDuplicates(db,row,id,input);
  if(kind==='payments')await checkPayment(db,row,before,input);
  if(kind==='dues')await checkDue(db,row,before);
  const now=new Date().toISOString();
  const after={...(before||{id:crypto.randomUUID(),created_at:now,created_by:user.id}),...row,updated_at:now,updated_by:user.id,version:(before?.version||0)+1};
  if(before)await update(db,tables[kind],id,after);else await insert(db,tables[kind],after);
  await audit(db,user,kind,before,after,before?'corrected':'created',why+(input.duplicateReason?'; Separate duplicate confirmed: '+model.reason(input.duplicateReason):''));
  return {id:after.id,version:after.version};
}
async function allocate(db,user,input) {
  const payment=await required(db,'payments',input.paymentId), due=await required(db,'dues',input.dueId), amount=model.amount(input.amountPaise);
  if(payment.status!=='completed'||payment.refund_of||due.status!=='open'||payment.person_id!==due.person_id||payment.project!==due.project||payment.direction!==due.direction)model.fail(422,'Apply a completed, non-refund payment to an open obligation for the same person, project and direction.');
  const links=(await db.prepare('SELECT * FROM pp_allocations WHERE (payment_id=? OR due_id=?) AND reversed_on IS NULL').bind(payment.id,due.id).all()).results;
  const refunds=(await db.prepare("SELECT amount_paise FROM pp_payments WHERE refund_of=? AND status<>'void'").bind(payment.id).all()).results;
  const available=payment.amount_paise-model.sum(links.filter(a=>a.payment_id===payment.id).map(a=>a.amount_paise))-model.sum(refunds.map(a=>a.amount_paise));
  const pending=due.amount_paise-model.sum(links.filter(a=>a.due_id===due.id).map(a=>a.amount_paise));
  if(amount>available||amount>pending)model.fail(409,'Amount exceeds the payment’s available balance or the obligation’s remaining balance. Refresh and try again.');
  const after={id:crypto.randomUUID(),payment_id:payment.id,due_id:due.id,amount_paise:amount,applied_on:model.today(),reversed_on:null,created_at:new Date().toISOString(),created_by:user.id,reversed_at:null,reversed_by:null};
  await insert(db,'pp_allocations',after);
  await audit(db,user,'allocations',null,after,'applied','Payment applied to obligation');
  return {id:after.id};
}
async function reverse(db,user,id,input) {
  const before=await required(db,'allocations',id),why=model.reason(input.reason);
  if(before.reversed_on)model.fail(409,'This application was already reversed.');
  const after={...before,reversed_on:model.today(),reversed_at:new Date().toISOString(),reversed_by:user.id};
  await update(db,'pp_allocations',id,after);
  await audit(db,user,'allocations',before,after,'reversed',why);
  return {id};
}
function exportCsv(data,type) {
  let headers,rows;
  const attribution=['Recorded by','Recorded at (UTC)','Last corrected by','Last updated at (UTC)','Version'];
  const tail=r=>[r.createdByName,r.created_at,r.updatedByName,r.updated_at,r.version];
  if(type==='people') {
    headers=['Profile ID','Name','Roles','Code','Email','Phone','Projects','Active','Notes',...attribution];
    rows=data.people.map(p=>[p.id,p.name,p.roles.join('; '),p.code,p.email,p.phone,p.projects.join('; '),p.active?'Yes':'No',p.notes,...tail(p)]);
  }else if(type==='payments') {
    headers=['Payment ID','Payment date (YYYY-MM-DD)','Person','Person ID','Project','Direction','Category','Amount (INR)','Amount (paise)','Mode','Status','Reference','Refund of payment ID','Currently applied (INR)','Refunded (INR)','Available (INR)','Notes',...attribution];
    rows=data.payments.map(p=>[p.id,p.transaction_date,p.personName,p.person_id,p.project,p.direction==='in'?'Money in':'Money out',p.category,model.decimalINR(p.amount_paise),p.amount_paise,p.mode,p.status,p.reference,p.refund_of,model.decimalINR(p.allocatedPaise),model.decimalINR(p.refundedPaise),model.decimalINR(p.availablePaise),p.notes,...tail(p)]);
  }else {
    headers=['Obligation ID','Obligation date (YYYY-MM-DD)','Due date (YYYY-MM-DD)','Balance as of (YYYY-MM-DD)','Person','Person ID','Project','Direction','Category','Amount due (INR)','Amount due (paise)','Applied (INR)','Pending (INR)','Status','Reference','Notes',...attribution];
    rows=data.dues.map(d=>[d.id,d.issued_on,d.due_on,data.summary.asOf,d.personName,d.person_id,d.project,d.direction==='in'?'Owed to SSR':'Owed by SSR',d.category,model.decimalINR(d.amount_paise),d.amount_paise,model.decimalINR(d.paidPaise),model.decimalINR(d.pendingPaise),d.settlementStatus,d.reference,d.notes,...tail(d)]);
  }
  return new Response(model.csv(headers,rows),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="ssr-${type}-${model.today()}.csv"`,'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
export async function financeApi(request,env) {
  try {
    await authorize(request,env,{admin:true});
    const db=database(env),url=new URL(request.url),parts=url.pathname.replace(/^\/api\/finance\/?/,'').split('/');
    if(request.method==='GET') {
      if(parts[0]==='history'&&parts.length===1) {
        const kind=model.choice(url.searchParams.get('entityType'),Object.keys(tables),'record type'),id=model.uuid(url.searchParams.get('id'));
        await required(db,kind,id);
        const history=(await db.prepare('SELECT * FROM pp_audit WHERE entity_type=? AND entity_id=? ORDER BY id DESC').bind(kind,id).all()).results;
        return json({history:history.map(h=>({...h,before:h.before_json?JSON.parse(h.before_json):null,after:JSON.parse(h.after_json),before_json:undefined,after_json:undefined}))});
      }
      if(parts[0]==='people'&&parts.length===2) {
        const person=await required(db,'people',parts[1]),data=await load(db);
        return json({person:{...person,roles:JSON.parse(person.roles_json),projects:JSON.parse(person.projects_json)},...model.personSummary(data,person.id)});
      }
      if(['state','export'].includes(parts[0])&&parts.length===1) {
        const f=model.filters(url.searchParams),data=await load(db),result=model.report(data,f);
        if(parts[0]==='export')return exportCsv(result,model.choice(f.type,['people','payments','dues'],'export type'));
        const current=model.decorate(data,'9999-12-31');
        return json({...result,directory:current.people,options:{payments:current.payments,dues:current.dues,allocations:current.allocations},meta:{roles:model.roles,projects:model.projects,categories:model.categories,modes:model.modes,today:model.today()}});
      }
      model.fail(404,'Not found.');
    }
    if(!['POST','PATCH'].includes(request.method))model.fail(405,'Use a correction or reversal; financial history cannot be deleted.');
    const input=await readBody(request),key=model.uuid(request.headers.get('idempotency-key'),'request key');
    const fingerprint=await digest(request.method+' '+url.pathname+' '+JSON.stringify(input));
    const result=await db.transaction(async tx=>{
      // Recheck role, session and CSRF while holding the same write transaction.
      const user=await authorize(request,{...env,DB:tx},{admin:true});
      const previous=await tx.prepare('SELECT * FROM pp_requests WHERE id=?').bind(key).first();
      if(previous) {
        if(previous.actor_id!==user.id||previous.fingerprint!==fingerprint)model.fail(409,'This request key was already used for different data.');
        return {body:JSON.parse(previous.response_json),status:previous.status_code};
      }
      let body,status=200;
      if(['people','payments','dues'].includes(parts[0])&&((parts.length===1&&request.method==='POST')||(parts.length===2&&request.method==='PATCH'))) {
        body=await saveRecord(tx,user,parts[0],parts[1],input); status=parts.length===1?201:200;
      }else if(parts[0]==='allocations'&&parts.length===1&&request.method==='POST') {body=await allocate(tx,user,input);status=201;}
      else if(parts[0]==='allocations'&&parts.length===3&&parts[2]==='reverse'&&request.method==='POST')body=await reverse(tx,user,parts[1],input);
      else model.fail(404,'Not found.');
      await insert(tx,'pp_requests',{id:key,actor_id:user.id,fingerprint,response_json:JSON.stringify(body),status_code:status,created_at:new Date().toISOString()});
      return {body,status};
    });
    return json(result.body,result.status);
  }catch(error) {
    if(error instanceof AuthError)return json({error:error.message,...error.extra},error.status);
    if(/UNIQUE constraint/i.test(error.message))return json({error:'This profile code, payment reference or request already exists. Refresh and review existing records.'},409);
    if(/SQLITE_BUSY|SQLITE_LOCKED|TRANSACTION_TIMEOUT/i.test(error.message))return json({error:'Another update is in progress. Retry the same request.'},409);
    console.error('SSR finance error',error?.name);
    return json({error:'The finance service is temporarily unavailable. Retry the same request.'},503);
  }
}
