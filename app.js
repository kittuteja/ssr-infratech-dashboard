'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = n => n.toLocaleString('en-IN', {maximumFractionDigits:2});
const money = n => '₹' + number(Math.round(n));
const compact = n => n >= 100000 ? '₹' + (n / 100000).toFixed(2) + ' L' : money(n);
const projects = ['Nakshatra','HM Grandeur','Sri Sai Bhageeratha Residency'];
let materials = [
 {id:1,name:'OPC 53 Grade Cement',category:'Structural',unit:'Bags',quantity:850,minimum:300,price:390,project:'Nakshatra'},
 {id:2,name:'TMT Steel · Fe 550',category:'Structural',unit:'Tonnes',quantity:4.5,minimum:8,price:58000,project:'Nakshatra'},
 {id:3,name:'AAC Blocks · 6 inch',category:'Masonry',unit:'Nos',quantity:2400,minimum:1000,price:68,project:'HM Grandeur'},
 {id:4,name:'River Sand',category:'Masonry',unit:'Cu ft',quantity:650,minimum:1000,price:55,project:'Nakshatra'},
 {id:5,name:'Copper Wire · 2.5 sq mm',category:'Electrical',unit:'Metres',quantity:1800,minimum:500,price:32,project:'HM Grandeur'},
 {id:6,name:'CPVC Pipe · 25 mm',category:'Plumbing',unit:'Metres',quantity:0,minimum:200,price:110,project:'Sri Sai Bhageeratha Residency'},
 {id:7,name:'Vitrified Tiles · 600 × 600',category:'Finishing',unit:'Sq ft',quantity:3200,minimum:800,price:65,project:'HM Grandeur'},
 {id:8,name:'Interior Wall Putty',category:'Finishing',unit:'Bags',quantity:180,minimum:80,price:780,project:'Sri Sai Bhageeratha Residency'}
];
let movements = [
 {id:1,materialId:1,type:'received',quantity:300,note:'Demo · DC-1024',time:'Sample entry'},
 {id:2,materialId:3,type:'issued',quantity:500,note:'Demo · First-floor masonry',time:'Sample entry'},
 {id:3,materialId:5,type:'received',quantity:800,note:'Demo · DC-1021',time:'Sample entry'}
];
let view='inventory', status='all', activeId=null, toastTimer;
const stockStatus = m => m.quantity===0 ? 'out' : m.quantity<=m.minimum ? 'low':'ok';
const statusName = s => ({out:'Out of stock',low:'Low stock',ok:'In stock'}[s]);
const projectMaterials = () => materials.filter(m => $('#project').value==='all'||m.project===$('#project').value);
function filteredMaterials(){const q=$('#search').value.trim().toLowerCase();return projectMaterials().filter(m=>(status==='all'||stockStatus(m)===status)&&($('#category').value==='all'||m.category===$('#category').value)&&`${m.name} MAT-${String(m.id).padStart(3,'0')} ${m.project}`.toLowerCase().includes(q));}
function filteredMovements(){const ids=new Set(projectMaterials().filter(m=>$('#category').value==='all'||m.category===$('#category').value).map(m=>m.id));const q=$('#search').value.trim().toLowerCase();return movements.filter(v=>{const m=materials.find(m=>m.id===v.materialId);return ids.has(v.materialId)&&`${m.name} ${v.note} ${m.project}`.toLowerCase().includes(q);});}
function render(){
 const list=projectMaterials(), low=list.filter(m=>stockStatus(m)==='low'),out=list.filter(m=>stockStatus(m)==='out');
 const total=list.reduce((n,m)=>n+m.price*m.quantity,0);
 const cards=[['Stock value',compact(total),'At current material unit costs','₹'],['Materials tracked',number(list.length),'Across '+new Set(list.map(m=>m.project)).size+' project sites','▦'],['Low-stock materials',number(low.length),'At or below reorder level','↘'],['Out of stock',number(out.length),out.length?'Restocking required':'All materials available','□']];
 $('#metrics').innerHTML=cards.map(([label,value,note,icon])=>`<article class="metric"><div class="metric-head">${label}<span class="metric-icon">${icon}</span></div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></article>`).join('');
 $('#page-title').textContent=view==='inventory'?'Material Management':'Stock Movements';$('#crumb').textContent=$('#page-title').textContent;
 $('.tabs').hidden=view!=='inventory';$('#table-title').innerHTML=(view==='inventory'?'Material inventory':'Movement register')+' <span id="count" class="count"></span>';
 $('#table-description').textContent=view==='inventory'?'A clear view of stock across your construction sites.':'Receipts and issues, with a reference for every update.';
 $('#low-count').textContent=low.length;
 document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
 if(view==='inventory'){
 const items=filteredMaterials();$('#count').textContent=items.length;
 $('#table-head').innerHTML='<tr><th>Material</th><th>Available</th><th>Stock value</th><th>Status</th><th>Action</th></tr>';
 $('#rows').innerHTML=items.map(m=>`<tr><td><div class="material-cell"><span class="material-icon" aria-hidden="true">${({Structural:'▤',Masonry:'▦',Electrical:'ϟ',Plumbing:'⊔',Finishing:'◇'})[m.category]}</span><div><strong>${esc(m.name)}</strong><small>MAT-${String(m.id).padStart(3,'0')} · ${esc(m.project)}</small></div></div></td><td><span class="quantity">${number(m.quantity)}</span> <span class="unit">${esc(m.unit)}</span><small>Min. ${number(m.minimum)}</small></td><td>${money(m.price*m.quantity)}</td><td><span class="badge ${stockStatus(m)}">${statusName(stockStatus(m))}</span></td><td><button class="row-action" data-stock="${m.id}" aria-label="Update stock for ${esc(m.name)}">Update</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">No materials match your filters. Try another search or add a material.</td></tr>';
 $('#results').textContent=`Showing ${items.length} of ${list.length} materials`;
 }else{
 const items=filteredMovements();$('#count').textContent=items.length;
 $('#table-head').innerHTML='<tr><th>Material / project</th><th>Movement</th><th>Quantity</th><th>Reference</th><th>Recorded</th></tr>';
 $('#rows').innerHTML=items.map(v=>{const m=materials.find(m=>m.id===v.materialId);return `<tr><td><strong>${esc(m.name)}</strong><small>${esc(m.project)}</small></td><td><span class="badge ${v.type==='received'?'ok':'low'}">${v.type==='received'?'Received':'Issued'}</span></td><td>${number(v.quantity)} ${esc(m.unit)}</td><td>${esc(v.note)}</td><td>${esc(v.time)}</td></tr>`;}).join('')||'<tr><td colspan="5" class="empty">No movements match your filters.</td></tr>';
 $('#results').textContent=`Showing ${items.length} movements`;
 }
 const alerts=[...out,...low];$('#alert-count').textContent=alerts.length;
 $('#alerts').innerHTML=alerts.map(m=>`<div class="alert-item"><strong>${esc(m.name)}</strong><small>${esc(m.project)}</small><div class="alert-line"><span>${number(m.quantity)} ${esc(m.unit)} remaining</span><button data-stock="${m.id}">Update stock</button></div></div>`).join('')||'<p class="empty">All materials are above their reorder levels.</p>';
 const ids=new Set(list.map(m=>m.id));$('#activity').innerHTML=movements.filter(v=>ids.has(v.materialId)).slice(0,3).map(v=>{const m=materials.find(m=>m.id===v.materialId);return `<div class="activity-item"><span class="movement-icon ${v.type}">${v.type==='received'?'↓':'↑'}</span><div><strong>${esc(m.name)}</strong><p>${v.type==='received'?'+':'−'}${number(v.quantity)} ${esc(m.unit)} · ${esc(m.project)}</p><small>${esc(v.time)}</small></div></div>`;}).join('')||'<p class="empty">No stock movements yet.</p>';
 $('#project-bars').innerHTML=projects.filter(p=>$('#project').value==='all'||$('#project').value===p).map(p=>{const value=list.filter(m=>m.project===p).reduce((n,m)=>n+m.price*m.quantity,0);return `<div class="project-bar"><span>${esc(p)}</span><div class="bar-track" role="img" aria-label="${esc(p)}: ${money(value)}"><div class="bar-fill" style="width:${total?100*value/total:0}%"></div></div><b>${compact(value)}</b></div>`;}).join('');
}
function showToast(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').style.display='block';toastTimer=setTimeout(()=>$('#toast').style.display='none',4000);}
function setView(next){view=next;$('#search').value='';status='all';document.querySelectorAll('[data-status]').forEach(b=>{b.classList.toggle('selected',b.dataset.status==='all');b.setAttribute('aria-selected',String(b.dataset.status==='all'));});render();}
function openStock(id){activeId=id;const m=materials.find(m=>m.id===id);$('#stock-form').reset();$('#stock-error').textContent='';$('#stock-material').textContent=`${m.name} · ${m.project} · Available: ${number(m.quantity)} ${m.unit}`;$('#stock-dialog').showModal();}
document.addEventListener('click',e=>{const stock=e.target.closest('[data-stock]');if(stock)openStock(Number(stock.dataset.stock));const nav=e.target.closest('[data-view]');if(nav)setView(nav.dataset.view);const tab=e.target.closest('[data-status]');if(tab){status=tab.dataset.status;document.querySelectorAll('[data-status]').forEach(b=>{b.classList.toggle('selected',b===tab);b.setAttribute('aria-selected',String(b===tab));});render();}if(e.target.closest('.close-dialog'))e.target.closest('dialog').close();});
$('#project').addEventListener('change',render);$('#category').addEventListener('change',render);$('#search').addEventListener('input',render);
$('#add').onclick=()=>{$('#material-form').reset();if($('#project').value!=='all')$('#material-form').elements.project.value=$('#project').value;$('#material-dialog').showModal();};
$('#view-movements').onclick=()=>setView('movements');
$('#material-form').onsubmit=e=>{e.preventDefault();const form=e.currentTarget,data=Object.fromEntries(new FormData(form));data.name=data.name.trim();if(!data.name){form.elements.name.setCustomValidity('Enter a material name.');form.elements.name.reportValidity();return;}const m={id:Math.max(...materials.map(m=>m.id),0)+1,name:data.name,category:data.category,unit:data.unit,project:data.project,quantity:Number(data.quantity),minimum:Number(data.minimum),price:Number(data.price)};materials.push(m);if(m.quantity)movements.unshift({id:Date.now(),materialId:m.id,type:'received',quantity:m.quantity,note:'Opening stock',time:new Date().toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})});$('#material-dialog').close();$('#project').value=m.project;$('#category').value='all';setView('inventory');showToast('Material added to '+m.project);};
$('#material-form').elements.name.oninput=e=>e.target.setCustomValidity('');
$('#stock-form').onsubmit=e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget)),quantity=Number(data.quantity),m=materials.find(m=>m.id===activeId);if(!data.note.trim()){ $('#stock-error').textContent='Enter a reference or note.';return;}if(data.type==='issued'&&quantity>m.quantity){$('#stock-error').textContent=`Only ${number(m.quantity)} ${m.unit} available. Enter a smaller quantity.`;return;}m.quantity=Math.round((m.quantity+(data.type==='received'?quantity:-quantity))*100)/100;movements.unshift({id:Date.now(),materialId:m.id,type:data.type,quantity,note:data.note.trim(),time:new Date().toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})});$('#stock-dialog').close();render();showToast('Stock updated · '+number(m.quantity)+' '+m.unit+' available');};
$('#export').onclick=()=>{const data=view==='inventory'?[['Code','Material','Category','Project','Available','Unit','Reorder level','Unit cost INR','Stock value INR','Status'],...filteredMaterials().map(m=>['MAT-'+String(m.id).padStart(3,'0'),m.name,m.category,m.project,m.quantity,m.unit,m.minimum,m.price,m.quantity*m.price,statusName(stockStatus(m))])]:[['Material','Project','Type','Quantity','Unit','Reference','Recorded'],...filteredMovements().map(v=>{const m=materials.find(m=>m.id===v.materialId);return[m.name,m.project,v.type,v.quantity,m.unit,v.note,v.time];})];const csv=data.map(row=>row.map(value=>{let s=String(value);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`SSR-${view}-demo.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('Filtered '+view+' exported');};
render();
