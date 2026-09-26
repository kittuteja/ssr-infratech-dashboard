import { AuthError } from './auth.mjs';
import { projects } from './api.mjs';
export { projects };
export const roles = ['Customer','Engineer','Employee','Worker','Contractor','Vendor','Consultant'];
export const categories = {
  in: ['Customer payment','Booking amount','Installment','Advance received','Other'],
  out: ['Salary','Worker wage','Contractor payment','Vendor payment','Advance paid','Reimbursement','Other']
};
export const modes = ['Cash','Bank transfer','UPI','Cheque','Card','Other'];
export const MAX_PAISE = 1000000000000;
export const fail = (status, message, extra) => { throw new AuthError(status, message, extra); };
export const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0,10);
export const normalize = value => value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export function text(value, label, max = 500, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max) fail(422, `${label} must contain at most ${max} characters.`);
  value = value.trim();
  if (required && !value) fail(422, `${label} is required.`);
  return value;
}
export function choice(value, values, label) { if (!values.includes(value)) fail(422, `Choose a valid ${label}.`); return value; }
export function uuid(value, label = 'record') { if (typeof value !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) fail(422, `Choose a valid ${label}.`); return value; }
export function date(value, label, future = true) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') fail(422, `${label} must be a calendar date (YYYY-MM-DD).`);
  const time = new Date(value+'T00:00:00Z');
  if (!Number.isFinite(time.getTime()) || time.toISOString().slice(0,10) !== value || (!future && value > today())) fail(422, `${label} is invalid or in the future.`);
  return value;
}
export function amount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAISE) fail(422, 'Amount must be a positive integer in paise, at most ₹10,000,000,000.00.');
  return value;
}
export function sum(values) {
  const total = values.reduce((a,b)=>a+b,0);
  if (!Number.isSafeInteger(total)) fail(422, 'The report total exceeds the supported exact amount. Narrow the date range.');
  return total;
}
export function reason(value) { const r = text(value,'Reason',500,true); if (r.length < 8) fail(422,'Explain the change in at least 8 characters.'); return r; }
export function list(value, allowed, label) {
  if (!Array.isArray(value) || !value.length || value.length > allowed.length || new Set(value).size !== value.length) fail(422, `Choose one or more distinct ${label}.`);
  return value.map(v=>choice(v,allowed,label)).sort();
}
export function personInput(input) {
  const name = text(input.name,'Name',120,true), code = text(input.code,'Employee/vendor code',50), email = text(input.email,'Email',254).toLowerCase(), phone = text(input.phone,'Phone',30);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(422,'Enter a valid email address.');
  if (phone && (!/^[+\d ()-]+$/.test(phone) || phone.replace(/\D/g,'').length < 7)) fail(422,'Enter a valid contact phone number.');
  if (typeof input.active !== 'boolean') fail(422,'Choose an active status.');
  return { name, name_key: normalize(name), code, code_key: code ? normalize(code) : null, email, phone, notes: text(input.notes,'Notes',2000), roles_json: JSON.stringify(list(input.roles,roles,'roles')), projects_json: JSON.stringify(list(input.projects,projects,'projects')), active: input.active ? 1 : 0 };
}
export function paymentInput(input) {
  const direction = choice(input.direction,['in','out'],'direction'), status = choice(input.status,['pending','completed','void'],'payment status'), reference = text(input.reference,'Reference',120);
  return { person_id: uuid(input.personId,'person'), project: choice(input.project,projects,'project'), direction,
    category: choice(input.category,categories[direction],'category'), amount_paise: amount(input.amountPaise), mode: choice(input.mode,modes,'payment mode'), status,
    transaction_date: date(input.transactionDate,'Payment date',status !== 'completed'), reference, reference_key: reference ? normalize(reference) : null,
    notes: text(input.notes,'Notes',2000), refund_of: input.refundOf ? uuid(input.refundOf,'original payment') : null };
}
export function dueInput(input) {
  const direction = choice(input.direction,['in','out'],'direction'), issued_on = date(input.issuedOn,'Obligation date',false), due_on = date(input.dueOn,'Due date');
  if (due_on < issued_on) fail(422,'Due date cannot precede the obligation date.');
  return { person_id: uuid(input.personId,'person'), project: choice(input.project,projects,'project'), direction, category: choice(input.category,categories[direction],'category'),
    amount_paise: amount(input.amountPaise), issued_on, due_on, status: choice(input.status,['open','cancelled'],'obligation status'),
    reference: text(input.reference,'Reference',120), notes: text(input.notes,'Notes',2000) };
}
export const activeAllocation = (a, end = '9999-12-31') => a.applied_on <= end && (!a.reversed_on || a.reversed_on > end);
export function decorate(data, end = today()) {
  const names = Object.fromEntries(data.people.map(p=>[p.id,p.name]));
  const people = data.people.map(p=>({...p,roles:JSON.parse(p.roles_json),projects:JSON.parse(p.projects_json)}));
  const payments = data.payments.map(p=>{
    const allocatedPaise = sum(data.allocations.filter(a=>a.payment_id===p.id && !a.reversed_on).map(a=>a.amount_paise));
    const refunds = data.payments.filter(r=>r.refund_of===p.id && r.status!=='void');
    const refundedPaise = sum(refunds.filter(r=>r.status==='completed').map(r=>r.amount_paise));
    const reservedRefundPaise = sum(refunds.filter(r=>r.status==='pending').map(r=>r.amount_paise));
    return {...p,personName:names[p.person_id],allocatedPaise,refundedPaise,reservedRefundPaise,availablePaise:p.status==='completed' && !p.refund_of ? p.amount_paise-allocatedPaise-refundedPaise-reservedRefundPaise : 0};
  });
  const paymentMap = Object.fromEntries(payments.map(p=>[p.id,p]));
  const dues = data.dues.map(d=>{
    const paidPaise = sum(data.allocations.filter(a=>a.due_id===d.id && activeAllocation(a,end) && paymentMap[a.payment_id]?.status==='completed' && paymentMap[a.payment_id].transaction_date<=end).map(a=>a.amount_paise));
    const pendingPaise = d.status==='cancelled' ? 0 : d.amount_paise-paidPaise;
    return {...d,personName:names[d.person_id],paidPaise,pendingPaise,settlementStatus:d.status==='cancelled'?'cancelled':pendingPaise===0?'paid':paidPaise>0?'partially_paid':d.due_on<end?'overdue':'open'};
  });
  return {people,payments,dues,allocations:data.allocations};
}
export function filters(params) {
  const f = Object.fromEntries(params);
  for (const key of Object.keys(f)) if (!['from','to','project','personId','role','category','direction','status','dueStatus','active','q','type'].includes(key)) fail(422,'Unknown filter: '+key);
  if (f.from) date(f.from,'Start date'); if (f.to) date(f.to,'End date');
  if (f.from && f.to && f.from>f.to) fail(422,'Start date must be before the end date.');
  if (f.project) choice(f.project,projects,'project'); if (f.personId) uuid(f.personId,'person'); if (f.role) choice(f.role,roles,'role');
  if (f.category) choice(f.category,[...new Set(Object.values(categories).flat())],'category');
  if (f.direction) choice(f.direction,['in','out'],'direction'); if (f.status) choice(f.status,['pending','completed','void'],'payment status');
  if (f.dueStatus) choice(f.dueStatus,['open','overdue','partially_paid','paid','cancelled'],'due status');
  if (f.active) choice(f.active,['active','inactive'],'profile status');
  f.q = text(f.q,'Search',120).toLowerCase();
  return f;
}
export function report(data, f = {}) {
  const end = f.to || today(), decorated = decorate(data,end), personMap = Object.fromEntries(decorated.people.map(p=>[p.id,p]));
  const matchPerson = p => (!f.personId||p.id===f.personId) && (!f.role||p.roles.includes(f.role)) && (!f.active||(f.active==='active')===!!p.active);
  const search = value => !f.q || value.toLowerCase().includes(f.q);
  const people = decorated.people.filter(p=>matchPerson(p) && (!f.project||p.projects.includes(f.project)) && search([p.name,p.code,p.email,p.phone,p.notes,...p.roles].join(' ')));
  const match = r => matchPerson(personMap[r.person_id]) && (!f.project||r.project===f.project) && (!f.category||r.category===f.category) && (!f.direction||r.direction===f.direction) && search([r.personName,personMap[r.person_id].code,r.reference,r.notes,r.category].join(' '));
  const inRange = value => (!f.from||value>=f.from) && value<=end;
  const payments = decorated.payments.filter(p=>match(p) && inRange(p.transaction_date) && (!f.status||p.status===f.status));
  const dues = decorated.dues.filter(d=>match(d) && inRange(d.due_on) && d.issued_on<=end && (!f.dueStatus||d.settlementStatus===f.dueStatus));
  const completed = payments.filter(p=>p.status==='completed');
  return {people,payments,dues,summary:{
    receivedPaise:sum(completed.filter(p=>p.direction==='in').map(p=>p.amount_paise)),
    paidPaise:sum(completed.filter(p=>p.direction==='out').map(p=>p.amount_paise)),
    receivablesPaise:sum(dues.filter(d=>d.direction==='in').map(d=>d.pendingPaise)),
    payablesPaise:sum(dues.filter(d=>d.direction==='out').map(d=>d.pendingPaise)),
    refundsReceivedPaise:sum(completed.filter(p=>p.refund_of&&p.direction==='in').map(p=>p.amount_paise)),
    refundsPaidPaise:sum(completed.filter(p=>p.refund_of&&p.direction==='out').map(p=>p.amount_paise)),
    asOf:end
  }};
}
export function personSummary(data, id) {
  const d = decorate(data,'9999-12-31'), payments = d.payments.filter(p=>p.person_id===id), dues = d.dues.filter(p=>p.person_id===id);
  const netCategory = category => sum(payments.filter(p=>p.status==='completed'&&!p.refund_of&&p.category===category).map(p=>p.amount_paise-p.refundedPaise));
  const salaryIds = new Set(dues.filter(o=>o.category==='Salary'&&o.status==='open').map(o=>o.id));
  return {payments,dues,allocations:d.allocations.filter(a=>payments.some(p=>p.id===a.payment_id)),summary:{
    salaryPaidPaise:netCategory('Salary'), salarySettledPaise:sum(dues.filter(o=>salaryIds.has(o.id)).map(o=>o.paidPaise)),
    pendingSalaryPaise:sum(dues.filter(o=>salaryIds.has(o.id)).map(o=>o.pendingPaise)),
    advancesReceivedPaise:netCategory('Advance received'),advancesPaidPaise:netCategory('Advance paid'),
    unappliedAdvancesPaise:sum(payments.filter(p=>['Advance paid','Advance received'].includes(p.category)).map(p=>p.availablePaise)),
    receivablesPaise:sum(dues.filter(o=>o.direction==='in').map(o=>o.pendingPaise)),payablesPaise:sum(dues.filter(o=>o.direction==='out').map(o=>o.pendingPaise))
  }};
}
export const decimalINR = value => `${Math.floor(value/100)}.${String(value%100).padStart(2,'0')}`;
export function csv(headers, rows) {
  const cell = value => { let v=String(value??''); if (/^[\s]*[=+\-@\t\r\n]/.test(v)) v="'"+v; return '"'+v.replaceAll('"','""')+'"'; };
  return '\ufeff'+[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
