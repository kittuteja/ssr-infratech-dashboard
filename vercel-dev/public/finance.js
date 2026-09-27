'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2}).format(value / 100);
  const decimal = value => `${Math.floor(value/100)}.${String(value%100).padStart(2,'0')}`;
  const paise = value => {
    if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter a positive INR amount with at most two decimal places.');
    const [whole,fraction='']=value.split('.'), amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
    if (!Number.isSafeInteger(amount)||amount<1||amount>1000000000000) throw new Error('Enter an amount between ₹0.01 and ₹10,000,000,000.00.');
    return amount;
  };
  const time = value => value ? new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})+' IST' : '—';
  const date = value => value ? new Date(value+'T00:00:00Z').toLocaleDateString('en-IN',{timeZone:'UTC',dateStyle:'medium'}) : '—';
  const badge = value => `<span class="finance-state ${esc(value)}">${esc(value.replaceAll('_',' '))}</span>`;
  const action = (label,act,kind,id) => `<button class="row-action" data-action="${act}" data-kind="${kind}" data-id="${esc(id)}">${label}</button>`;
  const historyButton = (kind,id) => action('History','history',kind,id);
  const fields = $('#finance-filters').elements;
  let state, tab='people', page=0, appliedQuery='', loadSequence=0, editor, detailContext;
  async function api(path,options={}) {
    const response=await fetch('/api/finance/'+path,{credentials:'same-origin',...options,headers:{'content-type':'application/json','x-csrf-token':window.SSR.csrf,...options.headers}});
    let body; try {body=await response.json();}catch{throw new Error('The service is unavailable. Please retry.');}
    if(!response.ok) {
      if(response.status===401)location.assign('/login');
      if(body.passwordChangeRequired)location.assign('/password');
      const error=new Error(body.error||'Unable to complete this request.'); Object.assign(error,body); throw error;
    }
    return body;
  }
  const showError = error => { $('#account-error').textContent=error.message; };
  const setOptions = (element,options,placeholder,selected=element.value) => {
    element.innerHTML=(placeholder!==null?`<option value="">${esc(placeholder)}</option>`:'')+options.map(item=>{
      const [value,label]=Array.isArray(item)?item:[item,item];return `<option value="${esc(value)}">${esc(label)}</option>`;
    }).join(''); element.value=selected;
    if(placeholder===null&&element.selectedIndex<0)element.selectedIndex=0;
  };
  function populateFilters() {
    setOptions(fields.project,state.meta.projects,'All projects');
    setOptions(fields.personId,state.directory.map(p=>[p.id,p.name+(p.code?' · '+p.code:'')+(!p.active?' (inactive)':'')]),'All people');
    setOptions(fields.role,state.meta.roles,'All roles');
    setOptions(fields.category,[...new Set(Object.values(state.meta.categories).flat())],'All categories');
  }
  function query() {return new URLSearchParams([...new FormData($('#finance-filters'))].filter(([,v])=>v)).toString();}
  async function refresh() {
    const sequence=++loadSequence, nextQuery=query();
    $('#refresh-finance').disabled=true;
    try {
      const result=await api('state?'+nextQuery); if(sequence!==loadSequence)return;
      state=result; appliedQuery=nextQuery; $('#account-error').textContent=''; populateFilters(); render();
      $('#add-finance').disabled=false; $('#export-finance').disabled=false;
    } finally {if(sequence===loadSequence)$('#refresh-finance').disabled=false;}
  }
  function paymentRow(p,compact=false) {
    return `<tr><td>${esc(date(p.transaction_date))}<small>${p.refund_of?'Refund · '+esc(p.refund_of.slice(0,8)):'Payment · '+esc(p.id.slice(0,8))}</small></td><td class="person-cell"><button class="finance-link" data-action="person" data-id="${p.person_id}">${esc(p.personName)}</button><small>${esc(p.project)}</small></td><td>${esc(p.category)}<small>${esc(p.mode)} · ${esc(p.reference||'No reference')}</small></td><td class="money-cell money-${p.direction}">${p.direction==='in'?'In':'Out'} ${money(p.amount_paise)}<small>${p.refund_of?'Linked refund':`Available ${money(p.availablePaise)}`}</small></td><td>${badge(p.status)}<small>${esc(p.createdByName||'')}</small></td><td><div class="row-actions">${action('Details','details','payments',p.id)}${!compact&&p.status!=='void'?action('Correct','edit','payments',p.id):''}${!compact&&p.availablePaise>0?action('Apply','apply','payments',p.id)+action('Refund','refund','payments',p.id):''}${historyButton('payments',p.id)}</div></td></tr>`;
  }
  function dueRow(d,compact=false) {
    return `<tr><td>${esc(date(d.due_on))}<small>Issued ${esc(date(d.issued_on))}</small></td><td class="person-cell"><button class="finance-link" data-action="person" data-id="${d.person_id}">${esc(d.personName)}</button><small>${esc(d.project)}</small></td><td>${esc(d.category)}<small>${d.direction==='in'?'Owed to SSR':'Owed by SSR'} · ${esc(d.reference||'No reference')}</small></td><td class="money-cell">${money(d.amount_paise)}<small>Applied ${money(d.paidPaise)}</small></td><td class="money-cell">${money(d.pendingPaise)}<small>${badge(d.settlementStatus)}</small></td><td><div class="row-actions">${action('Details','details','dues',d.id)}${!compact&&d.status==='open'?action('Correct','edit','dues',d.id):''}${!compact&&d.pendingPaise>0?action('Apply payment','apply','dues',d.id):''}${historyButton('dues',d.id)}</div></td></tr>`;
  }
  const paymentHeads=['Date','Person / project','Category / mode','Amount (INR)','Status / recorded by','Actions'];
  const dueHeads=['Due date','Person / project','Obligation','Amount (INR)','Pending (INR)','Actions'];
  function table(heads,rows,empty='No records yet.') {return `<div class="table-scroll"><table><thead><tr>${heads.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${heads.length}" class="finance-empty">${esc(empty)}</td></tr>`}</tbody></table></div>`;}
  function render() {
    const s=state.summary;
    for(const [id,key] of [['received','receivedPaise'],['paid','paidPaise'],['receivable','receivablesPaise'],['payable','payablesPaise']])$('#'+id+'-total').textContent=money(s[key]);
    $('#report-basis').textContent=`Cash uses payment dates and completed entries only. Dues use due dates within the selected range, with balances through ${date(s.asOf)}. Payment status filters affect cash only; due status filters affect dues only. Included refunds: received ${money(s.refundsReceivedPaise)} · paid ${money(s.refundsPaidPaise)}.`;
    const names={people:['People & entities','Add person'],payments:['Payment Ledger','Record payment'],dues:['Amounts Due','Record amount due']};
    $('#record-title').textContent=names[tab][0];$('#add-finance').textContent=names[tab][1];
    const rows=state[tab],pageSize=30; page=Math.min(page,Math.max(0,Math.ceil(rows.length/pageSize)-1));
    $('#record-count').textContent=`${rows.length} matching record${rows.length===1?'':'s'}${tab==='people'?' · Profiles are independent of the date range':''}`;
    const shown=rows.slice(page*pageSize,(page+1)*pageSize);
    const heads=tab==='payments'?paymentHeads:tab==='dues'?dueHeads:['Person / entity','Roles','Contact','Projects','Status','Actions'];
    const html=shown.map(r=>tab==='payments'?paymentRow(r):tab==='dues'?dueRow(r):`<tr><td class="person-cell"><button class="finance-link" data-action="person" data-id="${r.id}">${esc(r.name)}</button><small>${esc(r.code||'No employee/vendor code')}</small></td><td>${r.roles.map(esc).join('<br>')}</td><td>${esc(r.email||'—')}<small>${esc(r.phone||'')}</small></td><td>${r.projects.map(esc).join('<br>')}</td><td>${badge(r.active?'active':'inactive')}</td><td><div class="row-actions">${action('View profile','person','people',r.id)}${action('Edit','edit','people',r.id)}${historyButton('people',r.id)}</div></td></tr>`).join('');
    $('#finance-table thead').innerHTML=`<tr>${heads.map(h=>`<th scope="col">${h}</th>`).join('')}</tr>`;
    $('#finance-table tbody').innerHTML=html||`<tr><td colspan="${heads.length}" class="finance-empty"><strong>${tab==='people'?'No people to show':tab==='payments'?'No payments to show':'No amounts due to show'}</strong>${tab==='people'?'Add your first person or adjust the filters.':tab==='payments'?'Record a payment after adding a person. Only completed payments count in cash totals.':'Record a receivable or payable separately. For future due dates, select “Include all upcoming dues”.'}</td></tr>`;
    $('.finance-pagination')?.remove();
    if(rows.length>pageSize) {const footer=document.createElement('div');footer.className='finance-pagination';footer.innerHTML=`<button class="secondary" id="previous-page" ${page===0?'disabled':''}>Previous</button><span>Page ${page+1} of ${Math.ceil(rows.length/pageSize)}</span><button class="secondary" id="next-page" ${(page+1)*pageSize>=rows.length?'disabled':''}>Next</button>`;$('#record-panel').append(footer);$('#previous-page').onclick=()=>{page--;render();};$('#next-page').onclick=()=>{page++;render();};}
  }
  const inputField=(label,name,value='',type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  const selectField=(label,name,options,value,extra='')=>`<label>${label}<select name="${name}" ${extra}>${options.map(item=>{const [val,title]=Array.isArray(item)?item:[item,item];return `<option value="${esc(val)}" ${val===value?'selected':''}>${esc(title)}</option>`;}).join('')}</select></label>`;
  const notesField=(name,value,label='Notes',required=false)=>`<label class="full">${label}<textarea name="${name}" maxlength="${required?500:2000}" ${required?'required minlength="8"':''}>${esc(value||'')}</textarea></label>`;
  const checkboxField=(label,name,options,selected=[])=>`<fieldset class="full"><legend>${label}</legend><div class="finance-checkboxes">${options.map(v=>`<label><input type="checkbox" name="${name}" value="${esc(v)}" ${selected.includes(v)?'checked':''}>${esc(v)}</label>`).join('')}</div></fieldset>`;
  const record = (kind,id) => (kind==='people'?state.directory:state.options[kind]).find(r=>r.id===id);
  function beginEditor(title,help,html,context) {
    editor={...context,lastBody:null,key:null};$('#finance-form').reset();$('#duplicate-review').hidden=true;
    $('#finance-form').elements.duplicateReason.required=false;$('#editor-error').textContent='';
    $('#editor-title').textContent=title;$('#editor-help').textContent=help;$('#editor-fields').innerHTML=html;
    $('#save-finance').textContent=context.action==='reverse'?'Reverse application':'Save record';
    if(!$('#finance-editor').open)$('#finance-editor').showModal();
  }
  function editRecord(kind,id,refundId) {
    const existing=id?record(kind,id):null, original=refundId?record('payments',refundId):null;
    let html, row=existing||{},help='Every change records your name and timestamp.';
    if(kind==='people') {
      html=inputField('Name *','name',row.name,'text','required maxlength="120"')+inputField('Employee/vendor code','code',row.code,'text','maxlength="50"')+inputField('Email','email',row.email,'email','maxlength="254"')+inputField('Phone','phone',row.phone,'tel','maxlength="30"')+checkboxField('Business roles *','roles',state.meta.roles,row.roles)+checkboxField('Associated projects *','projects',state.meta.projects,row.projects)+selectField('Profile status','active',[['true','Active'],['false','Inactive']],row.active===0?'false':'true')+notesField('notes',row.notes);
      help='A profile can have several roles and projects. Deactivation keeps payment history and blocks new entries for this profile. Profiles do not create login accounts.';
    }else {
      if(!existing&&!original&&!state.directory.some(p=>p.active)) {$('#finance-notice').textContent='Add an active person and associate them with a project first.';editRecord('people');return;}
      if(original)row={person_id:original.person_id,project:original.project,direction:original.direction==='in'?'out':'in',category:'Other',amount_paise:original.availablePaise,mode:original.mode,status:'completed',refund_of:original.id};
      const direction=row.direction||(kind==='dues'?'out':'in');
      const people=state.directory.filter(p=>p.active||p.id===row.person_id).map(p=>[p.id,p.name+(p.code?' · '+p.code:'')+(!p.active?' (inactive)':'')]);
      html=selectField('Person or entity *','personId',people,row.person_id,'required')+selectField('Project *','project',state.meta.projects,row.project,'required')+selectField(kind==='dues'?'Amount owed *':'Direction *','direction',[['in',kind==='dues'?'Owed to SSR':'Money in'],['out',kind==='dues'?'Owed by SSR':'Money out']],direction)+selectField('Category *','category',state.meta.categories[direction],row.category)+inputField('Amount (INR) *','amount',row.amount_paise?decimal(row.amount_paise):'','text','required inputmode="decimal" placeholder="0.00"');
      if(kind==='payments') {
        html+=inputField('Payment date *','transactionDate',row.transaction_date||state.meta.today,'date','required')+selectField('Payment mode *','mode',state.meta.modes,row.mode||'Bank transfer')+selectField('Payment status *','status',existing?(row.status==='completed'?['completed','void']:['pending','completed','void']):['completed','pending'],row.status||'completed');
        help=original?'This records a refund already made or pending. It does not transfer money. Refunds use Other in the opposite direction. Reverse any affected applications first.':existing?'Corrections need a reason. Payments with allocation/refund history lock financial details: reverse active links, void the original, and create a replacement. Notes, reference and mode can still be corrected.':'Record actual cash movement as Completed. Use Pending until money has moved. An advance only reduces an obligation after you apply it.';
      }else {
        html+=inputField('Obligation date *','issuedOn',row.issued_on||state.meta.today,'date','required')+inputField('Due date *','dueOn',row.due_on||state.meta.today,'date','required')+selectField('Obligation status','status',existing?['open','cancelled']:['open'],row.status||'open');
        help='An amount due is separate from cash. Apply completed payments to reduce its balance. To cancel a due or replace financial details after allocation, reverse its applications first.';
      }
      html+=inputField('Reference number','reference',row.reference,'text','maxlength="120"')+notesField('notes',row.notes);
    }
    if(existing)html+=notesField('reason','','Reason for this correction *',true);
    beginEditor(original?'Record refund':`${existing?'Correct':'New'} ${kind==='people'?'person / entity':kind==='payments'?'payment':'amount due'}`,help,html,{kind,id,existing,original});
    if(kind!=='people') {
      const form=$('#finance-form');
      function projectChoices(){const person=state.directory.find(p=>p.id===form.elements.personId.value);const projects=[...new Set([...(person?.projects||[]),...(existing&&existing.person_id===form.elements.personId.value?[existing.project]:[])])];setOptions(form.elements.project,projects,null,row.project||form.elements.project.value);}
      form.elements.personId.addEventListener('change',projectChoices);projectChoices();
      form.elements.direction.addEventListener('change',()=>setOptions(form.elements.category,state.meta.categories[form.elements.direction.value],null));
      if(original)for(const field of ['personId','project','direction','category'])form.elements[field].disabled=true;
    }
  }
  function applicationEditor(kind,id) {
    const due=kind==='dues'?record('dues',id):null;
    const payments=state.options.payments.filter(p=>p.availablePaise>0&&(!due||(p.person_id===due.person_id&&p.project===due.project&&p.direction===due.direction)));
    if(!payments.length)throw new Error('No available completed payment matches this obligation. Record a payment first, then apply it.');
    const html=selectField('Completed payment *','paymentId',payments.map(p=>[p.id,`${p.personName} · ${p.category} · ${money(p.availablePaise)} available · ${p.transaction_date} · ${p.id.slice(0,8)}`]),kind==='payments'?id:payments[0].id,'required')+selectField('Amount due *','dueId',[],due?.id,'required')+inputField('Amount to apply (INR) *','amount','','text','required inputmode="decimal" placeholder="0.00"');
    beginEditor('Apply a payment','This connects existing cash to an amount due. It does not record another payment. Partial applications are allowed; only matching people, projects and directions can be linked.',html,{action:'allocate'});
    const form=$('#finance-form');
    function choices(){const payment=record('payments',form.elements.paymentId.value);const dues=state.options.dues.filter(d=>d.pendingPaise>0&&d.person_id===payment.person_id&&d.project===payment.project&&d.direction===payment.direction);setOptions(form.elements.dueId,dues.map(d=>[d.id,`${d.category} · ${money(d.pendingPaise)} pending · due ${d.due_on} · ${d.id.slice(0,8)}`]),'Choose an amount due',due?.id||form.elements.dueId.value);form.elements.amount.value='';}
    form.elements.paymentId.addEventListener('change',choices);choices();
    form.elements.dueId.addEventListener('change',()=>{const p=record('payments',form.elements.paymentId.value),d=record('dues',form.elements.dueId.value);if(d)form.elements.amount.value=decimal(Math.min(p.availablePaise,d.pendingPaise));});
    if(due)form.elements.dueId.dispatchEvent(new Event('change'));
  }
  $('#finance-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.target,button=$('#save-finance');button.disabled=true;$('#editor-error').textContent='';
    try {
      const data=Object.fromEntries(new FormData(form));let path,method='POST',payload;
      if(editor.action==='reverse'){path=`allocations/${editor.id}/reverse`;payload={reason:data.reason};}
      else if(editor.action==='allocate'){path='allocations';payload={paymentId:data.paymentId,dueId:data.dueId,amountPaise:paise(data.amount)};}
      else {
        path=editor.kind+(editor.id?'/'+editor.id:'');method=editor.id?'PATCH':'POST';payload={...data};delete payload.amount;
        if(editor.kind==='people'){payload.roles=new FormData(form).getAll('roles');payload.projects=new FormData(form).getAll('projects');payload.active=data.active==='true';if(!payload.roles.length||!payload.projects.length)throw new Error('Choose at least one business role and project.');}
        else payload.amountPaise=paise(data.amount);
        if(editor.existing)payload.version=editor.existing.version;
        if(editor.existing?.refund_of)payload.refundOf=editor.existing.refund_of;
        if(editor.original)Object.assign(payload,{personId:editor.original.person_id,project:editor.original.project,direction:editor.original.direction==='in'?'out':'in',category:'Other',refundOf:editor.original.id});
      }
      const serialized=JSON.stringify(payload);
      if(serialized!==editor.lastBody){editor.key=crypto.randomUUID();editor.lastBody=serialized;}
      await api(path,{method,body:serialized,headers:{'idempotency-key':editor.key}});
      $('#finance-editor').close();$('#finance-notice').textContent='Saved. The change and your name have been recorded in history.';
      await refresh();
      if($('#finance-detail').open&&detailContext)await showDetail(detailContext.kind,detailContext.id);
    }catch(error){
      if($('#finance-editor').open) {
        $('#editor-error').textContent=error.message;
        if(error.duplicateConfirmationRequired){$('#duplicate-review').hidden=false;$('#duplicate-message').textContent='Potential matches: '+error.duplicates.map(d=>d.name?`${d.name}${d.code?' ('+d.code+')':''}${d.active===0?' (inactive)':''}`:d.id).join(', ')+'. Review existing records. Continue only if this is genuinely separate.';form.elements.duplicateReason.required=true;}
      }else showError(error);
    }finally{button.disabled=false;}
  });
  function applicationList(links) {
    return table(['Payment → amount due','Applied (INR)','Date / recorded by','Status / actions'],links.map(a=>{
      const p=record('payments',a.payment_id),d=record('dues',a.due_id);
      return `<tr><td>${esc(p?.category||'Payment')} → ${esc(d?.category||'Obligation')}<small>${esc(a.payment_id.slice(0,8))} → ${esc(a.due_id.slice(0,8))}</small></td><td>${money(a.amount_paise)}</td><td>${esc(date(a.applied_on))}<small>${esc(a.createdByName||'')}</small></td><td>${a.reversed_on?`Reversed ${esc(date(a.reversed_on))}<small>${esc(a.reversedByName||'')}</small>`:action('Reverse application','reverse','allocations',a.id)} ${historyButton('allocations',a.id)}</td></tr>`;
    }).join(''),'No payment applications yet.');
  }
  async function showDetail(kind,id) {
    detailContext={kind,id}; const dialog=$('#finance-detail');if(!dialog.open)dialog.showModal();$('#detail-content').textContent='Loading…';
    try {
      if(kind==='people') {
        const data=await api('people/'+id),p=data.person,s=data.summary;
        $('#detail-title').textContent=p.name;
        const cards=[['Salary payments, net of refunds',s.salaryPaidPaise],['Salary dues settled (includes advances)',s.salarySettledPaise],['Pending salary',s.pendingSalaryPaise],['Advances received, net of refunds',s.advancesReceivedPaise],['Advances paid, net of refunds',s.advancesPaidPaise],['Unapplied advances',s.unappliedAdvancesPaise],['Pending receivables',s.receivablesPaise],['Pending payables',s.payablesPaise]];
        $('#detail-content').innerHTML=`<p class="detail-description">${esc(p.roles.join(' · '))} · ${esc(p.code||'No code')} · ${badge(p.active?'active':'inactive')}<br>${esc(p.projects.join(' · '))}<br>${esc([p.email,p.phone].filter(Boolean).join(' · '))}<br>${esc(p.notes)}</p><p class="detail-description">All-time history, including future obligations. Salary cash and salary settled are different measures; do not add them together.</p><div class="finance-detail-summary">${cards.map(([label,value])=>`<div>${label}<strong>${money(value)}</strong></div>`).join('')}</div>${historyButton('people',id)}<section class="detail-section"><h3>Payment history</h3>${table(paymentHeads,data.payments.map(p=>paymentRow(p,true)).join(''))}</section><section class="detail-section"><h3>Amounts due</h3>${table(dueHeads,data.dues.map(d=>dueRow(d,true)).join(''))}</section><section class="detail-section"><h3>Applications & reversals</h3>${applicationList(data.allocations)}</section>`;
      }else {
        const r=record(kind,id);if(!r)throw new Error('Refresh to load this record.');
        $('#detail-title').textContent=`${kind==='payments'?'Payment':'Amount due'} · ${r.personName}`;
        const pairs=[['Record ID',r.id],['Person',r.personName],['Project',r.project],['Category',r.category],['Direction',r.direction==='in'?'Money in / owed to SSR':'Money out / owed by SSR'],['Amount',money(r.amount_paise)],['Status',r.status],['Reference',r.reference||'—'],['Notes',r.notes||'—'],['Recorded by',r.createdByName],['Recorded at',time(r.created_at)],['Last corrected by',r.updatedByName],['Last updated',time(r.updated_at)],['Version',r.version]];
        if(kind==='payments')pairs.splice(6,0,['Payment date',date(r.transaction_date)],['Payment mode',r.mode],['Available to apply / refund',money(r.availablePaise)],['Refund of',r.refund_of||'—'],['Completed refunds',money(r.refundedPaise)],['Pending refunds reserved',money(r.reservedRefundPaise)]);
        else pairs.splice(6,0,['Obligation date',date(r.issued_on)],['Due date',date(r.due_on)],['Applied',money(r.paidPaise)],['Pending now',money(r.pendingPaise)]);
        const links=state.options.allocations.filter(a=>kind==='payments'?a.payment_id===id:a.due_id===id);
        const refunds=kind==='payments'?state.options.payments.filter(p=>p.refund_of===id):[];
        $('#detail-content').innerHTML=`<dl class="material-facts">${pairs.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${historyButton(kind,id)}<section class="detail-section"><h3>Applications & reversals</h3>${applicationList(links)}</section>${refunds.length?`<section class="detail-section"><h3>Linked refunds</h3>${table(paymentHeads,refunds.map(p=>paymentRow(p,true)).join(''))}</section>`:''}`;
      }
    }catch(error){$('#detail-content').textContent=error.message;}
  }
  const fieldLabels={person_id:'Person ID',amount_paise:'Amount (INR)',roles_json:'Roles',projects_json:'Projects',refund_of:'Refund of',transaction_date:'Payment date',issued_on:'Obligation date',due_on:'Due date',reversed_on:'Reversed on',applied_on:'Applied on',payment_id:'Payment ID',due_id:'Obligation ID',active:'Active'};
  function auditValue(key,value) {if(value===null||value===undefined)return '—';if(key==='amount_paise')return money(value);if(key.endsWith('_json')){try{return JSON.parse(value).join(', ');}catch{}}return String(value);}
  async function history(kind,id) {
    $('#history-title').textContent='Change history';$('#history-content').textContent='Loading…';if(!$('#finance-history').open)$('#finance-history').showModal();
    try {
      const {history}=await api(`history?entityType=${kind}&id=${id}`);
      const ignored=new Set(['id','name_key','code_key','reference_key','created_at','created_by','updated_at','updated_by','version','reversed_at','reversed_by']);
      $('#history-content').innerHTML=history.map(h=>`<article class="history-item"><div><strong>${esc(h.action)} · ${esc(h.actor_name)}</strong><span>${esc(time(h.recorded_at))}</span></div><p>${esc(h.reason)}</p><dl class="audit-change">${Object.keys(h.after).filter(k=>!ignored.has(k)&&(!h.before||h.before[k]!==h.after[k])).map(k=>`<dt>${esc(fieldLabels[k]||k.replaceAll('_',' '))}</dt><dd>${h.before?`<del>${esc(auditValue(k,h.before[k]))}</del> → `:''}<ins>${esc(auditValue(k,h.after[k]))}</ins></dd>`).join('')}</dl></article>`).join('')||'<p>No history found.</p>';
    }catch(error){$('#history-content').textContent=error.message;}
  }
  document.addEventListener('click',async event=>{
    const close=event.target.closest('[data-finance-close]');if(close){close.closest('dialog').close();return;}
    const button=event.target.closest('[data-action]');if(!button||!state)return;
    const {action:act,kind,id}=button.dataset;button.disabled=true;
    try {
      if(act==='person')await showDetail('people',id);
      else if(act==='details')await showDetail(kind,id);
      else if(act==='history')await history(kind,id);
      else if(act==='edit')editRecord(kind,id);
      else if(act==='refund')editRecord('payments',null,id);
      else if(act==='apply')applicationEditor(kind,id);
      else if(act==='reverse')beginEditor('Reverse payment application','The original payment remains in the ledger. This reopens the amount due and releases the payment balance. Both the application and reversal stay in history.',notesField('reason','','Reason for reversal *',true),{action:'reverse',id});
    }catch(error){showError(error);}finally{button.disabled=false;}
  });
  function selectTab(next){tab=next;page=0;document.querySelectorAll('[data-tab]').forEach(b=>{const selected=b.dataset.tab===tab;b.classList.toggle('selected',selected);b.setAttribute('aria-selected',selected);b.tabIndex=selected?0:-1;});$('#record-panel').setAttribute('aria-labelledby','tab-'+tab);if(state)render();}
  document.querySelectorAll('[data-tab]').forEach(button=>{
    button.addEventListener('click',()=>selectTab(button.dataset.tab));
    button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=['people','payments','dues'];const i=event.key==='Home'?0:event.key==='End'?2:(tabs.indexOf(tab)+(event.key==='ArrowRight'?1:2))%3;selectTab(tabs[i]);$('#tab-'+tabs[i]).focus();});
  });
  $('#add-finance').addEventListener('click',()=>editRecord(tab));
  $('#finance-filters').addEventListener('submit',event=>{event.preventDefault();page=0;refresh().catch(showError);});
  $('#refresh-finance').addEventListener('click',()=>refresh().catch(showError));
  $('#reset-filters').addEventListener('click',()=>{$('#finance-filters').reset();fields.to.value=state.meta.today;page=0;refresh().catch(showError);});
  $('#include-upcoming').addEventListener('click',()=>{fields.to.value='9999-12-31';page=0;refresh().catch(showError);});
  $('#export-finance').addEventListener('click',()=>{const q=new URLSearchParams(appliedQuery);q.set('type',tab);const a=document.createElement('a');a.href='/api/finance/export?'+q;a.download=`ssr-${tab}.csv`;a.click();});
  window.SSR.ready.then(async()=>{
    if(window.SSR.user?.role!=='admin'){location.assign('/');return;}
    $('#finance-user').textContent=window.SSR.user.name;
    fields.to.value=new Date(Date.now()+330*60000).toISOString().slice(0,10);selectTab('people');await refresh();
  }).catch(showError);
})();
