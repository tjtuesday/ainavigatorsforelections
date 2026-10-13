/*
  Ready for Tuesday review layer
  Drop onto any page. Reviewers highlight text and leave a comment.
  Comments stay on their own computer and browser, and go to a Google Sheet.
  Remove the script tag when the page goes live.

  Install:  <script src="review.js" data-sheet="https://script.google.com/macros/s/.../exec" data-project="Day One"></script>
  Or set    window.R4T_REVIEW = { sheet: "...", project: "..." } before loading.
*/
(function () {
  'use strict';
  if (window.R4TReview) { return; }

  /* ---------- config ---------- */
  var script = document.currentScript || document.querySelector('script[data-sheet], script[src*="review.js"]');
  var opt = window.R4T_REVIEW || {};
  var cfg = {
    sheet: opt.sheet || (script && script.getAttribute('data-sheet')) || '',
    project: opt.project || (script && script.getAttribute('data-project')) || document.title || location.pathname
  };
  var pageUrl = location.origin + location.pathname;
  var KEY = 'r4t-review:' + pageUrl;
  var KEY_QUEUE = KEY + ':queue';
  var KEY_NAME = 'r4t-review:name';
  var KEY_OFF = 'r4t-review:off';

  /* ---------- storage ---------- */
  function read(k, fallback) { try { var v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var items = read(KEY, []);
  var queue = read(KEY_QUEUE, []);
  var reviewer = read(KEY_NAME, '');
  var off = read(KEY_OFF, false);
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /* ---------- text index: every visible text node, in order ---------- */
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TEXTAREA: 1 };
  function buildIndex() {
    var entries = [], full = '';
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        for (var p = n.parentNode; p && p !== document.body; p = p.parentNode) {
          if (SKIP[p.nodeName] || p === host) { return NodeFilter.FILTER_REJECT; }
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      entries.push({ node: n, start: full.length, end: full.length + n.data.length });
      full += n.data;
    }
    return { entries: entries, full: full };
  }
  function posOf(idx, container, offset) {
    var i, e;
    if (container.nodeType === 3) {
      for (i = 0; i < idx.entries.length; i++) { if (idx.entries[i].node === container) { return idx.entries[i].start + offset; } }
      return null;
    }
    var child = container.childNodes[offset];
    if (!child) {
      for (i = idx.entries.length - 1; i >= 0; i--) { if (container.contains(idx.entries[i].node)) { return idx.entries[i].end; } }
      return 0;
    }
    for (i = 0; i < idx.entries.length; i++) {
      e = idx.entries[i].node;
      if (child === e || child.contains(e)) { return idx.entries[i].start; }
      if (child.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) { return idx.entries[i].start; }
    }
    return idx.full.length;
  }
  function describe(range) {
    var idx = buildIndex();
    var s = posOf(idx, range.startContainer, range.startOffset);
    var e = posOf(idx, range.endContainer, range.endOffset);
    if (s == null || e == null || e <= s) { return null; }
    var quote = idx.full.slice(s, e);
    if (!quote.trim()) { return null; }
    return { quote: quote, prefix: idx.full.slice(Math.max(0, s - 40), s), suffix: idx.full.slice(e, e + 40) };
  }
  function overlap(a, b, fromEnd) {
    var n = 0, max = Math.min(a.length, b.length);
    while (n < max) {
      var ca = fromEnd ? a[a.length - 1 - n] : a[n];
      var cb = fromEnd ? b[b.length - 1 - n] : b[n];
      if (ca !== cb) { break; }
      n++;
    }
    return n;
  }
  function locate(idx, it) {
    var hits = [], i = idx.full.indexOf(it.quote);
    while (i !== -1) { hits.push(i); i = idx.full.indexOf(it.quote, i + 1); }
    if (!hits.length) { return -1; }
    if (hits.length === 1) { return hits[0]; }
    var best = -1, bestScore = -1;
    for (var h = 0; h < hits.length; h++) {
      var s = hits[h], e = s + it.quote.length;
      var score = overlap(idx.full.slice(Math.max(0, s - 40), s), it.prefix || '', true) + overlap(idx.full.slice(e, e + 40), it.suffix || '', false);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }
  function wrap(start, end, it) {
    var idx = buildIndex(), marks = [];
    for (var i = 0; i < idx.entries.length; i++) {
      var en = idx.entries[i];
      if (en.end <= start || en.start >= end) { continue; }
      var node = en.node, a = Math.max(start, en.start) - en.start, b = Math.min(end, en.end) - en.start;
      if (b <= a) { continue; }
      var target = node;
      if (a > 0) { target = node.splitText(a); }
      if (b - a < target.data.length) { target.splitText(b - a); }
      var m = document.createElement('mark');
      m.className = 'r4t-hl' + (it.mine === false ? ' r4t-team' : '');
      m.setAttribute('data-r4t', it.id);
      m.title = (it.name ? it.name + ': ' : '') + it.comment;
      target.parentNode.insertBefore(m, target);
      m.appendChild(target);
      marks.push(m);
    }
    return marks;
  }
  function unwrap(id) {
    var marks = document.querySelectorAll('mark.r4t-hl[data-r4t="' + id + '"]');
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i], p = m.parentNode;
      while (m.firstChild) { p.insertBefore(m.firstChild, m); }
      p.removeChild(m);
      p.normalize();
    }
  }
  function paint(it) {
    var idx = buildIndex();
    var s = locate(idx, it);
    if (s < 0) { it.orphan = true; return; }
    it.orphan = false;
    wrap(s, s + it.quote.length, it);
  }
  function sectionFor(node) {
    var el = node.nodeType === 3 ? node.parentNode : node;
    var heads = document.querySelectorAll('h1, h2, h3, h4'), best = '';
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      if (h === el || h.contains(el) || (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) { best = (h.textContent || '').trim().slice(0, 80); }
      else { break; }
    }
    return best;
  }

  /* ---------- the sheet ---------- */
  function post(payload) {
    if (!cfg.sheet) { return Promise.resolve(false); }
    try {
      return fetch(cfg.sheet, { method: 'POST', mode: 'no-cors', cache: 'no-store', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
        .then(function () { return true; }, function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  function payloadFor(it, action) {
    return { action: action || 'add', id: it.id, ts: it.ts, project: cfg.project, page: document.title, url: pageUrl, section: it.section || '', quote: it.quote, comment: it.comment, name: it.name || '' };
  }
  function enqueue(p) { queue.push(p); write(KEY_QUEUE, queue); flush(); }
  var flushing = false;
  function flush() {
    if (flushing || !queue.length || !cfg.sheet) { renderBar(); return; }
    flushing = true;
    var p = queue[0];
    post(p).then(function (ok) {
      flushing = false;
      if (ok) {
        queue.shift(); write(KEY_QUEUE, queue);
        for (var i = 0; i < items.length; i++) { if (items[i].id === p.id && p.action === 'add') { items[i].sent = true; } }
        write(KEY, items);
        flush();
      } else { renderBar(); }
    });
  }
  function loadTeam() {
    if (!cfg.sheet) { toast('No sheet is set up for this page.'); return; }
    toast('Loading team comments\u2026');
    fetch(cfg.sheet + (cfg.sheet.indexOf('?') > -1 ? '&' : '?') + 'url=' + encodeURIComponent(pageUrl), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var rows = (data && data.rows) || [], added = 0, have = {};
        items.forEach(function (it) { have[it.id] = true; });
        rows.forEach(function (r) {
          if (!r.id || have[r.id] || r.status === 'deleted') { return; }
          var it = { id: r.id, ts: r.ts || Date.now(), name: r.name || '', quote: r.quote || '', prefix: '', suffix: '', comment: r.comment || '', section: r.section || '', sent: true, mine: false };
          if (!it.quote) { return; }
          items.push(it); paint(it); added++;
        });
        write(KEY, items); renderBar();
        toast(added ? 'Loaded ' + added + ' comment' + (added === 1 ? '' : 's') + ' from the team.' : 'Nothing new from the team.');
      })
      .catch(function () { toast('Could not reach the sheet. Check the deployment allows "Anyone" and that it has a doGet.'); });
  }

  /* ---------- light-DOM styles for highlights ---------- */
  var style = document.createElement('style');
  style.id = 'r4t-review-style';
  style.textContent =
    'mark.r4t-hl{background:rgba(232,93,4,.22);color:inherit;border-bottom:2px solid #e85d04;cursor:pointer;padding:0;border-radius:0;}' +
    'mark.r4t-hl.r4t-team{background:rgba(119,147,129,.22);border-bottom-color:#779381;}' +
    'mark.r4t-hl.r4t-active{background:rgba(232,93,4,.42);}' +
    'html.r4t-off mark.r4t-hl{background:transparent;border-bottom:0;cursor:inherit;}';
  document.head.appendChild(style);

  /* ---------- shadow UI ---------- */
  var host = document.createElement('div');
  host.id = 'r4t-review';
  host.setAttribute('style', 'position:absolute;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483646;');
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML =
    '<style>' +
    ':host{all:initial;}' +
    '*{box-sizing:border-box;}' +
    '.ui{font-family:"Barlow","Helvetica Neue",Arial,sans-serif;font-size:15px;line-height:1.4;color:#413b3e;}' +
    'button{font:inherit;cursor:pointer;}' +
    '.pill{position:fixed;right:16px;bottom:16px;display:flex;align-items:center;gap:8px;background:#1d4b2f;color:#fff;border:0;border-radius:999px;padding:9px 14px 9px 16px;font-weight:600;box-shadow:0 6px 20px rgba(0,25,15,.3);}' +
    '.pill b{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:#e85d04;color:#fff;font-weight:700;font-size:13px;}' +
    '.pill.off{background:#779381;}' +
    '.menu{position:fixed;right:16px;bottom:62px;width:min(300px,calc(100vw - 32px));background:#fff;border:1px solid #d1dbd6;border-top:4px solid #1d4b2f;box-shadow:0 14px 40px rgba(0,25,15,.22);padding:14px;display:none;}' +
    '.menu.open{display:block;}' +
    '.menu label{display:block;font-size:13px;color:#55645c;margin:0 0 4px;}' +
    '.menu input{width:100%;font:inherit;padding:7px 9px;border:1px solid #d1dbd6;margin:0 0 12px;}' +
    '.menu .row{display:flex;flex-wrap:wrap;gap:6px;}' +
    '.menu button{background:#f0f4f2;color:#1d4b2f;border:1px solid #d1dbd6;padding:6px 10px;font-weight:600;font-size:13px;}' +
    '.menu button:hover{border-color:#1d4b2f;}' +
    '.menu .danger{color:#9b2c0a;}' +
    '.menu p{margin:10px 0 0;font-size:13px;color:#55645c;}' +
    '.go{position:absolute;background:#e85d04;color:#fff;border:0;border-radius:999px;padding:6px 12px;font-weight:600;font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,.25);display:none;white-space:nowrap;}' +
    '.go.show{display:block;}' +
    '.card{position:absolute;width:min(360px,calc(100vw - 24px));background:#fff;border:1px solid #d1dbd6;border-left:4px solid #e85d04;box-shadow:0 14px 40px rgba(0,25,15,.22);padding:14px 16px 16px;display:none;}' +
    '.card.show{display:block;}' +
    '.card q{display:block;quotes:none;font-style:italic;color:#55645c;margin:0 0 10px;max-height:5.6em;overflow:hidden;}' +
    '.card textarea{width:100%;min-height:84px;font:inherit;padding:8px 10px;border:1px solid #d1dbd6;resize:vertical;margin:0 0 8px;}' +
    '.card input{width:100%;font:inherit;padding:7px 10px;border:1px solid #d1dbd6;margin:0 0 10px;}' +
    '.card .who{font-size:13px;color:#55645c;margin:0 0 6px;}' +
    '.card .body{white-space:pre-wrap;margin:0 0 12px;}' +
    '.card .actions{display:flex;gap:8px;align-items:center;}' +
    '.card .save{background:#1d4b2f;color:#fff;border:0;padding:8px 14px;font-weight:600;}' +
    '.card .save:hover{background:#00190f;}' +
    '.card .cancel{background:#fff;color:#1d4b2f;border:1px solid #d1dbd6;padding:8px 12px;}' +
    '.card .del{margin-left:auto;background:none;border:0;color:#9b2c0a;text-decoration:underline;padding:4px 0;font-size:13px;}' +
    '.card .status{font-size:12px;color:#55645c;margin:8px 0 0;}' +
    '.toast{position:fixed;left:50%;bottom:72px;transform:translateX(-50%);background:#00190f;color:#fff;padding:9px 14px;border-radius:4px;font-size:14px;display:none;max-width:calc(100vw - 32px);}' +
    '.toast.show{display:block;}' +
    ':focus-visible{outline:3px solid #e85d04;outline-offset:2px;}' +
    '@media (prefers-reduced-motion:no-preference){.card.show{animation:up .18s ease-out;}@keyframes up{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:none;}}}' +
    '</style>' +
    '<div class="ui">' +
    '<button class="go" type="button">Comment</button>' +
    '<div class="card" role="dialog" aria-label="Comment"></div>' +
    '<div class="menu"></div>' +
    '<button class="pill" type="button" aria-expanded="false"><span class="pill-text">Review</span><b class="count">0</b></button>' +
    '<div class="toast" role="status"></div>' +
    '</div>';
  var ui = {
    go: root.querySelector('.go'), card: root.querySelector('.card'), menu: root.querySelector('.menu'),
    pill: root.querySelector('.pill'), count: root.querySelector('.count'), pillText: root.querySelector('.pill-text'), toast: root.querySelector('.toast')
  };
  function mount() { document.body.appendChild(host); items.forEach(paint); write(KEY, items); if (off) { document.documentElement.classList.add('r4t-off'); } renderBar(); flush(); }

  var toastTimer;
  function toast(msg) { ui.toast.textContent = msg; ui.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { ui.toast.classList.remove('show'); }, 3200); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- the pill and menu ---------- */
  function renderBar() {
    var mine = items.filter(function (i) { return i.mine !== false; });
    ui.count.textContent = String(mine.length);
    ui.pill.classList.toggle('off', off);
    ui.pillText.textContent = off ? 'Review off' : 'Review';
    var unsent = queue.length;
    ui.menu.innerHTML =
      '<label for="rn">Your name (goes with each comment)</label><input id="rn" type="text" value="' + esc(reviewer) + '" placeholder="First name is fine">' +
      '<div class="row">' +
      '<button type="button" data-act="toggle">' + (off ? 'Turn review on' : 'Turn review off') + '</button>' +
      (cfg.sheet ? '<button type="button" data-act="team">Load team comments</button>' : '') +
      (unsent ? '<button type="button" data-act="flush">Send ' + unsent + ' unsent</button>' : '') +
      '<button type="button" data-act="download">Download mine</button>' +
      '<button type="button" class="danger" data-act="clear">Clear this device</button>' +
      '</div>' +
      '<p>' + (cfg.sheet ? 'Comments go to the sheet and stay in this browser.' : 'No sheet set. Comments stay in this browser only.') + (unsent ? ' ' + unsent + ' not sent yet.' : '') + '</p>';
    var inp = ui.menu.querySelector('#rn');
    inp.addEventListener('change', function () { reviewer = inp.value.trim(); write(KEY_NAME, reviewer); });
    ui.menu.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-act');
        if (act === 'toggle') { off = !off; write(KEY_OFF, off); document.documentElement.classList.toggle('r4t-off', off); closeCard(); renderBar(); }
        if (act === 'team') { loadTeam(); }
        if (act === 'flush') { flush(); }
        if (act === 'download') { download(); }
        if (act === 'clear') {
          if (confirm('Remove every comment and highlight saved in this browser for this page? The sheet keeps its copy.')) {
            items.slice().forEach(function (it) { unwrap(it.id); }); items = []; write(KEY, items); renderBar(); toast('Cleared.');
          }
        }
      });
    });
  }
  function download() {
    var mine = items.filter(function (i) { return i.mine !== false; }).map(function (i) { return payloadFor(i); });
    var blob = new Blob([JSON.stringify(mine, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'review-' + (document.title || 'page').replace(/[^\w]+/g, '-').slice(0, 40) + '.json';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  ui.pill.addEventListener('click', function () { var open = ui.menu.classList.toggle('open'); ui.pill.setAttribute('aria-expanded', String(open)); if (open) { closeCard(); } });

  /* ---------- selection -> Comment button ---------- */
  var lastRange = null, lastRect = null, cardOpen = false, selTimer;
  function inHost(node) { for (var p = node; p; p = p.parentNode) { if (p === host) { return true; } } return false; }
  function onSelect() {
    if (off || cardOpen) { return; }
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { ui.go.classList.remove('show'); return; }
    var r = sel.getRangeAt(0);
    if (!document.body.contains(r.commonAncestorContainer) || inHost(r.commonAncestorContainer) || !r.toString().trim()) { ui.go.classList.remove('show'); return; }
    lastRange = r.cloneRange();
    var rect = r.getBoundingClientRect();
    lastRect = { top: rect.top + window.scrollY, left: rect.left + window.scrollX, right: rect.right + window.scrollX, bottom: rect.bottom + window.scrollY, width: rect.width };
    ui.go.style.top = (lastRect.top - 38) + 'px';
    ui.go.style.left = Math.max(8, Math.min(lastRect.right - 90, window.scrollX + document.documentElement.clientWidth - 110)) + 'px';
    ui.go.classList.add('show');
  }
  document.addEventListener('selectionchange', function () { clearTimeout(selTimer); selTimer = setTimeout(onSelect, 120); });
  ui.go.addEventListener('mousedown', function (e) { e.preventDefault(); });
  ui.go.addEventListener('click', function () {
    if (!lastRange) { return; }
    var d = describe(lastRange);
    if (!d) { toast('Could not read that selection. Try selecting plain text.'); return; }
    openWrite(d, lastRange, lastRect);
  });

  /* ---------- the card ---------- */
  function placeCard(rect) {
    var maxLeft = window.scrollX + document.documentElement.clientWidth - Math.min(360, document.documentElement.clientWidth - 24) - 12;
    ui.card.style.left = Math.max(12, Math.min(rect.left, maxLeft)) + 'px';
    ui.card.style.top = (rect.bottom + 10) + 'px';
    ui.card.classList.add('show');
    cardOpen = true;
    ui.go.classList.remove('show');
    ui.menu.classList.remove('open');
  }
  function closeCard() {
    ui.card.classList.remove('show'); ui.card.innerHTML = ''; cardOpen = false;
    document.querySelectorAll('mark.r4t-active').forEach(function (m) { m.classList.remove('r4t-active'); });
  }
  function openWrite(d, range, rect) {
    ui.card.innerHTML =
      '<q>' + esc(d.quote.length > 180 ? d.quote.slice(0, 180) + '\u2026' : d.quote) + '</q>' +
      '<textarea placeholder="What should change here?" aria-label="Comment"></textarea>' +
      '<input type="text" placeholder="Your name" aria-label="Your name" value="' + esc(reviewer) + '">' +
      '<div class="actions"><button type="button" class="save">Save comment</button><button type="button" class="cancel">Cancel</button></div>';
    placeCard(rect);
    var ta = ui.card.querySelector('textarea'), nm = ui.card.querySelector('input');
    setTimeout(function () { ta.focus(); }, 30);
    ui.card.querySelector('.cancel').addEventListener('click', closeCard);
    ui.card.querySelector('.save').addEventListener('click', function () {
      var text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      reviewer = nm.value.trim(); write(KEY_NAME, reviewer);
      var it = { id: uid(), ts: Date.now(), name: reviewer, quote: d.quote, prefix: d.prefix, suffix: d.suffix, comment: text, section: sectionFor(range.startContainer), sent: false, mine: true };
      items.push(it); write(KEY, items);
      try { window.getSelection().removeAllRanges(); } catch (e) {}
      paint(it);
      closeCard(); renderBar();
      enqueue(payloadFor(it, 'add'));
      toast(cfg.sheet ? 'Saved. Sending to the sheet.' : 'Saved in this browser.');
    });
    ta.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { ui.card.querySelector('.save').click(); } if (e.key === 'Escape') { closeCard(); } });
  }
  function openRead(id, mark) {
    var it = null;
    for (var i = 0; i < items.length; i++) { if (items[i].id === id) { it = items[i]; } }
    if (!it) { return; }
    document.querySelectorAll('mark.r4t-hl[data-r4t="' + id + '"]').forEach(function (m) { m.classList.add('r4t-active'); });
    var when = new Date(it.ts);
    var status = it.mine === false ? 'From the team sheet.' : (it.sent ? 'Sent to the sheet.' : (cfg.sheet ? 'Not sent yet. It will retry.' : 'Saved in this browser only.'));
    ui.card.innerHTML =
      '<q>' + esc(it.quote.length > 180 ? it.quote.slice(0, 180) + '\u2026' : it.quote) + '</q>' +
      '<p class="who">' + esc(it.name || 'Unnamed') + ', ' + when.toLocaleDateString() + (it.section ? ', in \u201c' + esc(it.section) + '\u201d' : '') + '</p>' +
      '<p class="body">' + esc(it.comment) + '</p>' +
      '<div class="actions"><button type="button" class="cancel">Close</button>' + (it.mine !== false ? '<button type="button" class="del">Delete this comment</button>' : '') + '</div>' +
      '<p class="status">' + status + '</p>';
    var r = mark.getBoundingClientRect();
    placeCard({ left: r.left + window.scrollX, bottom: r.bottom + window.scrollY });
    ui.card.querySelector('.cancel').addEventListener('click', closeCard);
    var del = ui.card.querySelector('.del');
    if (del) {
      del.addEventListener('click', function () {
        unwrap(id); items = items.filter(function (x) { return x.id !== id; }); write(KEY, items);
        queue = queue.filter(function (q) { return !(q.id === id && q.action === 'add'); }); write(KEY_QUEUE, queue);
        if (it.sent) { enqueue({ action: 'delete', id: id, url: pageUrl, project: cfg.project }); }
        closeCard(); renderBar(); toast('Deleted.');
      });
    }
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    var m = t && t.closest ? t.closest('mark.r4t-hl') : null;
    if (m && !off) { e.preventDefault(); openRead(m.getAttribute('data-r4t'), m); return; }
    if (cardOpen && !inHost(t)) {
      var w = ui.card.querySelector('textarea');
      if (!w || !w.value.trim()) { closeCard(); }
    }
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cardOpen) { closeCard(); } });

  /* ---------- go ---------- */
  if (document.body) { mount(); } else { document.addEventListener('DOMContentLoaded', mount); }
  window.R4TReview = { items: function () { return items.slice(); }, flush: flush, loadTeam: loadTeam, version: '1.0' };
})();
