// Loaded first by every page of the static interface: requests to /api/gateway/* (the Next proxy on the server and
// desktop editions) go to the gateway inside this page instead (gateway.js, app.inject()).
// <img>, <iframe> and <a href> never call fetch, so those loads are fetched here and shown as blob URLs.
// Detail pages exist only as /notes/_ and /labs/documents/_; a click on /notes/<id> is sent there with ?id=.
(function () {
  const original = window.fetch.bind(window);
  let gateway;
  const load = () => (gateway ||= import('/gateway.js').then(() => window.mcGateway.ready).then(() => window.mcGateway));

  function gatewayUrl(value) {
    if (typeof value !== 'string' || !value) return null;
    let url;
    try { url = new URL(value, location.href); } catch { return null; }
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/gateway/')) return null;
    return url;
  }

  function token() {
    try { return localStorage.getItem('dtc_token'); } catch { return null; }
  }

  function step(name) {
    try { window.dispatchEvent(new CustomEvent('mc-step', { detail: name })); } catch { /* the page may not be listening */ }
  }

  function bytesOf(value) {
    const ready = value && value.mcBytes;
    if (ready) return Promise.resolve(ready instanceof Uint8Array ? ready : new Uint8Array(ready));
    const bag = globalThis.__mcBytes;
    const key = value && `${value.name}\0${value.size}\0${value.lastModified}`;
    const hit = bag && value && bag.get(key);
    // One use per pick: the copied File keeps its own mcBytes for a retry, the bag must not grow all session.
    if (hit) { bag.delete(key); return Promise.resolve(hit); }
    if (value && typeof value.arrayBuffer === 'function') {
      return Promise.race([
        value.arrayBuffer().then((buf) => new Uint8Array(buf)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('file_unread')), 20000)),
      ]);
    }
    return readBlob(value);
  }

  function readBlob(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }

  // WebKit never finishes Request.arrayBuffer() for a FormData body, so the upload spinner stays up.
  // The bytes are written here, the same way the spike harness sends a PDF.
  async function encodeForm(fd) {
    const boundary = `----mc${Math.random().toString(16).slice(2)}`;
    const enc = new TextEncoder();
    const chunks = [];
    for (const [name, value] of fd.entries()) {
      const field = String(name).replace(/["\r\n]/g, '');
      if (typeof value === 'string') {
        chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"\r\n\r\n${value}\r\n`));
      } else {
        const filename = String(value.name || 'file').replace(/["\r\n]/g, '');
        chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`));
        step('reading');
        chunks.push(await bytesOf(value));
        chunks.push(enc.encode('\r\n'));
      }
    }
    chunks.push(enc.encode(`--${boundary}--\r\n`));
    const body = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) { body.set(c, at); at += c.length; }
    return { body, contentType: `multipart/form-data; boundary=${boundary}` };
  }

  function toResponse(r, method) {
    const out = new Headers();
    for (const [k, v] of Object.entries(r.headers)) {
      if (v == null || k === 'content-length' || k === 'transfer-encoding' || k === 'connection') continue;
      if (Array.isArray(v)) v.forEach((x) => out.append(k, String(x))); else out.set(k, String(v));
    }
    const empty = r.status === 204 || r.status === 304 || method === 'HEAD';
    const res = new Response(empty ? null : r.body, { status: r.status, headers: out });
    // The page turns the body into a blob and opens it. Keep the stored filename on that blob.
    const cd = res.headers.get('content-disposition') || '';
    const star = /filename\*=UTF-8''([^;]+)/.exec(cd);
    const plain = /filename="?([^";]+)"?/.exec(cd);
    let named = '';
    if (star) { try { named = decodeURIComponent(star[1]); } catch { named = ''; } }
    else if (plain) named = plain[1];
    if (named && typeof res.blob === 'function') {
      const read = res.blob.bind(res);
      res.blob = () => read().then((b) => new File([b], named, { type: b.type || res.headers.get('content-type') || 'application/octet-stream' }));
    }
    return res;
  }

  function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  async function readFiles(form, field) {
    const files = [];
    for (const [name, value] of form.entries()) {
      if (name === field && value && typeof value !== 'string') {
        step('reading');
        files.push({ filename: value.name || 'file', type: value.type || '', bytes: await bytesOf(value) });
      }
    }
    return files;
  }

  function fieldText(form, name) {
    for (const [n, value] of form.entries()) if (n === name && typeof value === 'string') return value;
    return '';
  }

  // Every remaining file form. Multipart through the in-page gateway never finishes on the device.
  async function directUpload(pathname, form) {
    if (pathname.endsWith('/notes/import')) {
      const gw = await load();
      return toResponse(await gw.notesImport({ files: await readFiles(form, 'files') }), 'POST');
    }
    const noteFiles = /\/notes\/([^/]+)\/files$/.exec(pathname);
    if (noteFiles) {
      const gw = await load();
      return toResponse(await gw.noteFiles({ id: noteFiles[1], files: await readFiles(form, 'file') }), 'POST');
    }
    const report = /\/appointments\/([^/]+)\/report$/.exec(pathname);
    if (report) {
      const gw = await load();
      return toResponse(await gw.appointmentReport({ id: report[1], summary: fieldText(form, 'summary'), files: await readFiles(form, 'file') }), 'POST');
    }
    if (pathname.endsWith('/settings/anamnesis/extract')) {
      const files = await readFiles(form, 'file');
      if (!files[0]) return jsonResponse(400, { error: 'file_required' });
      const gw = await load();
      return toResponse(await gw.anamnesisExtract(files[0]), 'POST');
    }
    if (pathname.endsWith('/labs/sample')) {
      const files = await readFiles(form, 'file');
      if (!files[0]) return jsonResponse(400, { error: 'file_required' });
      const gw = await load();
      return toResponse(await gw.labSample({ bytes: files[0].bytes }), 'POST');
    }
    if (pathname.endsWith('/import/archive')) {
      const files = await readFiles(form, 'archive');
      if (!files[0]) return jsonResponse(400, { error: 'file_required' });
      const gw = await load();
      return toResponse(await gw.importArchiveFile({ password: fieldText(form, 'password'), bytes: files[0].bytes }), 'POST');
    }
    return null;
  }

  window.fetch = async function (input, init) {
    const form = init && typeof FormData !== 'undefined' && init.body instanceof FormData ? init.body : null;
    const rawUrl = typeof input === 'string' ? input : (input && input.url);
    const early = form ? gatewayUrl(rawUrl) : null;
    if (early && form) {
      // Labs upload never goes through multipart. On the device that parser accepts the request and then waits forever.
      if (early.pathname.endsWith('/labs/commit-pdf')) {
        let file = null;
        for (const [name, value] of form.entries()) {
          if (name === 'file' && value && typeof value !== 'string') file = value;
        }
        if (!file) return new Response(JSON.stringify({ error: 'file_required' }), { status: 400, headers: { 'content-type': 'application/json' } });
        step('reading');
        const bytes = await bytesOf(file);
        const gw = await load();
        step('parsing');
        const r = await gw.commitPdf({ filename: file.name || 'file.pdf', bytes });
        return toResponse(r, 'POST');
      }
      // History and imaging upload a batch, or attach a file to one record. Multipart never finishes on the device.
      if (early.pathname.endsWith('/milestones/batch')) {
        let meta = null;
        let badMeta = false;
        const files = [];
        for (const [name, value] of form.entries()) {
          if (name === 'meta' && typeof value === 'string') {
            try { meta = JSON.parse(value); } catch { badMeta = true; }
          } else if (name === 'file' && value && typeof value !== 'string') {
            step('reading');
            files.push({ filename: value.name || 'file', type: value.type || '', bytes: await bytesOf(value) });
          }
        }
        if (badMeta) return new Response(JSON.stringify({ error: 'bad_meta' }), { status: 400, headers: { 'content-type': 'application/json' } });
        const gw = await load();
        const r = await gw.milestoneBatch({ meta, files });
        return toResponse(r, 'POST');
      }
      const attach = /\/milestones\/([^/]+)\/attachments$/.exec(early.pathname);
      if (attach) {
        let file = null;
        for (const [name, value] of form.entries()) {
          if (name === 'file' && value && typeof value !== 'string') file = value;
        }
        if (!file) return new Response(JSON.stringify({ error: 'file_required' }), { status: 400, headers: { 'content-type': 'application/json' } });
        step('reading');
        const bytes = await bytesOf(file);
        const gw = await load();
        const r = await gw.milestoneAttach({ id: attach[1], filename: file.name || 'file', type: file.type || '', bytes });
        return toResponse(r, 'POST');
      }
      const direct = await directUpload(early.pathname, form);
      if (direct) return direct;
      const encoded = await encodeForm(form);
      const headers = {};
      new Headers(init && init.headers).forEach((v, k) => { if (k.toLowerCase() !== 'content-type') headers[k] = v; });
      headers['content-type'] = encoded.contentType;
      const saved = token();
      if (saved && !headers.authorization) headers.authorization = `Bearer ${saved}`;
      const gw = await load();
      const method = (init && init.method) || 'POST';
      step('parsing');
      const r = await gw.request({ method, url: early.pathname.slice('/api/gateway'.length) + early.search, headers, body: encoded.body });
      return toResponse(r, method);
    }
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/gateway/')) return original(input, init);
    const headers = {};
    req.headers.forEach((v, k) => { headers[k] = v; });
    const saved = token();
    if (saved && !headers.authorization && !headers.Authorization) headers.authorization = `Bearer ${saved}`;
    const fileGet = req.method === 'GET' && /\/attachments\/([a-f0-9]{64})$/i.exec(url.pathname);
    if (fileGet) {
      const gw = await load();
      const r = await gw.attachmentGet({ sha256: fileGet[1], inline: url.searchParams.get('inline') === '1' });
      return toResponse(r, 'GET');
    }
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : new Uint8Array(await req.arrayBuffer());
    const gw = await load();
    const r = await gw.request({ method: req.method, url: url.pathname.slice('/api/gateway'.length) + url.search, headers, body });
    return toResponse(r, req.method);
  };

  function filenameFrom(res, url) {
    const cd = res.headers.get('content-disposition') || '';
    const named = /filename\*=UTF-8''([^;]+)/.exec(cd);
    if (named) { try { return decodeURIComponent(named[1]); } catch { /* keep going */ } }
    const plain = /filename="?([^";]+)"?/.exec(cd);
    if (plain) return plain[1];
    const last = decodeURIComponent(url.pathname.split('/').pop() || 'file');
    return last.includes('.') ? last : 'file';
  }

  const blobNames = new Map();
  const origCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (obj) {
    const u = origCreate(obj);
    if (obj instanceof Blob && obj.name) blobNames.set(u, obj.name);
    return u;
  };
  const origRevoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = function (u) { blobNames.delete(u); return origRevoke(u); };

  // Texts come from locales/<lang>/ipad.json (mc-words.js loads them).
  async function fileWords() {
    const dict = window.mcWords ? await window.mcWords.load() : {};
    const v = dict.fileViewer || {};
    return { save: v.save || 'Download', close: v.close || 'Close', fail: v.fail || '' };
  }

  function sizeLabel(n) {
    const en = (document.documentElement.lang || '').toLowerCase().startsWith('en');
    if (n < 1024) return `${n} ${en ? 'B' : 'Б'}`;
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} ${en ? 'KB' : 'КБ'}`;
    return `${(n / (1024 * 1024)).toFixed(1)} ${en ? 'MB' : 'МБ'}`;
  }

  function fallbackName(blob) {
    const type = blob.type || '';
    if (type === 'application/pdf') return 'file.pdf';
    if (type.startsWith('image/')) return `file.${type.slice(6).replace('jpeg', 'jpg')}`;
    return 'file';
  }

  // WKWebView does not open a blob address in a new window, and it ignores a download link.
  // Show the file here; Download uses the system share sheet, which can put it in Files.
  async function showFile(url, blob, name) {
    const prev = document.getElementById('mc-file-view');
    if (prev) { if (prev.mcUrl) URL.revokeObjectURL(prev.mcUrl); prev.remove(); }
    const words = await fileWords();
    const root = document.createElement('div');
    root.id = 'mc-file-view';
    root.mcUrl = url;
    root.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(20,24,28,.55);display:flex;align-items:flex-end;justify-content:center;padding:12px;';
    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;color:#1c1c1c;width:min(720px,100%);max-height:92vh;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.2);';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;align-items:center;padding:12px 14px;';
    const title = document.createElement('div');
    title.textContent = name;
    title.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 16px/1.3 -apple-system,sans-serif;';
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = words.save;
    save.style.cssText = 'font:600 15px/1 -apple-system,sans-serif;padding:10px 14px;border-radius:10px;border:none;background:#1c6b5a;color:#fff;';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = words.close;
    close.style.cssText = 'font:600 15px/1 -apple-system,sans-serif;padding:10px 14px;border-radius:10px;border:none;background:#eee;color:#1c1c1c;';
    const view = document.createElement('div');
    view.style.cssText = 'padding:8px 14px 16px;background:#f4f4f4;overflow:auto;';
    if ((blob.type || '').startsWith('image/') && blob.type !== 'image/heic') {
      const img = document.createElement('img');
      img.src = url; img.alt = name;
      img.style.cssText = 'display:block;max-width:100%;max-height:70vh;margin:0 auto;border-radius:8px;';
      view.appendChild(img);
    } else {
      const line = document.createElement('div');
      line.textContent = `${name} · ${sizeLabel(blob.size)}`;
      line.style.cssText = 'font:15px/1.4 -apple-system,sans-serif;padding:8px 0 4px;';
      view.appendChild(line);
    }
    const note = document.createElement('div');
    note.style.cssText = 'display:none;padding:0 14px 12px;font:14px/1.4 -apple-system,sans-serif;color:#8a3b2a;';
    save.addEventListener('click', async () => {
      const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] });
          return;
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
      note.textContent = words.fail;
      note.style.display = 'block';
    });
    const shutdown = () => { URL.revokeObjectURL(url); root.remove(); };
    close.addEventListener('click', shutdown);
    root.addEventListener('click', (e) => { if (e.target === root) shutdown(); });
    bar.append(title, save, close);
    card.append(bar, view, note);
    root.appendChild(card);
    document.body.appendChild(root);
  }

  function presentBlob(url) {
    original(url).then(async (r) => {
      const blob = await r.blob();
      const name = blobNames.get(url) || (blob.name && blob.name !== 'blob' ? blob.name : fallbackName(blob));
      await showFile(URL.createObjectURL(blob), blob, name);
    }).catch(() => {});
  }

  function saveBlob(blob, name) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = name;
    a.dataset.mcSave = '1';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  }

  function showBlob(blob, asDownload, name) {
    if (!asDownload && blob.type.startsWith('image/')) {
      const u = URL.createObjectURL(blob);
      window.open(u, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(u), 60000);
      return;
    }
    saveBlob(blob, name);
  }

  // One blob URL per element: the previous one is revoked when the next arrives, otherwise every shown
  // attachment would hold its full bytes in memory until the page unloads.
  const elBlob = new WeakMap();
  function hookProp(Ctor, prop) {
    const desc = Object.getOwnPropertyDescriptor(Ctor.prototype, prop);
    if (!desc || !desc.set || !desc.get) return;
    Object.defineProperty(Ctor.prototype, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get() { return desc.get.call(this); },
      set(value) {
        const url = gatewayUrl(value);
        if (!url) { desc.set.call(this, value); return; }
        const el = this;
        window.fetch(url.href).then(async (r) => {
          if (!r.ok) return;
          const next = URL.createObjectURL(await r.blob());
          const prev = elBlob.get(el);
          desc.set.call(el, next);
          elBlob.set(el, next);
          if (prev) URL.revokeObjectURL(prev);
        }).catch(() => {});
      },
    });
  }
  hookProp(HTMLImageElement, 'src');
  hookProp(HTMLIFrameElement, 'src');
  hookProp(HTMLEmbedElement, 'src');
  if (window.HTMLObjectElement) hookProp(HTMLObjectElement, 'data');
  hookProp(HTMLVideoElement, 'src');
  hookProp(HTMLAudioElement, 'src');
  hookProp(HTMLSourceElement, 'src');

  const origSet = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if ((name === 'src' || name === 'data') && gatewayUrl(value) && name in this && this.tagName !== 'A') {
      this[name] = value;
      return;
    }
    return origSet.call(this, name, value);
  };

  function detailFallback(href) {
    let url;
    try { url = new URL(href, location.href); } catch { return null; }
    if (url.origin !== location.origin) return null;
    const note = url.pathname.match(/^\/notes\/([^/]+)\/?$/);
    if (note && note[1] !== '_') {
      url.pathname = '/notes/_';
      url.searchParams.set('id', decodeURIComponent(note[1]));
      return url.pathname + url.search + url.hash;
    }
    const doc = url.pathname.match(/^\/labs\/documents\/([^/]+)\/?$/);
    if (doc && doc[1] !== '_') {
      url.pathname = '/labs/documents/_';
      url.searchParams.set('id', decodeURIComponent(doc[1]));
      return url.pathname + url.search + url.hash;
    }
    return null;
  }

  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || e.button !== 0) return;
    const raw = a.getAttribute('href');
    if (raw && raw.startsWith('blob:') && !a.dataset.mcSave) {
      e.preventDefault();
      e.stopPropagation();
      presentBlob(raw);
      return;
    }
    const file = gatewayUrl(raw);
    const detail = file ? null : detailFallback(raw);
    if (!file && !detail) return;
    e.preventDefault();
    e.stopPropagation();
    if (detail) { location.assign(detail); return; }
    window.fetch(file.href).then(async (r) => {
      if (!r.ok) return;
      const blob = await r.blob();
      const download = a.hasAttribute('download') || !blob.type.startsWith('image/');
      showBlob(blob, download, a.getAttribute('download') || filenameFrom(r, file));
    }).catch(() => {});
  }, true);

  const origOpen = window.open.bind(window);
  window.open = function (url, target, features) {
    const file = gatewayUrl(typeof url === 'string' ? url : '');
    if (file) {
      window.fetch(file.href).then(async (r) => {
        if (!r.ok) return;
        const blob = await r.blob();
        showBlob(blob, !blob.type.startsWith('image/'), filenameFrom(r, file));
      }).catch(() => {});
      return null;
    }
    // A new window with a blob address never appears in WKWebView, so the click looks like it did nothing.
    if (typeof url === 'string' && url.startsWith('blob:')) {
      presentBlob(url);
      return null;
    }
    return origOpen(url, target, features);
  };

  load().catch((e) => console.error('[medcontrol] gateway failed to start', e));
})();
