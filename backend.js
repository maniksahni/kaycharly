// The site lives at https://kaycharly.fr. Any other address that still shows these pages (old links in emails and
// bookmarks: GitHub Pages, Cloudflare Pages, www, workers.dev, plain http) sends the visitor there, keeping the page,
// its query (avis / désinscription tokens) and #hash. The printer's Bluetooth/USB only works on https.
(function(){var h=location.hostname;if(h==='maniksahni.github.io'||h==='www.kaycharly.fr'||(h==='kaycharly.fr'&&location.protocol==='http:')||/(^|\.)kaycharly\.pages\.dev$|\.workers\.dev$/.test(h)){location.replace('https://kaycharly.fr'+location.pathname.replace(/^\/kaycharly(\/|$)/,'/')+location.search+location.hash);}})();
// API: served by the same site (Cloudflare Worker, worker/index.js).
window.KC={url:''};
KC.api=async function(path,{token,method='GET',body,headers={}}={}){const r=await fetch(KC.url+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});const data=await r.json().catch(()=>null);if(!r.ok)throw Error(data?.message||data?.msg||data?.error_description||'Connexion impossible');return data};
