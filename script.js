const $ = s => document.querySelector(s);
const FORMATS = {
  image: [['png','PNG'],['jpg','JPG'],['webp','WEBP'],['pdf','PDF']],
  audio: [['mp3','MP3'],['wav','WAV'],['webm','WEBM']],
  video: [['mp3','MP3 audio'],['wav','WAV audio'],['webm','WEBM'],['mp4','MP4'],['png','Frame PNG'],['jpg','Frame JPG']],
  data:  [['json','JSON'],['csv','CSV'],['txt','TXT']]
};
const ICON = {image:'🖼️', video:'🎬', audio:'🎙️', data:'📄'};
const esc = s => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const size = b => b > 1e6 ? (b/1e6).toFixed(1)+' MB' : Math.max(1, Math.round(b/1e3))+' KB';
const ext = f => { const e = f.name.split('.').pop().toLowerCase(); return e === 'jpeg' ? 'jpg' : e; };
const kind = f => {
  if (f.type.startsWith('image/')) return 'image';
  if (f.type.startsWith('video/')) return 'video';
  if (f.type.startsWith('audio/')) return 'audio';
  const e = ext(f);
  if (/^(csv|json|txt)$/.test(e)) return 'data';
  if (/^(mp4|mkv|mov|webm|avi)$/.test(e)) return 'video';
  if (/^(mp3|wav|ogg|m4a|opus|aac|flac|amr)$/.test(e)) return 'audio';
  return null;
};
let tt; const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2800); };

/* ---------- converters ---------- */
const toBlob = (c, t, q) => new Promise(r => c.toBlob(r, t, q));

async function img(f, fmt, q) {
  const bmp = await createImageBitmap(f), c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d');
  if (fmt === 'jpg' || fmt === 'pdf') { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
  x.drawImage(bmp, 0, 0);
  if (fmt === 'pdf') return pdf(new Uint8Array(await (await toBlob(c, 'image/jpeg', q)).arrayBuffer()), c.width, c.height);
  return toBlob(c, {png:'image/png', jpg:'image/jpeg', webp:'image/webp'}[fmt], q);
}

function pdf(jpg, w, h) {
  const e = new TextEncoder(), parts = [], off = []; let len = 0;
  const add = d => { const b = typeof d === 'string' ? e.encode(d) : d; parts.push(b); len += b.length; };
  const obj = (n, d) => { off[n] = len; add(`${n} 0 obj\n${d}\nendobj\n`); };
  add('%PDF-1.4\n');
  obj(1, '<</Type/Catalog/Pages 2 0 R>>');
  obj(2, '<</Type/Pages/Kids[3 0 R]/Count 1>>');
  obj(3, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${w} ${h}]/Resources<</XObject<</I 4 0 R>>>>/Contents 5 0 R>>`);
  off[4] = len;
  add(`4 0 obj\n<</Type/XObject/Subtype/Image/Width ${w}/Height ${h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jpg.length}>>\nstream\n`);
  add(jpg); add('\nendstream\nendobj\n');
  const s = `q ${w} 0 0 ${h} 0 0 cm /I Do Q`;
  obj(5, `<</Length ${s.length}>>\nstream\n${s}\nendstream`);
  const x = len;
  add('xref\n0 6\n0000000000 65535 f \n');
  for (let i = 1; i < 6; i++) add(String(off[i]).padStart(10, '0') + ' 00000 n \n');
  add(`trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${x}\n%%EOF`);
  return new Blob(parts, {type:'application/pdf'});
}

async function decode(f) {
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  try { return await ac.decodeAudioData(await f.arrayBuffer()); }
  catch { throw Error('Your browser can’t read the audio in this file. Try Chrome or Edge.'); }
  finally { ac.close(); }
}
const pcm = a => { const r = new Int16Array(a.length); for (let i = 0; i < a.length; i++) { const s = Math.max(-1, Math.min(1, a[i])); r[i] = s < 0 ? s*32768 : s*32767; } return r; };

function wav(b) {
  const n = b.length, ch = Math.min(2, b.numberOfChannels), sr = b.sampleRate;
  const o = new DataView(new ArrayBuffer(44 + n*ch*2));
  const w = (p, s) => [...s].forEach((c, i) => o.setUint8(p+i, c.charCodeAt(0)));
  w(0,'RIFF'); o.setUint32(4, 36+n*ch*2, true); w(8,'WAVEfmt '); o.setUint32(16,16,true); o.setUint16(20,1,true);
  o.setUint16(22,ch,true); o.setUint32(24,sr,true); o.setUint32(28,sr*ch*2,true); o.setUint16(32,ch*2,true); o.setUint16(34,16,true);
  w(36,'data'); o.setUint32(40, n*ch*2, true);
  const d = [...Array(ch)].map((_, i) => pcm(b.getChannelData(i))); let p = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { o.setInt16(p, d[c][i], true); p += 2; }
  return new Blob([o], {type:'audio/wav'});
}

async function mp3(b, kbps, prog) {
  if (!window.lamejs) throw Error('MP3 encoder didn’t load — connect to the internet once, or choose WAV.');
  const ch = Math.min(2, b.numberOfChannels), enc = new lamejs.Mp3Encoder(ch, b.sampleRate, kbps), out = [];
  const L = pcm(b.getChannelData(0)), R = ch > 1 ? pcm(b.getChannelData(1)) : undefined;
  for (let i = 0; i < L.length; i += 1152) {
    const m = enc.encodeBuffer(L.subarray(i, i+1152), R ? R.subarray(i, i+1152) : undefined);
    if (m.length) out.push(m);
    if (i % (1152*150) === 0) { prog(i / L.length); await new Promise(r => setTimeout(r)); }
  }
  out.push(enc.flush());
  return new Blob(out, {type:'audio/mpeg'});
}

function rec(f, fmt, prog, vid) {           // re-records playback into WEBM / MP4
  return new Promise((res, rej) => {
    const el = document.createElement(vid ? 'video' : 'audio');
    el.src = URL.createObjectURL(f); el.playsInline = true;
    el.onerror = () => rej(Error('This file can’t be played by your browser.'));
    el.onloadedmetadata = () => {
      let st; try { st = el.captureStream ? el.captureStream() : el.mozCaptureStream(); } catch (e) { return rej(e); }
      const mime = fmt === 'mp4' ? 'video/mp4' : vid ? 'video/webm' : 'audio/webm';
      if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(mime)) return rej(Error(fmt.toUpperCase() + ' output isn’t supported in this browser. Try Chrome or Edge.'));
      const mr = new MediaRecorder(st, {mimeType: mime}), ch = [];
      mr.ondataavailable = e => e.data.size && ch.push(e.data);
      mr.onstop = () => res(new Blob(ch, {type: mime}));
      el.ontimeupdate = () => prog(el.currentTime / el.duration);
      el.onended = () => mr.stop();
      mr.start(500); el.play().catch(rej);
    };
  });
}

function frame(f, fmt) {
  return new Promise((res, rej) => {
    const v = document.createElement('video'); v.src = URL.createObjectURL(f); v.muted = true;
    v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); };
    v.onseeked = async () => {
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      res(await toBlob(c, fmt === 'png' ? 'image/png' : 'image/jpeg', .92));
    };
    v.onerror = () => rej(Error('Couldn’t read this video.'));
  });
}

const parseCSV = t => {
  const r = []; let row = [], c = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i+1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(c); c = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i+1] === '\n') i++; row.push(c); r.push(row); row = []; c = ''; }
    else c += ch;
  }
  if (c || row.length) { row.push(c); r.push(row); }
  return r.filter(x => x.length > 1 || x[0]);
};
async function data(f, fmt) {
  const t = await f.text(), e = ext(f), q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  if (e === 'json') {
    let j; try { j = JSON.parse(t); } catch { throw Error('This JSON file isn’t valid.'); }
    if (fmt === 'txt') return new Blob([JSON.stringify(j, null, 2)], {type:'text/plain'});
    const rows = Array.isArray(j) ? j : [j], k = [...new Set(rows.flatMap(o => Object.keys(o)))];
    return new Blob([[k.map(q).join(','), ...rows.map(o => k.map(x => q(o[x])).join(','))].join('\n')], {type:'text/csv'});
  }
  if (e === 'csv') {
    if (fmt === 'txt') return new Blob([t], {type:'text/plain'});
    const [h, ...r] = parseCSV(t);
    return new Blob([JSON.stringify(r.map(x => Object.fromEntries(h.map((k, i) => [k, x[i] ?? '']))), null, 2)], {type:'application/json'});
  }
  const lines = t.split(/\r?\n/);
  return fmt === 'json' ? new Blob([JSON.stringify(lines, null, 2)], {type:'application/json'})
                        : new Blob([lines.map(q).join('\n')], {type:'text/csv'});
}

async function run(it) {
  const {file: f, kind: k, fmt} = it;
  if (!fmt) return toast('Pick a format first');
  const p = v => it.set('Converting… ' + Math.round(v * 100) + '%', v);
  it.set('Starting…', .02);
  try {
    let out;
    if (k === 'image') out = await img(f, fmt, it.page.q());
    else if (k === 'data') out = await data(f, fmt);
    else if (k === 'video' && (fmt === 'png' || fmt === 'jpg')) out = await frame(f, fmt);
    else if (fmt === 'mp3' || fmt === 'wav') { const b = await decode(f); out = fmt === 'wav' ? wav(b) : await mp3(b, it.page.kbps(), p); }
    else out = await rec(f, fmt, p, k === 'video');
    it.done(out, fmt);
  } catch (e) { it.fail(e.message || 'Conversion failed'); }
}

/* ---------- UI ---------- */
const GR = {
  images:'linear-gradient(120deg,#f97316,#ec4899 55%,#a855f7)',
  videos:'linear-gradient(120deg,#6366f1,#8b5cf6 50%,#ec4899)',
  audio:'linear-gradient(120deg,#06b6d4,#10b981 55%,#84cc16)',
  voice:'linear-gradient(120deg,#f59e0b,#ef4444 55%,#ec4899)',
  data:'linear-gradient(120deg,#14b8a6,#3b82f6 55%,#8b5cf6)'
};
const PAGES = {
  images:{k:'image', icon:'🖼️', title:'Images', what:'images', accept:'image/*', hint:'PNG, JPG, WEBP, GIF, BMP', q:1,
          desc:'Convert photos and graphics between PNG, JPG and WEBP, or turn them into a PDF.'},
  videos:{k:'video', icon:'🎬', title:'Videos', what:'videos', accept:'video/*,.mkv,.mov', hint:'MP4, WEBM, MOV', kbps:1,
          desc:'Extract the audio as MP3 or WAV, re-save as WEBM or MP4, or grab a still frame.'},
  audio: {k:'audio', icon:'🎵', title:'Audio', what:'audio files', accept:'audio/*', hint:'MP3, WAV, OGG, M4A, FLAC', kbps:1,
          desc:'Switch songs and recordings between MP3, WAV and WEBM.'},
  voice: {k:'audio', icon:'🎙️', title:'Voice Notes', what:'voice notes', accept:'audio/*,.opus,.amr,.m4a,.ogg', hint:'OPUS, OGG, M4A, AMR', kbps:1, mic:1,
          desc:'Convert WhatsApp, Telegram and phone recordings, or record a new one right here.'},
  data:  {k:'data', icon:'📄', title:'Data Files', what:'data files', accept:'.csv,.json,.txt', hint:'CSV, JSON, TXT',
          desc:'Switch between CSV, JSON and TXT instantly.'}
};
const LABEL = {image:'Images', video:'Videos', audio:'Audio', data:'Data'};
const pills = k => `<div class="pills">${FORMATS[k].map(f => `<em>${f[1]}</em>`).join('')}</div>`;

function add(f, pg) {
  const k = kind(f), el = document.createElement('div'), it = {file: f, kind: k, fmt: null, page: pg};
  const opts = FORMATS[k].filter(([x]) => x !== ext(f));
  el.className = 'card';
  el.innerHTML = `<div class="ico">${ICON[k]}</div>
    <div class="meta"><b>${esc(f.name)}</b><small>${size(f.size)} · ${k}</small>
      <div class="chips">${opts.map(([x, l]) => `<button data-f="${x}">${l}</button>`).join('')}</div>
      <div class="bar"><i></i></div><small class="st"></small></div>
    <div class="act"><button class="btn go" disabled>Convert</button><button class="x" title="Remove">✕</button></div>`;
  const bar = el.querySelector('.bar i'), st = el.querySelector('.st'), act = el.querySelector('.act'), go = el.querySelector('.go');
  it.set = (m, v) => { st.textContent = m; bar.style.width = Math.round(v * 100) + '%'; el.classList.add('busy'); go.disabled = true; };
  it.done = (b, x) => {
    act.querySelector('.dl')?.remove();
    const a = document.createElement('a');
    a.className = 'btn dl'; a.href = URL.createObjectURL(b);
    a.download = f.name.replace(/\.[^.]+$/, '') + '.' + x; a.textContent = '⬇ ' + size(b.size);
    act.prepend(a); bar.style.width = '100%'; st.textContent = '✅ Done — ready to download';
    el.classList.remove('busy'); go.disabled = false; go.textContent = 'Convert again'; toast('Converted ' + f.name);
  };
  it.fail = m => { st.textContent = '⚠ ' + m; bar.style.width = '0'; el.classList.remove('busy'); go.disabled = !it.fmt; };
  el.onclick = ev => {
    const c = ev.target.closest('[data-f]');
    if (c) { it.fmt = c.dataset.f; el.querySelectorAll('[data-f]').forEach(b => b.classList.toggle('on', b === c)); go.disabled = false; }
    else if (ev.target.closest('.x')) { el.remove(); pg.items.splice(pg.items.indexOf(it), 1); pg.sync(); }
    else if (ev.target.closest('.go')) run(it);
  };
  pg.list.append(el); pg.items.push(it); pg.sync();
}
const addFiles = (fs, pg) => [...fs].forEach(f => {
  const k = kind(f);
  if (k === pg.k) add(f, pg);
  else toast(k ? `${f.name} is a ${k} file — use the ${LABEL[k]} section` : `${f.name} isn’t a supported file type`);
});

async function mic(btn, note, pg) {
  if (btn.mr) return btn.mr.stop();
  try {
    const st = await navigator.mediaDevices.getUserMedia({audio: true}), ch = [], mr = new MediaRecorder(st), t0 = Date.now();
    btn.mr = mr; btn.classList.add('rec'); btn.textContent = '⏹ Stop recording';
    const iv = setInterval(() => note.textContent = Math.round((Date.now() - t0) / 1000) + 's', 500);
    mr.ondataavailable = e => ch.push(e.data);
    mr.onstop = () => {
      clearInterval(iv); st.getTracks().forEach(t => t.stop());
      btn.mr = null; btn.classList.remove('rec'); btn.textContent = '🎙️ Record a voice note'; note.textContent = '';
      const t = mr.mimeType || 'audio/webm';
      add(new File(ch, 'voice-note-' + (Date.now() % 1e5) + (t.includes('mp4') ? '.m4a' : '.webm'), {type: t}), pg);
    };
    mr.start();
  } catch { toast('Microphone blocked — allow access in your browser and try again.'); }
}

Object.entries(PAGES).forEach(([id, c]) => {
  const s = document.createElement('section');
  s.className = 'page'; s.id = id; s.style.setProperty('--g', GR[id]);
  s.innerHTML = `<h1>${c.icon} <span class="grad">${c.title}</span></h1><p class="sub">${c.desc}</p>
    <label class="drop" tabindex="0"><input type="file" hidden multiple accept="${c.accept}"><div class="orb">${c.icon}</div>
      <h3>Drop your ${c.what} here</h3><p>or click to browse · ${c.hint}</p>${pills(c.k)}</label>
    ${c.mic ? '<div class="microw"><button class="btn mic">🎙️ Record a voice note</button><small class="mt"></small></div>' : ''}
    <div class="settings">${c.q ? '<label>Image quality <output>92%</output><input type="range" class="q" min="40" max="100" value="92"></label>' : ''}${c.kbps ? '<label>MP3 bitrate <select class="kbps"><option>96</option><option>128</option><option selected>192</option><option>256</option><option>320</option></select></label>' : ''}</div>
    <div class="list"></div><button class="btn all" hidden>Convert all selected</button>`;
  $('#main').append(s);

  const pg = {k: c.k, items: [], list: s.querySelector('.list'), all: s.querySelector('.all'),
    q: () => +(s.querySelector('.q')?.value || 92) / 100, kbps: () => +(s.querySelector('.kbps')?.value || 192)};
  pg.sync = () => { pg.all.hidden = pg.items.length < 2; };
  const drop = s.querySelector('.drop'), inp = s.querySelector('input[type=file]');
  inp.onchange = () => { addFiles(inp.files, pg); inp.value = ''; };
  ['dragenter', 'dragover'].forEach(n => drop.addEventListener(n, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(n => drop.addEventListener(n, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => addFiles(e.dataTransfer.files, pg));
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
  pg.all.onclick = async () => { const r = pg.items.filter(i => i.fmt); if (!r.length) return toast('Pick a format on at least one file'); for (const i of r) await run(i); };
  const q = s.querySelector('.q'); if (q) q.oninput = () => { s.querySelector('output').textContent = q.value + '%'; };
  if (c.mic) { const b = s.querySelector('.mic'); b.onclick = () => mic(b, s.querySelector('.mt'), pg); }
});

$('#cats').innerHTML = Object.entries(PAGES).map(([id, c]) =>
  `<a class="tile cat" href="#${id}" style="--g:${GR[id]}"><span>${c.icon}</span><h3>${c.title}</h3><p>${c.desc}</p>${pills(c.k)}</a>`).join('');

addEventListener('pointermove', e => { $('#glow').style.transform = `translate(${e.clientX}px,${e.clientY}px)`; });
const show = () => {
  let h = (location.hash || '#home').slice(1); if (!$('#' + h)) h = 'home';
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('on', p.id === h));
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.p === h));
  scrollTo(0, 0);
};
addEventListener('hashchange', show); show();