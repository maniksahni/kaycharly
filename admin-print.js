'use strict';
// Prints each new order automatically while the admin stays open.
window.KCP=(()=>{
const CFG='kc-printer',DONE='kc-printed',MAX_AGE=12*3600*1000,el=id=>document.getElementById(id);
let cfg={},device=null,endpoint=0,needBaseline=false;
try{cfg=JSON.parse(localStorage.getItem(CFG)||'{}')||{}}catch{}
const saveCfg=()=>{try{localStorage.setItem(CFG,JSON.stringify(cfg))}catch{}};
const readDone=()=>{try{return new Set(JSON.parse(localStorage.getItem(DONE)||'[]'))}catch{return new Set()}};
const saveDone=s=>{try{localStorage.setItem(DONE,JSON.stringify([...s].slice(-1000)))}catch{}};
const active=()=>cfg.mode==='browser'||(cfg.mode==='usb'&&!!device);
function show(state,text){const bar=el('printerBar');bar.dataset.state=state;el('printerState').textContent=text;el('printerSetup').hidden=active();el('printerConnected').hidden=!active()}
function refresh(){if(cfg.mode==='browser')show('on','Imprimante de l’ordinateur activée. Les nouvelles commandes partent à l’impression.');else if(device)show('on','Imprimante connectée. Les nouvelles commandes s’impriment automatiquement.');else show('off',cfg.mode==='usb'?'Imprimante débranchée. Rebranchez-la ou reconnectez-la.':'Connectez votre imprimante pour imprimer les commandes automatiquement.')}

// Menu names that need their section to be clear on a kitchen ticket.
const KITCHEN={am:'Accras morue',ac:'Accras crevette','s-poulet':'Sandwich poulet simple','s-jambon':'Sandwich jambon emmental','s-crudites':'Sandwich crudites'};
// Ticket as neutral lines, rendered for either kind of printer.
const money=n=>(n/100).toFixed(2).replace('.',',')+' €';
function ticket(o,items=o.items){const delivery=/livraison/i.test(o.pickup),time=new Date(o.created_at).toLocaleString('fr-FR',{timeZone:'Europe/Paris',dateStyle:'short',timeStyle:'short'}),L=[{t:'KAY CHARLY',big:1,center:1},{t:delivery?'LIVRAISON':'A EMPORTER',big:1,center:1,bold:1},{t:o.reference,center:1,bold:1},{t:time,center:1},{rule:1},{t:o.customer_name,bold:1},{t:o.phone}];
if(o.address)L.push({t:o.address});L.push({t:o.pickup},{rule:1});for(const i of items)L.push({left:`${i.quantity} x ${KITCHEN[i.id]||i.name}`,right:money(i.price*i.quantity),bold:1});L.push({rule:1},{left:'TOTAL',right:money(o.total),big:1,bold:1},{t:'Especes a la remise',center:1});if(o.note)L.push({rule:1},{t:'REMARQUE : '+o.note,bold:1});return L}
const wrap=(t,w)=>{const out=[];let line='';for(const word of String(t).split(/\s+/)){for(let part=word;part;part=part.slice(w)){const p=part.slice(0,w);if(line&&(line+' '+p).length>w){out.push(line);line=p}else line=line?line+' '+p:p}}if(line)out.push(line);return out.length?out:['']};
function encode(t){const b=[];for(const c of t.normalize('NFC').replace(/[’‘]/g,"'").replace(/[“”]/g,'"').replace(/[–—]/g,'-')){const u=c.codePointAt(0);b.push(c==='€'?0x80:c==='œ'?0x9c:c==='Œ'?0x8c:u<256?u:63)}return b}
function escpos(lines,width){const out=[0x1b,0x40,0x1b,0x74,16];const put=a=>out.push(...a);for(const l of lines){const cols=l.big?Math.floor(width/2):width;put([0x1b,0x61,l.center?1:0,0x1b,0x45,l.bold?1:0,0x1d,0x21,l.big?0x11:0]);if(l.rule){put(encode('-'.repeat(width)+'\n'));continue}if('left' in l){const parts=wrap(l.left,cols-l.right.length-1);parts.forEach((p,i)=>put(encode((i?p:p.padEnd(cols-l.right.length)+l.right)+'\n')));continue}for(const p of wrap(l.t,cols))put(encode(p+'\n'))}put([0x1b,0x45,0,0x1d,0x21,0,0x1b,0x64,4,0x1d,0x56,66,0]);return new Uint8Array(out)}
const esc2=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function html(lines){return `<!doctype html><meta charset="utf-8"><style>@page{size:80mm auto;margin:3mm}body{font:14px/1.35 monospace;margin:0;color:#000}.c{text-align:center}.b{font-weight:700}.g{font-size:20px}.r{display:flex;justify-content:space-between;gap:10px}hr{border:0;border-top:1px dashed #000}p{margin:2px 0;overflow-wrap:anywhere}</style>${lines.map(l=>l.rule?'<hr>':`<p class="${l.center?'c ':''}${l.bold?'b ':''}${l.big?'g':''}${'left' in l?' r':''}">${'left' in l?`<span>${esc2(l.left)}</span><span>${esc2(l.right)}</span>`:esc2(l.t)}</p>`).join('')}`}

function viaBrowser(lines){return new Promise(resolve=>{const f=document.createElement('iframe');f.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0';f.srcdoc=html(lines);let done=false;const end=()=>{if(done)return;done=true;setTimeout(()=>f.remove(),500);resolve()};f.onload=()=>{f.contentWindow.onafterprint=end;f.contentWindow.focus();f.contentWindow.print();setTimeout(end,3000)};document.body.append(f)})}
async function viaUsb(lines){const data=escpos(lines,cfg.width||48);for(let i=0;i<data.length;i+=4096)await device.transferOut(endpoint,data.slice(i,i+4096))}
const send=lines=>cfg.mode==='usb'?viaUsb(lines):viaBrowser(lines);

async function attach(d){await d.open();if(!d.configuration)await d.selectConfiguration(1);const ifaces=d.configuration.interfaces,pick=a=>a.alternates[0].endpoints.find(e=>e.direction==='out'&&e.type==='bulk'),iface=ifaces.find(a=>a.alternates[0].interfaceClass===7&&pick(a))||ifaces.find(pick);if(!iface)throw Error('Cet appareil n’est pas une imprimante compatible.');await d.claimInterface(iface.interfaceNumber);endpoint=pick(iface).endpointNumber;device=d}
async function reconnect(){if(cfg.mode!=='usb'||!navigator.usb)return;const list=await navigator.usb.getDevices(),d=list.find(x=>x.vendorId===cfg.vendorId&&x.productId===cfg.productId);if(d)try{await attach(d)}catch{device=null}refresh();if(device)load()}
function keepAwake(){if(active()&&document.visibilityState==='visible')navigator.wakeLock?.request('screen').catch(()=>{})}
function enabled(){needBaseline=true;refresh();keepAwake();load();sync(orders)}
async function connectUsb(){if(!navigator.usb){show('err','Cette connexion directe fonctionne avec Chrome ou Edge.');return}try{cfg.width=Number(el('printerPaper').value);const d=await navigator.usb.requestDevice({filters:[]});await attach(d);cfg.mode='usb';cfg.vendorId=d.vendorId;cfg.productId=d.productId;saveCfg();enabled()}catch(e){if(e.name!=='NotFoundError')show('err','Connexion impossible : '+e.message+' Essayez l’imprimante de l’ordinateur.')}}
function useBrowser(){cfg={mode:'browser',width:48};saveCfg();enabled()}
async function disconnect(){try{await device?.close()}catch{}device=null;cfg={};saveCfg();refresh()}

async function run(){const done=readDone();if(needBaseline){orders.forEach(o=>done.add(o.id));saveDone(done);needBaseline=false;return}const now=Date.now(),todo=orders.filter(o=>o.status==='Nouvelle'&&!done.has(o.id)&&now-new Date(o.created_at)<MAX_AGE).reverse();for(const o of todo){try{await send(ticket(o));done.add(o.id);saveDone(done);refresh()}catch(e){show('err','Impression impossible : '+e.message+' La commande sera réessayée.');return}}}
let running=false;
async function sync(){if(!active()||running)return;running=true;try{if(navigator.locks)await navigator.locks.request('kc-print',{ifAvailable:true},l=>l?run():null);else await run()}finally{running=false}}
async function printOne(id){const o=orders.find(x=>x.id===id);if(!o)return;if(!active()){show('err','Connectez d’abord une imprimante.');return}try{await send(ticket(o));const done=readDone();done.add(o.id);saveDone(done);refresh()}catch(e){show('err','Impression impossible : '+e.message)}}
async function test(){if(!active())return;try{await send([{t:'KAY CHARLY',big:1,center:1},{t:'Test imprimante',center:1,bold:1},{rule:1},{left:'1 x Exemple à l’unité',right:money(950)},{rule:1},{t:'Si vous lisez ce ticket, c’est bon.',center:1}]);refresh()}catch(e){show('err','Test impossible : '+e.message)}}

el('printerUsb').onclick=connectUsb;el('printerBrowser').onclick=useBrowser;el('printerTest').onclick=test;el('printerOff').onclick=disconnect;
el('orderList').addEventListener('click',e=>{const id=e.target.dataset.print;if(id)printOne(id)});
document.addEventListener('visibilitychange',keepAwake);
if(navigator.usb){navigator.usb.addEventListener('disconnect',e=>{if(e.device===device){device=null;refresh()}});navigator.usb.addEventListener('connect',()=>reconnect())}
refresh();reconnect();keepAwake();
return{sync,on:active,_ticket:ticket,_escpos:escpos};
})();
