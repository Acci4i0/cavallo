// FASE 0 — Recon. Carica la home, registra tutta la rete, salva HTML e asset list.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'raw');
const SITE = 'https://jinleeoffice.com/';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = {};

  for (const [name, vp] of Object.entries({
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844 },
  })) {
    const ctx = await browser.newContext({
      viewport: vp,
      deviceScaleFactor: 2,
      isMobile: name === 'mobile',
      hasTouch: name === 'mobile',
      userAgent: name === 'mobile'
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : undefined,
    });
    const page = await ctx.newPage();
    const net = [];
    const t0 = Date.now();

    page.on('response', async (res) => {
      const req = res.request();
      let len = null;
      try { len = (await res.body()).length; } catch { /* opaque */ }
      net.push({
        t: Date.now() - t0,
        method: req.method(),
        status: res.status(),
        type: req.resourceType(),
        url: res.url(),
        mime: res.headers()['content-type'] || null,
        bytes: len,
      });
    });

    await page.goto(SITE, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(4000);

    const info = await page.evaluate(() => {
      const g = Object.keys(window);
      const scripts = [...document.querySelectorAll('script')].map(s => ({
        src: s.src || null, type: s.type || null, id: s.id || null,
        inlineLen: s.src ? 0 : (s.textContent || '').length,
      }));
      const styles = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href);
      const imgs = [...document.querySelectorAll('img')].slice(0, 12).map(i => ({
        src: i.currentSrc || i.src, srcset: i.srcset || null, sizes: i.sizes || null,
        loading: i.loading, w: i.naturalWidth, h: i.naturalHeight,
        cls: i.className, style: i.getAttribute('style'),
      }));
      const fonts = [...document.fonts].map(f => ({
        family: f.family, weight: f.weight, style: f.style, status: f.status,
      }));
      // marker di framework/librerie note (solo presenza, non contenuto)
      const markers = {
        __NEXT_DATA__: !!window.__NEXT_DATA__,
        nextRoot: !!document.querySelector('#__next, [data-nextjs-router]'),
        nuxt: !!window.__NUXT__,
        svelteKit: !!document.querySelector('[data-sveltekit-hydrate]') || !!window.__sveltekit_dev,
        astro: !!document.querySelector('astro-island'),
        react: !!(window.React || document.querySelector('[data-reactroot]')) ||
               !!Object.keys(document.body).find(k => k.startsWith('__react')),
        vue: !!window.Vue || !!document.querySelector('[data-v-app]'),
        gsap: !!window.gsap || !!window.GreenSockGlobals || !!window.TweenMax,
        ScrollTrigger: !!(window.gsap && window.gsap.core && window.ScrollTrigger),
        lenis: !!window.Lenis || !!window.lenis || !!document.querySelector('.lenis, [class*=lenis]'),
        locomotive: !!window.LocomotiveScroll || !!document.querySelector('[data-scroll-container]'),
        three: !!window.THREE,
        motion: !!window.Motion || !!window.framerMotion,
        barba: !!window.barba,
        swup: !!window.swup,
        splitting: !!window.Splitting,
        matterjs: !!window.Matter,
        webgl: !!document.querySelector('canvas'),
      };
      const htmlCls = document.documentElement.className;
      const bodyCls = document.body.className;
      const rootStyle = document.documentElement.getAttribute('style');
      return {
        title: document.title, scripts, styles, imgs, fonts, markers,
        htmlCls, bodyCls, rootStyle,
        globals: g.filter(k => !/^(webkit|on|chrome|_{0,2}[A-Z]{2,}$)/.test(k)).slice(0, 400),
        bodyChildren: [...document.body.children].map(e => ({
          tag: e.tagName, id: e.id, cls: e.className, kids: e.children.length,
        })),
        scrollH: document.documentElement.scrollHeight,
        clientH: document.documentElement.clientHeight,
        bodyComputed: (() => {
          const c = getComputedStyle(document.body);
          return { overflow: c.overflow, position: c.position, height: c.height, transform: c.transform };
        })(),
      };
    });

    fs.writeFileSync(path.join(OUT, `dom-${name}.html`), await page.content());
    results[name] = { info, net };
    await page.screenshot({ path: path.join(OUT, `shot-${name}.png`), fullPage: false });
    await ctx.close();
  }

  fs.writeFileSync(path.join(OUT, 'recon.json'), JSON.stringify(results, null, 2));
  console.log('== DESKTOP MARKERS ==');
  console.log(JSON.stringify(results.desktop.info.markers, null, 1));
  console.log('== TITLE ==', results.desktop.info.title);
  console.log('== HTML CLS ==', results.desktop.info.htmlCls, '| BODY CLS ==', results.desktop.info.bodyCls);
  console.log('== BODY CHILDREN ==');
  console.log(JSON.stringify(results.desktop.info.bodyChildren, null, 1));
  console.log('== SCRIPTS ==');
  console.log(JSON.stringify(results.desktop.info.scripts, null, 1));
  console.log('== STYLES ==', JSON.stringify(results.desktop.info.styles, null, 1));
  console.log('== FONTS ==', JSON.stringify(results.desktop.info.fonts, null, 1));
  console.log('== SCROLL ==', results.desktop.info.scrollH, '/', results.desktop.info.clientH,
              JSON.stringify(results.desktop.info.bodyComputed));
  console.log('== NET (desktop), first 60 ==');
  for (const r of results.desktop.net.slice(0, 60)) {
    console.log(`${String(r.t).padStart(6)}ms ${String(r.status)} ${r.type.padEnd(10)} ${String(r.bytes).padStart(8)}  ${r.url.slice(0, 150)}`);
  }
  await browser.close();
})();
