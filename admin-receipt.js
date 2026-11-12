'use strict';
// Printable receipt for one order (opened from the owner email link admin.html#imprimer=KC-…, or the order card button).
// Laid out for 62 mm roll paper (Brother QL-700); also prints fine on A4/80 mm.
(()=>{const W=28,eur=c=>(Number(c)/100).toFixed(2).replace('.',',')+' €',h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const wrap=(t,w)=>{const out=[];let l='';for(const x of String(t??'').split(/\s+/)){if(!x)continue;for(let p=x;p;p=p.slice(w)){const s=p.slice(0,w);if(l&&(l+' '+s).length>w){out.push(l);l=s}else l=l?l+' '+s:s}}if(l)out.push(l);return out.length?out:['']};
function lines(o){const L=[],add=(t,cls='')=>L.push([t,cls]),rule=()=>add('-'.repeat(W),'r'),delivery=/livraison/i.test(o.pickup||''),pair=(a,b,cls)=>wrap(a,W-b.length-1).forEach((r,k)=>add(k?r:r.padEnd(W-b.length)+b,k?'':cls));
add('KAY CHARLY','c big');add('Cuisine créole · Champcueil','c');add('19 rue de la Marivoise','c');add('07 60 62 95 72','c');rule();
add(delivery?'LIVRAISON':'À EMPORTER','c mid');add('Reçu '+o.reference,'c b');add(new Date(o.created_at).toLocaleString('fr-FR',{timeZone:'Europe/Paris',dateStyle:'short',timeStyle:'short'}),'c');rule();
wrap('Client : '+(o.customer_name||''),W).forEach(x=>add(x,'b'));if(o.phone)add('Tél : '+o.phone);if(delivery&&o.address)wrap('Adresse : '+o.address,W).forEach(x=>add(x));
wrap(o.pickup||'',W).forEach(x=>add(x));rule();
for(const i of o.items||[])pair(i.quantity+' x '+i.name,eur(i.price*i.quantity),'b');rule();pair('TOTAL',eur(o.total),'b');add('À régler en espèces','c');add('à la remise','c');
if(o.note){rule();add('REMARQUE','b');wrap(o.note,W).forEach(x=>add(x,'b'))}rule();add('Merci et à bientôt !','c');return L}
let box;function view(){if(box)return box;box=document.createElement('div');box.id='receiptView';box.hidden=true;box.innerHTML='<div class="rv-bar"><button type="button" id="rvPrint">🖨️ Imprimer le reçu</button><button type="button" class="secondary" id="rvClose">Fermer</button></div><div class="rv-paper" id="rvPaper"></div>';document.body.append(box);
box.querySelector('#rvPrint').onclick=()=>window.print();box.querySelector('#rvClose').onclick=close;return box}
function close(){if(box)box.hidden=true;document.body.classList.remove('rv-open');if(location.hash.startsWith('#imprimer='))history.replaceState(null,'',location.pathname+location.search)}
window.KCReceipt={show(o,autoPrint){const v=view();v.querySelector('#rvPaper').innerHTML=lines(o).map(([t,c])=>`<div class="${c}">${h(t)}</div>`).join('');v.hidden=false;document.body.classList.add('rv-open');window.scrollTo(0,0);if(autoPrint)setTimeout(()=>window.print(),400)},
fromHash(orders){const m=location.hash.match(/^#imprimer=(KC-[A-F0-9]{10})$/);if(!m)return false;const o=orders.find(x=>x.reference===m[1]);if(!o)return false;this.show(o,true);return true},close}})();
