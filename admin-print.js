'use strict';
// Prints each new order automatically on a Brother QL label printer while the admin stays open.
window.KCP=(()=>{
const CFG='kc-printer',DONE='kc-printed',MAX_AGE=12*3600*1000,BROTHER=0x04f9,el=id=>document.getElementById(id),sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Continuous rolls: printable dots and right margin, in the printer's own 720-dot row.
const ROLLS={29:[306,6],38:[413,12],50:[554,12],54:[590,0],62:[696,12]};
let cfg={},device=null,epOut=0,epIn=0,pendingIn=null,needBaseline=false;
try{cfg=JSON.parse(localStorage.getItem(CFG)||'{}')||{}}catch{}
const saveCfg=()=>{try{localStorage.setItem(CFG,JSON.stringify(cfg))}catch{}};
const readDone=()=>{try{return new Set(JSON.parse(localStorage.getItem(DONE)||'[]'))}catch{return new Set()}};
const saveDone=s=>{try{localStorage.setItem(DONE,JSON.stringify([...s].slice(-1000)))}catch{}};
const active=()=>cfg.mode==='browser'||(cfg.mode==='usb'&&!!device);
function show(state,text){const bar=el('printerBar');bar.dataset.state=state;el('printerState').textContent=text;el('printerSetup').hidden=active();el('printerConnected').hidden=!active()}
function refresh(){if(cfg.mode==='browser')show('on','Imprimante de l’ordinateur activée. Les nouvelles commandes partent à l’impression.');else if(device)show('on','Imprimante connectée. Les nouvelles commandes s’impriment automatiquement.');else show('off',cfg.mode==='usb'?'Imprimante débranchée. Rebranchez-la ou reconnectez-la.':'Connectez votre imprimante pour imprimer les commandes automatiquement.')}

// Ticket as neutral lines, drawn the same way for the preview and the printer.
const money=n=>(n/100).toFixed(2).replace('.',',')+' €';
const KITCHEN={am:'Accras morue',ac:'Accras crevette','s-poulet':'Sandwich poulet simple','s-jambon':'Sandwich jambon emmental','s-crudites':'Sandwich crudités'};
function ticket(o){const delivery=/livraison/i.test(o.pickup),time=new Date(o.created_at).toLocaleString('fr-FR',{timeZone:'Europe/Paris',dateStyle:'short',timeStyle:'short'}),L=[{t:'KAY CHARLY',size:'title',center:1},{t:delivery?'LIVRAISON':'À EMPORTER',size:'big',center:1,invert:1},{t:o.reference,center:1,bold:1},{t:time,center:1},{rule:1},{t:o.customer_name,size:'big',bold:1},{t:o.phone,bold:1}];
if(o.address)L.push({t:o.address,bold:delivery});L.push({t:delivery?'Livraison entre 10h et 11h30':'Retrait en boutique'},{rule:1});for(const i of o.items)L.push({left:`${i.quantity} x ${KITCHEN[i.id]||i.name}`,right:money(i.price*i.quantity),bold:1});L.push({rule:1},{left:'TOTAL',right:money(o.total),size:'big',bold:1},{t:'À régler en espèces à la remise',center:1});if(o.note)L.push({rule:1},{t:'REMARQUE',bold:1},{t:o.note,size:'big',bold:1});return L}
const SAMPLE={created_at:new Date().toISOString(),reference:'KC-EXEMPLE00',customer_name:'Marie Dupont',phone:'06 12 34 56 78',address:'12 rue de la Gare, 91540 Mennecy',pickup:'Livraison',total:3350,note:'Sans piment, merci',items:[{id:'flyer-menu-viande',name:'Menu viande',quantity:1,price:1400},{id:'am',name:'Morue',quantity:1,price:1000},{id:'5451431a',name:'Royal Soda Ananas',quantity:2,price:250},{id:'pf',name:'Poulet-frites',quantity:1,price:750}]};
function draw(lines,W){const S=W/696,sizes={title:64*S,big:44*S,normal:32*S},pad=10*S,c=document.createElement('canvas'),x=c.getContext('2d');const font=l=>`${l.bold||l.invert||l.size==='title'?'700':'400'} ${sizes[l.size||'normal']}px Arial,Helvetica,sans-serif`;
const wrap=(t,w)=>{const out=[];let line='';for(const word of String(t).split(/\s+/)){const next=line?line+' '+word:word;if(line&&x.measureText(next).width>w){out.push(line);line=word}else line=next}if(line)out.push(line);return out.length?out:['']};
const pass=render=>{let y=14*S;for(const l of lines){if(l.rule){y+=12*S;if(render)x.fillRect(pad,y,W-2*pad,3*S);y+=16*S;continue}x.font=font(l);const h=sizes[l.size||'normal']*1.3;if('left' in l){const pw=x.measureText(l.right).width,rows=wrap(l.left,W-2*pad-pw-24*S);rows.forEach((r,i)=>{if(render){x.textAlign='left';x.fillText(r,pad,y+h*.8);if(!i){x.textAlign='right';x.fillText(l.right,W-pad,y+h*.8)}}y+=h});y+=6*S;continue}const rows=wrap(l.t,W-2*pad-(l.invert?40*S:0));for(const r of rows){if(l.invert&&render){x.fillRect(pad,y,W-2*pad,h+8*S);x.fillStyle='#fff'}if(render){x.textAlign=l.center?'center':'left';x.fillText(r,l.center?W/2:pad,y+h*.8+(l.invert?4*S:0));x.fillStyle='#000'}y+=h+(l.invert?14*S:0)}y+=2*S}return Math.ceil(y+20*S)};
c.width=W;c.height=10;x.textBaseline='alphabetic';const H=pass(false);c.height=H;x.fillStyle='#fff';x.fillRect(0,0,W,H);x.fillStyle='#000';pass(true);return c}

// Brother raster protocol: 90 bytes per row, mirrored, one bit per dot.
function raster(canvas,mm){const [W,margin]=ROLLS[mm],h=canvas.height,img=canvas.getContext('2d').getImageData(0,0,W,h).data,start=720-W-margin,head=[...new Array(200).fill(0),0x1b,0x40,0x1b,0x69,0x7a,0xce,0x0a,mm,0,h&255,h>>8&255,h>>16&255,h>>>24,0,0,0x1b,0x69,0x4d,0x40,0x1b,0x69,0x41,1,0x1b,0x69,0x4b,0x08,0x1b,0x69,0x64,35,0];
const out=new Uint8Array(head.length+h*93+1);out.set(head);let p=head.length;for(let y=0;y<h;y++){out.set([0x67,0,90],p);p+=3;for(let x=0;x<W;x++){const i=(y*W+x)*4;if(img[i]<128){const bit=719-(start+x);out[p+(bit>>3)]|=0x80>>(bit&7)}}p+=90}out[p]=0x1a;return out}
async function write(data){for(let i=0;i<data.length;i+=4096)await device.transferOut(epOut,data.slice(i,i+4096))}
async function status(){await write(new Uint8Array([...new Array(200).fill(0),0x1b,0x40,0x1b,0x69,0x53]));const end=Date.now()+2500;while(Date.now()<end){pendingIn=pendingIn||device.transferIn(epIn,32);const r=await Promise.race([pendingIn,sleep(300).then(()=>null)]);if(!r)continue;pendingIn=null;if(r.data&&r.data.byteLength>=32){const b=new Uint8Array(r.data.buffer,r.data.byteOffset,32);if(b[18]===0)return b}else await sleep(100)}return null}
function checkStatus(b){if(!b)return;if(b[8]&1||b[9]&1)throw Error('Aucun rouleau détecté.');if(b[8]&2)throw Error('Rouleau terminé.');if(b[8]&4)throw Error('Massicot bloqué.');if(b[9]&0x10)throw Error('Capot ouvert.');if(b[8]||b[9])throw Error('Imprimante en erreur.');if(b[11]===0x0b)throw Error('Installez un rouleau continu (DK-22205, 62 mm).');if(!ROLLS[b[10]])throw Error('Largeur de rouleau non prise en charge.');if(cfg.mm!==b[10]){cfg.mm=b[10];saveCfg()}}
async function viaUsb(lines){checkStatus(await status());const mm=cfg.mm||62;await write(raster(draw(lines,ROLLS[mm][0]),mm));await sleep(1500)}
const esc2=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function html(lines){return `<!doctype html><meta charset="utf-8"><style>@page{margin:2mm}body{font:13px/1.3 Arial,sans-serif;margin:0;width:58mm;color:#000}.c{text-align:center}.b{font-weight:700}.g{font-size:18px}.t{font-size:26px;font-weight:700}.r{display:flex;justify-content:space-between;gap:10px}hr{border:0;border-top:1px solid #000}p{margin:2px 0;overflow-wrap:anywhere}.i{background:#000;color:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact}</style>${lines.map(l=>l.rule?'<hr>':`<p class="${l.center?'c ':''}${l.bold?'b ':''}${l.size==='big'?'g ':''}${l.size==='title'?'t ':''}${l.invert?'i ':''}${'left' in l?'r':''}">${'left' in l?`<span>${esc2(l.left)}</span><span>${esc2(l.right)}</span>`:esc2(l.t)}</p>`).join('')}`}
function viaBrowser(lines){return new Promise(resolve=>{const f=document.createElement('iframe');f.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0';f.srcdoc=html(lines);let done=false;const end=()=>{if(done)return;done=true;setTimeout(()=>f.remove(),500);resolve()};f.onload=()=>{f.contentWindow.onafterprint=end;f.contentWindow.focus();f.contentWindow.print();setTimeout(end,3000)};document.body.append(f)})}
const send=lines=>cfg.mode==='usb'?viaUsb(lines):viaBrowser(lines);

async function attach(d){await d.open();if(!d.configuration)await d.selectConfiguration(1);const a=d.configuration.interfaces.find(i=>i.alternates[0].endpoints.some(e=>e.direction==='out'&&e.type==='bulk'));if(!a)throw Error('Désactivez le mode Editor Lite (voyant vert éteint).');const eps=a.alternates[0].endpoints;await d.claimInterface(a.interfaceNumber);epOut=eps.find(e=>e.direction==='out'&&e.type==='bulk').endpointNumber;epIn=(eps.find(e=>e.direction==='in'&&e.type==='bulk')||{}).endpointNumber;device=d;pendingIn=null}
async function reconnect(){if(cfg.mode!=='usb'||!navigator.usb)return;const list=await navigator.usb.getDevices(),d=list.find(x=>x.vendorId===cfg.vendorId&&x.productId===cfg.productId);if(d)try{await attach(d)}catch{device=null}refresh();if(device)load()}
function keepAwake(){if(active()&&document.visibilityState==='visible')navigator.wakeLock?.request('screen').catch(()=>{})}
function enabled(){needBaseline=true;refresh();keepAwake();load();sync()}
async function connectUsb(){if(!navigator.usb){show('err','Cette connexion directe fonctionne avec Chrome ou Edge.');return}try{const d=await navigator.usb.requestDevice({filters:[{vendorId:BROTHER}]});await attach(d);cfg={mode:'usb',vendorId:d.vendorId,productId:d.productId,mm:62};saveCfg();try{checkStatus(await status())}catch(e){show('err',e.message);needBaseline=true;load();return}enabled()}catch(e){if(e.name!=='NotFoundError')show('err','Connexion impossible : '+e.message+' Essayez l’imprimante de l’ordinateur.')}}
function useBrowser(){cfg={mode:'browser'};saveCfg();enabled()}
async function disconnect(){try{await device?.close()}catch{}device=null;cfg={};saveCfg();refresh()}

async function run(){const done=readDone();if(needBaseline){orders.forEach(o=>done.add(o.id));saveDone(done);needBaseline=false;return}const now=Date.now(),todo=orders.filter(o=>o.status==='Nouvelle'&&!done.has(o.id)&&now-new Date(o.created_at)<MAX_AGE).reverse();for(const o of todo){try{await send(ticket(o));done.add(o.id);saveDone(done);refresh()}catch(e){show('err','Impression impossible : '+e.message+' La commande sera réessayée.');return}}}
let running=false;
async function sync(){if(!active()||running)return;running=true;try{if(navigator.locks)await navigator.locks.request('kc-print',{ifAvailable:true},l=>l?run():null);else await run()}finally{running=false}}
async function printOne(id){const o=orders.find(x=>x.id===id);if(!o)return;if(!active()){show('err','Connectez d’abord une imprimante.');return}try{await send(ticket(o));const done=readDone();done.add(o.id);saveDone(done);refresh()}catch(e){show('err','Impression impossible : '+e.message)}}
async function test(){if(!active())return;try{await send(ticket(SAMPLE));refresh()}catch(e){show('err','Test impossible : '+e.message)}}
function preview(){const box=el('printerPreviewBox');box.replaceChildren(draw(ticket(SAMPLE),ROLLS[cfg.mm||62][0]));el('printerPreview').showModal()}

el('printerUsb').onclick=connectUsb;el('printerBrowser').onclick=useBrowser;el('printerTest').onclick=test;el('printerOff').onclick=disconnect;el('printerShow').onclick=preview;el('printerClose').onclick=()=>el('printerPreview').close();
el('orderList').addEventListener('click',e=>{const id=e.target.dataset.print;if(id)printOne(id)});
document.addEventListener('visibilitychange',keepAwake);
if(navigator.usb){navigator.usb.addEventListener('disconnect',e=>{if(e.device===device){device=null;pendingIn=null;refresh()}});navigator.usb.addEventListener('connect',()=>reconnect())}
refresh();reconnect();keepAwake();
return{sync,on:active,_ticket:ticket,_raster:raster,_draw:draw};
})();
