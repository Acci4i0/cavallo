const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true });
  for (const vp of [{w:1440,h:900,dpr:2,n:'desktop'},{w:390,h:844,dpr:3,n:'iPhone'}]) {
    const p = await (await b.newContext({viewport:{width:vp.w,height:vp.h},deviceScaleFactor:vp.dpr,
      isMobile:vp.n==='iPhone',hasTouch:vp.n==='iPhone'})).newPage();
    const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
    const bad=[]; p.on('response',r=>{if(r.status()>=400) bad.push(r.status()+' '+r.url().split('/').pop());});
    await p.goto('http://localhost:4174/',{waitUntil:'networkidle'});
    await p.waitForTimeout(1800);
    const f0=await p.evaluate(()=>window.__replica.frame);
    for(let i=0;i<8;i++){ await p.mouse.move(vp.w/2,vp.h/2); await p.mouse.wheel(0,-90); await p.waitForTimeout(60); }
    const st=await p.evaluate(()=>{
      const cs=[...document.querySelectorAll('.cell:not([hidden])')];
      const imgs=new Set(cs.map(c=>getComputedStyle(c).backgroundImage));
      return {frame:window.__replica.frame, celle:cs.length, immaginiDistinte:imgs.size,
              url:[...imgs][0].replace(/^url\("?|"?\)$/g,'').split('/').slice(-2).join('/'),
              scala:+window.__replica.scale.toFixed(2), testo:document.body.innerText.trim().length};
    });
    console.log(vp.n.padEnd(8), JSON.stringify(st), `| galoppo ${f0}->${st.frame} ${f0!==st.frame?'OK':'FERMO'}`);
    if(bad.length) console.log('         404:',bad);
    if(errs.length) console.log('         ERR:',errs);
    if(vp.n==='desktop') await p.screenshot({path:'research/raw/mask/single-photo.png'});
    await p.close();
  }
  await b.close();
})();
