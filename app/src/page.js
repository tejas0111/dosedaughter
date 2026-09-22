// DoseDaughter — server-rendered pages (chat widget, memory receipts, before/after demo).
// Pure HTML/CSS/JS, no build step: keeps `git clone && npm i && npm run dev` reproducible.
// Untrusted text is escaped server-side (esc) and injected client-side via textContent.

const esc = (s) => String(s ?? '').replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
:root{--teal:#0f5d5a;--teal-dk:#0b4341;--teal-soft:#e6f2f1;--ink:#1c2b2a;--mut:#5b6f6d;
--line:#dbe7e6;--bg:#f4f8f7;--card:#ffffff;--red:#b91c1c;--red-soft:#fef2f2;--green:#15803d;
--green-soft:#f0fdf4;--amber:#a16207;--amber-soft:#fffbeb}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:0 16px 48px}
header.top{background:var(--teal);color:#fff;padding:18px 0 14px}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:0}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px;letter-spacing:.2px}
.brand .seal{font-size:26px}
.tag{color:#cfe8e6;font-size:13px;margin-top:2px}
.badge{display:inline-block;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;letter-spacing:.4px}
.badge.mainnet{background:#dcfce7;color:#166534}
.badge.local{background:var(--amber-soft);color:var(--amber);border:1px solid #fde68a}
a{color:var(--teal)}
button{font:inherit;cursor:pointer}
.btn{background:var(--teal);color:#fff;border:none;border-radius:10px;padding:10px 16px;font-weight:600}
.btn:hover{background:var(--teal-dk)}
.btn.ghost{background:transparent;color:var(--teal);border:1.5px solid var(--line)}
.panel{background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:0 1px 3px rgba(15,93,90,.06)}
footer.foot{margin-top:18px;color:var(--mut);font-size:13px;text-align:center}
footer.foot a{color:var(--teal)}
/* chat */
#log{padding:18px;display:flex;flex-direction:column;gap:14px;min-height:340px;max-height:60vh;overflow-y:auto}
.msg{max-width:86%;border-radius:14px;padding:10px 14px;white-space:pre-wrap;word-wrap:break-word}
.msg.user{align-self:flex-end;background:var(--teal);color:#fff;border-bottom-right-radius:4px}
.card{align-self:flex-start;background:var(--card);border:1px solid var(--line);border-radius:14px;border-bottom-left-radius:4px;max-width:92%;padding:12px 14px}
.card .reply{white-space:pre-wrap;word-wrap:break-word}
.card.stop{background:var(--red-soft);border-color:#fecaca}
.card.stop .reply{color:var(--red);font-weight:700}
.card .disclaim{margin-top:8px;color:var(--mut);font-size:12px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.chip{font-size:12px;background:var(--teal-soft);color:var(--teal-dk);border-radius:999px;padding:4px 10px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chips summary{cursor:pointer;font-size:12px;color:var(--mut);user-select:none}
.toast{margin-top:10px;font-size:13px;background:var(--green-soft);border:1px solid #bbf7d0;color:var(--green);border-radius:10px;padding:8px 12px}
.toast code{background:transparent;padding:0}
.bloblink{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--green);word-break:break-all}
.typing{align-self:flex-start;color:var(--mut);font-size:14px;padding:10px 14px;display:none}
.typing.on{display:block}
.quick{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 10px}
.quick button{background:var(--card);border:1.5px solid var(--line);color:var(--teal-dk);border-radius:999px;padding:7px 13px;font-size:13px}
.quick button:hover{border-color:var(--teal);background:var(--teal-soft)}
.inputrow{display:flex;gap:10px;padding:14px;border-top:1px solid var(--line)}
.inputrow input{flex:1;border:1.5px solid var(--line);border-radius:10px;padding:11px 13px;font:inherit;outline:none}
.inputrow input:focus{border-color:var(--teal)}
.inputrow .who{width:150px;border:1.5px solid var(--line);border-radius:10px;padding:11px;font:inherit;color:var(--mut)}
@media(max-width:560px){.inputrow{flex-wrap:wrap}.inputrow .who{width:100%;padding:8px 11px}.msg{max-width:95%}.card{max-width:98%}}
/* memory + demo pages */
h1.pg{font-size:22px;margin:22px 0 6px}
.sub{color:var(--mut);font-size:14px;margin:0 0 16px}
.notice{font-size:13px;border-radius:10px;padding:10px 13px;margin:12px 0}
.notice.mainnet{background:var(--green-soft);border:1px solid #bbf7d0;color:var(--green)}
.notice.local{background:var(--amber-soft);border:1px solid #fde68a;color:var(--amber)}
ul.receipts{list-style:none;padding:0;margin:14px 0}
ul.receipts li{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
ul.receipts .fact{word-wrap:break-word}
ul.receipts .bid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--teal);white-space:nowrap}
ul.receipts .bid.loc{color:var(--amber)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:640px){.two{grid-template-columns:1fr}}
.dcard h3{margin:0 0 4px;font-size:15px}
.dcard .count{font-size:12px;color:var(--mut);margin-bottom:10px}
.dcard ul{list-style:none;margin:0;padding:0}
.dcard li{font-size:14px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;margin-bottom:8px;word-wrap:break-word}
.dcard li small{display:block;color:var(--mut);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;margin-top:3px;word-break:break-all}
.dcard li.none{color:var(--mut);font-style:italic}
.dcard.after{border-color:#bbf7d0}
.dcard.before h3{color:var(--red)}
.dcard.after h3{color:var(--green)}
.qline{background:var(--teal-soft);border-radius:10px;padding:10px 14px;font-weight:600;margin:14px 0}
`;

const TOP = (title, mode, active) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body>
<header class="top"><div class="wrap">
  <div><div class="brand"><span class="seal">&#129461;</span>DoseDaughter</div>
  <div class="tag">A caregiver chatbot that never re-asks a dose</div></div>
  <div style="text-align:right"><span class="badge ${mode === 'mainnet' ? 'mainnet' : 'local'}">${mode === 'mainnet' ? 'WALRUS MAINNET' : 'LOCAL DEMO'}</span>
  <div style="font-size:12px;margin-top:6px"><a style="color:#cfe8e6" href="/">Chat</a> &middot; <a style="color:#cfe8e6" href="/demo">Before/After</a></div></div>
</div></header>`;

const FOOT = (mode, userId) => `<footer class="foot">
  Built on Walrus Memory &mdash; every remembered fact is a Seal-encrypted blob on Walrus${mode === 'mainnet' ? ' Mainnet' : ''}.
  ${mode === 'mainnet' ? 'Verify any fact on <a href="https://walruscan.com" target="_blank" rel="noopener">walruscan.com</a>.' : 'Set MEMWAL_MODE=mainnet with keys for real Mainnet storage.'}<br>
  Confirm with your doctor &mdash; this is not medical advice.
</footer>`;

// ---------- chat widget ----------
export function chatPage({ mode, model }) {
  return TOP('DoseDaughter — chat', mode) + `
<div class="wrap">
  <div class="panel" style="margin-top:18px">
    <div id="log">
      <div class="card"><div class="reply">Hi &#8212; I'm DoseDaughter. Teach me about the person you care for (meds, allergies, routines). I'll remember across sessions on Walrus${mode === 'mainnet' ? ' Mainnet' : ''} &#8212; and I'll show you every receipt.</div></div>
    </div>
    <div class="typing" id="typing">remembering&hellip;</div>
    <div class="quick">
      <button data-msg="My mom takes Metformin 500mg at 8pm after food">Teach: Metformin 500mg at 8pm</button>
      <button data-msg="She is allergic to ibuprofen, causes rash">Teach: ibuprofen allergy</button>
      <button data-msg="What meds does mom take?">Ask: what meds?</button>
      <button data-msg="Can she take ibuprofen for her headache?">Allergy trap &#9888;</button>
    </div>
    <div class="inputrow">
      <input class="who" id="who" placeholder="user id" value="demo-mom" spellcheck="false">
      <input id="text" placeholder="Say something&hellip; (Enter to send)" autocomplete="off">
      <button class="btn" id="send">Send</button>
    </div>
  </div>
  <div class="quick" style="margin-top:10px">
    <a class="btn ghost" style="text-decoration:none" id="memlink" href="/memory?user=demo-mom">See what it remembers</a>
    <a class="btn ghost" style="text-decoration:none" href="/demo">Day&nbsp;1 vs Day&nbsp;7</a>
    <a class="btn ghost" style="text-decoration:none" href="/api/summary?user=demo-mom">Doctor summary</a>
  </div>
  <footer class="foot">LLM: ${esc(model)} via OpenRouter &middot; memory: ${mode === 'mainnet' ? 'Walrus Memory, Mainnet' : 'local stand-in (identical interface)'} &middot; <a href="https://github.com/tejas0111/dosedaughter">source</a></footer>
</div>
<script>
(function(){
  var log = document.getElementById('log');
  var typing = document.getElementById('typing');
  var text = document.getElementById('text');
  var who = document.getElementById('who');
  var send = document.getElementById('send');
  var memlink = document.getElementById('memlink');
  who.addEventListener('change', function(){ memlink.href = '/memory?user=' + encodeURIComponent(who.value.trim() || 'anon'); });
  function esc2(s){ return String(s == null ? '' : s); }
  function addUser(t){
    var d = document.createElement('div'); d.className = 'msg user'; d.textContent = esc2(t); log.appendChild(d); scroll();
  }
  function card(base, cls){
    var c = document.createElement('div'); c.className = 'card' + (cls ? ' ' + cls : '');
    var r = document.createElement('div'); r.className = 'reply'; r.textContent = esc2(base);
    c.appendChild(r); return c;
  }
  function addChips(c, recalled){
    if (recalled && recalled.length){
      var det = document.createElement('details'); det.className = 'chips';
      var sum = document.createElement('summary'); sum.textContent = 'Memory used (' + recalled.length + ')' + (recalled.length === 1 ? ' memory' : ' memories'); det.appendChild(sum);
      recalled.forEach(function(t){ var s = document.createElement('span'); s.className = 'chip'; s.textContent = t; s.title = t; det.appendChild(s); });
      c.appendChild(det);
    }
  }
  function addToast(c, blob, mode){
    if (!blob) return;
    var t = document.createElement('div'); t.className = 'toast';
    t.appendChild(document.createTextNode('\\uD83E\\uDDAD Remembered \\u2192 '));
    if (String(blob).indexOf('local-') === 0 || mode !== 'mainnet'){
      var code = document.createElement('code'); code.textContent = blob; t.appendChild(code);
      t.appendChild(document.createTextNode(' (local demo id)'));
    } else {
      var a = document.createElement('a'); a.className = 'bloblink';
      a.href = 'https://walruscan.com/mainnet/blob/' + encodeURIComponent(blob);
      a.target = '_blank'; a.rel = 'noopener'; a.textContent = blob;
      a.title = 'Verify this memory on walruscan';
      t.appendChild(a);
    }
    c.appendChild(t);
  }
  function addDisclaimer(c){
    var d = document.createElement('div'); d.className = 'disclaim';
    d.textContent = 'Confirm with your doctor \\u2014 this is not medical advice.';
    c.appendChild(d);
  }
  function scroll(){ log.scrollTop = log.scrollHeight; }
  function busy(b){ typing.className = 'typing' + (b ? ' on' : ''); send.disabled = b; }
  function go(message){
    var uid = who.value.trim() || 'anon';
    addUser(message); busy(true); scroll();
    fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid, message: message }) })
    .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
    .then(function(res){
      busy(false);
      if (!res.ok || res.j.error){
        var e = card('Something went wrong: ' + (res.j && res.j.error ? res.j.error : 'unknown error'), 'stop');
        log.appendChild(e); scroll(); return;
      }
      var isStop = /^STOP\\b/.test(res.j.reply || '');
      var c = card(res.j.reply, isStop ? 'stop' : '');
      addChips(c, res.j.recalled);
      addToast(c, res.j.savedBlob, res.j.mode);
      addDisclaimer(c);
      log.appendChild(c); scroll();
    })
    .catch(function(err){ busy(false); var e = card('Network error: ' + err, 'stop'); log.appendChild(e); scroll(); });
  }
  function submit(){
    var m = text.value.trim(); if (!m) return; text.value = ''; go(m);
  }
  send.addEventListener('click', submit);
  text.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); submit(); } });
  Array.prototype.forEach.call(document.querySelectorAll('.quick button[data-msg]'), function(b){
    b.addEventListener('click', function(){ go(b.getAttribute('data-msg')); });
  });
})();
</` + `script>` + FOOT(mode) + `</body></html>`;
}

// ---------- memory receipts ----------
export function memoryPage({ user, mode, rows, agentShort }) {
  const items = rows.length
    ? rows.map((r) => {
        const bid = r.blob_id
          ? (String(r.blob_id).startsWith('local-') || mode === 'local'
            ? `<span class="bid loc" title="local demo id &#8212; never a Mainnet blob">LOCAL DEMO ${esc(String(r.blob_id).slice(0, 14))}&hellip;</span>`
            : `<a class="bid" href="https://walruscan.com/mainnet/blob/${esc(r.blob_id)}" target="_blank" rel="noopener" title="verify on walruscan">${esc(String(r.blob_id).slice(0, 12))}&hellip; &#8599;</a>`)
          : '';
        return `<li><span class="fact">${esc(r.text)}</span>${bid}</li>`;
      }).join('')
    : `<li><span class="fact"><i>Nothing remembered yet &#8212; say hi in the <a href="/">chat</a>.</i></span></li>`;
  const notice = mode === 'mainnet'
    ? `<div class="notice mainnet">All memory below is stored on <b>Walrus Mainnet</b> via Walrus Memory (Seal-encrypted). Every row links to its blob on walruscan &#8212; verify, don't trust.${agentShort ? ` Agent: <code>${esc(agentShort)}&hellip;</code>` : ''}</div>`
    : `<div class="notice local"><b>LOCAL DEMO</b> &#8212; file-backed stand-in memory, not Walrus Mainnet. The Mainnet path runs when MEMWAL_MODE=mainnet is set with keys.</div>`;
  return TOP('DoseDaughter — memory', mode) + `
<div class="wrap">
  <h1 class="pg">What DoseDaughter remembers &#8212; <code>${esc(user)}</code></h1>
  <p class="sub">${rows.length} fact${rows.length === 1 ? '' : 's'} &middot; recalled live from memory &middot; <a href="/">back to chat</a></p>
  ${notice}
  <ul class="receipts">${items}</ul>
</div>` + FOOT(mode) + `</body></html>`;
}

// ---------- before/after demo ----------
export function demoPage({ q, mode, before, after, afterNs, day7Empty }) {
  const list = (arr, cls) => arr.length
    ? `<ul>${arr.map((m) => `<li>${esc(m.text)}<small>${esc(String(m.blob_id || '').slice(0, 12))}</small></li>`).join('')}</ul>`
    : `<ul><li class="none">no memories &#8212; generic answer, Day-1 amnesia</li></ul>`;
  return TOP('DoseDaughter — before/after', mode) + `
<div class="wrap">
  <h1 class="pg">Day 1 vs Day 7 &#8212; the same question, live recall</h1>
  <p class="sub">Both namespaces are queried live right now (mode: ${esc(mode)}). <a href="/">back to chat</a></p>
  <div class="qline">Q: &ldquo;${esc(q)}&rdquo;</div>
  <div class="two">
    <div class="panel dcard before"><div style="padding:14px">
      <h3>&#10005; BEFORE &#8212; Day 1 (never met you)</h3>
      <div class="count">${before.length} memor${before.length === 1 ? 'y' : 'ies'} in namespace <code>user-demo-day1</code></div>
      ${list(before)}
    </div></div>
    <div class="panel dcard after"><div style="padding:14px">
      <h3>&#10003; AFTER &#8212; Day 7 (remembers everything)</h3>
      <div class="count">${after.length} memor${after.length === 1 ? 'y' : 'ies'} in namespace <code>${esc(afterNs || 'user-demo-day7')}</code></div>
      ${list(after)}${day7Empty ? '<p class="sub"><i>Day-7 namespace is empty &#8212; teach it in the <a href="/">chat</a> as user <code>demo-day7</code>, then reload.</i></p>' : ''}
    </div></div>
  </div>
  <footer class="foot">This page runs <b>live recall</b> against both Walrus Memory namespaces &#8212; nothing is faked or cached.</footer>
</div>` + FOOT(mode) + `</body></html>`;
}
