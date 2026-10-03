import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('keeps report structure, attributes, CSS, SVG namespaces and text in source order', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { sanitizeDocument } = await import('/src/sanitize.ts' as string);
    const doc = sanitizeDocument(`<!doctype html><html lang="tr" dir="ltr"><head>
      <title>Şirket &amp; rapor</title><style media="print">.page { color: red }</style></head>
      <body class="report"><section data-htpo-page class="page" aria-label="Sayfa">
      Önce<form><b>Form içeriği</b></form><unknown-container><i>İçerik</i></unknown-container>Sonra
      <table cellpadding="4"><thead><tr><th scope="col">Başlık</th></tr></thead><tbody><tr><td colspan="2" style="padding:2px">ŞĞİı 911₺</td></tr></tbody></table>
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 80">
      <style>.outline { stroke: blue }</style><defs><linearGradient id="paint"><stop offset="1" stop-color="red"/></linearGradient><path id="shape" d="M0 0h10v10z"/></defs>
      <rect width="100" height="80" fill="url(#paint)"/><use xlink:href="#shape"/>
      <text xml:space="preserve"> A &lt; B </text></svg></section></body></html>`);
    return {
      title: doc.title, lang: doc.documentElement.lang, body: doc.body.className,
      media: doc.querySelector('style')!.media, css: doc.querySelector('style')!.textContent,
      page: doc.querySelector('section')!.getAttribute('data-htpo-page'),
      order: doc.querySelector('section')!.textContent!.replace(/\s+/g, ''),
      colspan: doc.querySelector('td')!.colSpan, scope: doc.querySelector('th')!.scope,
      svg: doc.querySelector('svg')!.namespaceURI, viewBox: doc.querySelector('svg')!.getAttribute('viewBox'),
      gradient: doc.querySelector('linearGradient')!.id,
      use: doc.querySelector('use')!.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
      space: doc.querySelector('text')!.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'space'),
      svgCss: doc.querySelector('svg style')!.textContent,
      wrappers: doc.querySelectorAll('form,unknown-container').length,
    };
  });
  expect(result).toMatchObject({ title: 'Şirket & rapor', lang: 'tr', body: 'report', media: 'print', page: '', colspan: 2, scope: 'col',
    svg: 'http://www.w3.org/2000/svg', viewBox: '0 0 100 80', gradient: 'paint', use: '#shape', space: 'preserve', wrappers: 0 });
  expect(result.css).toContain('.page { color: red }');
  expect(result.svgCss).toBe('.outline { stroke: blue }');
  expect(result.order).toBe('ÖnceFormiçeriğiİçerikSonraBaşlıkŞĞİı911₺.outline{stroke:blue}A<B');
});

test('normalizes URL schemes and permits only static resources and supported links', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { sanitizeDocument } = await import('/src/sanitize.ts' as string);
    const blocked = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java&#x09;script:alert(1)', '&#13; javascript:alert(1)',
      'vbscript:msgbox(1)', 'data:text/html,hello', 'file:///etc/passwd', 'filesystem:https://example.com/x'];
    const allowed = ['https://example.com', 'http://example.com', '/relative', '//example.com/path', '#section', 'mailto:a@example.com', 'tel:+90111'];
    const doc = sanitizeDocument(blocked.map(href => `<a class="blocked" href="${href}">Link</a><img src="${href}">`).join('')
      + allowed.map(href => `<a class="allowed" href="${href}" target="_blank">Link</a>`).join('')
      + '<svg><use href="https://example.com/sprite.svg#icon"/><use href="#local"/><image href="data:image/png;base64,abc"/></svg>');
    return {
      blocked: [...doc.querySelectorAll('.blocked')].map(el => el.getAttribute('href')),
      images: [...doc.querySelectorAll('img')].map(el => el.getAttribute('src')),
      allowed: [...doc.querySelectorAll('.allowed')].map(el => [el.getAttribute('href'), el.getAttribute('rel')]),
      uses: [...doc.querySelectorAll('use')].map(el => el.getAttribute('href')),
      image: doc.querySelector('image')!.getAttribute('href'),
    };
  });
  expect(result.blocked).toEqual(Array(8).fill(null)); expect(result.images).toEqual(Array(8).fill(null));
  expect(result.allowed).toHaveLength(7);
  for (const [href, rel] of result.allowed) { expect(href).toBeTruthy(); expect(rel).toBe('noopener noreferrer'); }
  expect(result.uses).toEqual([null, '#local']); expect(result.image).toBe('data:image/png;base64,abc');
});

test('drops active subtrees, event attributes, custom upgrades and DOM clobbering names', async ({ page }) => {
  const requests: string[] = [];
  await page.route('https://attack.invalid/**', route => { requests.push(route.request().url()); return route.abort(); });
  const result = await page.evaluate(async () => {
    const { prepare } = await import('/src/index.ts' as string);
    let upgrades = 0;
    customElements.define('host-exploit', class extends HTMLElement { constructor() { super(); upgrades++; } });
    const before = document.querySelectorAll('iframe[data-htpo]').length;
    const prepared = await prepare(`<html onload="parent.document.body.dataset.compromised='yes'"><head>
      <base href="https://attack.invalid/"><meta http-equiv="refresh" content="0;url=https://attack.invalid/refresh">
      <link rel="preload" as="script" href="https://attack.invalid/preload"><link rel="stylesheet" href="javascript:alert(1)">
      <script>parent.document.body.dataset.compromised='yes'</script></head><body>
      <iframe src="https://attack.invalid/frame" srcdoc="<script>alert(1)</script>"></iframe>
      <object data="https://attack.invalid/object"></object><embed src="https://attack.invalid/embed">
      <video poster="https://attack.invalid/video"><source src="https://attack.invalid/source"></video>
      <form action="https://attack.invalid/post"><input id="body" name="__proto__" autofocus formaction="https://attack.invalid/post" onfocus="alert(1)" value="Safe"></form>
      <form name="head"><input name="attributes"></form><img name="body"><img name="documentElement"><img name="querySelector">
      <host-exploit is="host-exploit"><p id="constructor" name="querySelector">Safe text</p></host-exploit>
      <img src="javascript:alert(1)" srcset="https://attack.invalid/srcset 2x" onerror="parent.document.body.dataset.compromised='yes'">
      <a href="https://example.com" ping="https://attack.invalid/ping" target="_top">Link</a>
      <template shadowrootmode="open"><script>alert(1)</script></template>
      <noscript><img src="https://attack.invalid/noscript"></noscript></body></html>`);
    try {
      const frames = [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-htpo]')];
      const frame = frames.at(-1)!, doc = frame.contentDocument!;
      const forbidden = doc.querySelectorAll('script,iframe,object,embed,base,form,video,source,template,noscript,host-exploit').length;
      const badAttributes = [...doc.querySelectorAll('*')].flatMap(el => [...el.attributes].filter(a => /^on/i.test(a.name) || ['srcdoc', 'autofocus', 'action', 'formaction', 'ping', 'srcset', 'is'].includes(a.name)).map(a => a.name));
      const clobbering = doc.querySelectorAll('[id="body"],[id="constructor"],[name="__proto__"],[name="querySelector"]').length;
      const pdf = await prepared.toPdf(); await prepared.preview(1, 1);
      return { forbidden, badAttributes, clobbering, upgrades, compromised: document.body.dataset.compromised,
        csp: doc.querySelectorAll('meta').length, sandbox: frame.getAttribute('sandbox'), title: doc.title,
        signature: await pdf.blob.slice(0, 5).text(), text: doc.body.textContent, before };
    } finally { prepared.dispose(); }
  });
  expect(result).toMatchObject({ forbidden: 0, badAttributes: [], clobbering: 0, upgrades: 0, csp: 1, sandbox: 'allow-same-origin allow-modals', signature: '%PDF-' });
  expect(result.compromised).toBeUndefined(); expect(result.text).toContain('Safe text');
  expect(requests).toEqual([]);
  expect(await page.locator('iframe[data-htpo]').count()).toBe(result.before);
});

test('malformed HTML and SVG cannot smuggle active nodes through namespace changes', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { prepare } = await import('/src/index.ts' as string);
    const payloads = [
      '<svg><foreignObject><div><img src=x onerror=alert(1)></div></foreignObject><script>alert(1)</script></svg>',
      '<svg><a href="#safe"><animate attributeName="href" values="javascript:alert(1)"/><set attributeName="onclick" to="alert(1)"/></a></svg>',
      '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>"></math>',
      '<svg><desc><style><img src=x onerror=alert(1)></style></desc></svg>',
      '<table><svg><style><a title="</style><img src=x onerror=alert(1)>"></a></svg></table>',
      '<svg xmlns="http://www.w3.org/2000/svg"><g xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></g></svg>',
      '<div data-markup="&lt;img src=x onerror=alert(1)&gt;">Safe</div>',
      '<textarea>&lt;/textarea&gt;&lt;script&gt;alert(1)&lt;/script&gt;</textarea>',
    ];
    const violations: string[] = [];
    for (const html of payloads) {
      const prepared = await prepare(html + '<p>Safe</p>', { resourcePolicy: 'warn', resolveResource: () => new Blob([''], { type: 'image/png' }) });
      try {
        const doc = [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-htpo]')].at(-1)!.contentDocument!;
        for (const el of doc.querySelectorAll('*')) {
          if (['script', 'foreignObject', 'animate', 'set', 'math'].includes(el.localName)) violations.push(el.localName);
          for (const a of el.attributes) if (/^on/i.test(a.name) || ((a.localName === 'href' || a.name === 'src') && /^javascript:/i.test(a.value))) violations.push(a.name);
        }
      } finally { prepared.dispose(); }
    }
    return violations;
  });
  expect(result).toEqual([]);
});

test('external and custom CSS with closing style tags stays text during frame installation', async ({ page }) => {
  const requests: string[] = [];
  await page.route('https://attack.invalid/**', route => { requests.push(route.request().url()); return route.abort(); });
  const result = await page.evaluate(async () => {
    const { prepare } = await import('/src/index.ts' as string);
    const css = '/* </style><img src="https://attack.invalid/escape" onerror="parent.document.body.dataset.compromised=1"><script>parent.document.body.dataset.compromised=1</script> */ p{color:rgb(0,128,0)}';
    const results = [];
    for (const external of [true, false]) {
      const prepared = await prepare((external ? '<link rel="stylesheet" href="https://example.invalid/style.css">' : '') + '<p>Safe</p>', {
        css: external ? undefined : css,
        resolveResource: (url: string) => url.endsWith('/style.css') ? new Blob([css], { type: 'text/css' }) : undefined,
      });
      try {
        const doc = [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-htpo]')].at(-1)!.contentDocument!;
        const pdf = await prepared.toPdf(); await prepared.preview(1, 1);
        results.push({ color: doc.defaultView!.getComputedStyle(doc.querySelector('p')!).color,
          injected: doc.querySelectorAll('img,script').length, signature: await pdf.blob.slice(0, 5).text() });
      } finally { prepared.dispose(); }
    }
    return { results, compromised: document.body.dataset.compromised };
  });
  expect(result.results).toEqual(Array(2).fill({ color: 'rgb(0, 128, 0)', injected: 0, signature: '%PDF-' }));
  expect(result.compromised).toBeUndefined(); expect(requests).toEqual([]);
});

test('resource loading stays in the resolver and missed CSS URLs are blocked by CSP', async ({ page }) => {
  const requests: string[] = [];
  await page.route('https://attack.invalid/**', route => { requests.push(route.request().url()); return route.abort(); });
  const result = await page.evaluate(async () => {
    const { prepare } = await import('/src/index.ts' as string);
    const resolved: string[] = [];
    const prepared = await prepare(`<style>.box{width:20px;height:20px;background-image: image-set("https://attack.invalid/unmanaged" 1x)}</style>
      <img src="https://attack.invalid/owned" width="20" height="20"><div class="box"></div>`, {
      resolveResource: (url: string) => {
        resolved.push(url);
        if (url === 'https://attack.invalid/owned') return new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/><script>parent.document.body.dataset.compromised=1</script></svg>'], { type: 'image/svg+xml' });
        return undefined;
      },
    });
    try {
      const canvas = await prepared.preview(1, 1);
      return { pixel: [...canvas.getContext('2d')!.getImageData(5, 5, 1, 1).data], resolved, compromised: document.body.dataset.compromised };
    } finally { prepared.dispose(); }
  });
  expect(result.pixel).toEqual([0, 128, 0, 255]); expect(result.resolved).toEqual(['https://attack.invalid/owned']);
  expect(result.compromised).toBeUndefined(); expect(requests).toEqual([]);
});

test('deep unknown wrappers are unwrapped without losing text or overflowing JS recursion', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { sanitizeDocument } = await import('/src/sanitize.ts' as string);
    const doc = sanitizeDocument('<unknown>'.repeat(1500) + '<p>Derin içerik</p>' + '</unknown>'.repeat(1500));
    return { text: doc.body.textContent, unknown: doc.querySelectorAll('unknown').length, paragraphs: doc.querySelectorAll('p').length };
  });
  expect(result).toEqual({ text: 'Derin içerik', unknown: 0, paragraphs: 1 });
});
