/* Shared DOM helpers, formatting, toasts, modals, skeletons, sparkline. */

export function qs(sel, root) { return (root || document).querySelector(sel); }
export function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Create an element. attrs: class, text, html, type, placeholder, value, etc. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function money(cents) {
  const v = (Number(cents) || 0) / 100;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function formatViews(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M views';
  if (v >= 1_000) return (v / 1_000).toFixed(v >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'K views';
  return v + ' view' + (v === 1 ? '' : 's');
}

export function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' day' + (Math.floor(s / 86400) === 1 ? '' : 's') + ' ago';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatUtc(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const CADENCE_LABEL = {
  daily: 'Every day',
  every_2_days: 'Every 2 days',
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
};

/* Inline form/list error. Pass null to clear. */
export function setError(container, msg) {
  if (!container) return;
  if (msg) {
    container.textContent = msg;
    container.hidden = false;
  } else {
    container.textContent = '';
    container.hidden = true;
  }
}

/* Toasts */
let toastWrap = null;
export function toast(message, kind = 'info', ms = 5000) {
  if (!toastWrap) {
    toastWrap = el('div', { class: 'toast-wrap', 'aria-live': 'polite' });
    document.body.appendChild(toastWrap);
  }
  const t = el('div', { class: `toast toast-${kind}`, role: 'status' }, [
    el('span', { class: 'toast-msg', text: message }),
    el('button', { class: 'toast-x', type: 'button', 'aria-label': 'Dismiss', text: '×', onclick: () => t.remove() }),
  ]);
  toastWrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast-in'));
  setTimeout(() => { t.classList.remove('toast-in'); setTimeout(() => t.remove(), 300); }, ms);
  return t;
}

/* Modal (single dialog element per page, driven by data attributes) */
export function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add('modal-open');
  document.body.classList.add('modal-lock');
  const first = m.querySelector('input:not([type=hidden])');
  if (first) setTimeout(() => first.focus(), 60);
}
export function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove('modal-open');
  document.body.classList.remove('modal-lock');
}
export function wireModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  qsa('[data-close-modal]', m).forEach((b) => b.addEventListener('click', () => closeModal(id)));
  m.addEventListener('click', (e) => { if (e.target === m) closeModal(id); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && m.classList.contains('modal-open')) closeModal(id); });
}

/* Skeletons */
export function skeletons(count, cls) {
  const wrap = document.createDocumentFragment();
  for (let i = 0; i < count; i++) wrap.appendChild(el('div', { class: `skeleton ${cls || ''}` }));
  return wrap;
}

export function emptyState(title, sub) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'empty-title', text: title }),
    sub ? el('div', { class: 'empty-sub', text: sub }) : null,
  ]);
}

/* Status pill for a video. */
export function statusPill(status) {
  const map = {
    queued: ['pill pill-queued', 'Queued'],
    rendering: ['pill pill-rendering', 'Rendering'],
    uploaded: ['pill pill-uploaded', 'Uploaded'],
    failed: ['pill pill-failed', 'Failed'],
  };
  const [cls, label] = map[status] || ['pill', status || 'Unknown'];
  const pill = el('span', { class: cls });
  if (status === 'uploaded') {
    pill.appendChild(el('span', { class: 'pill-play', html: '<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>' }));
  }
  pill.appendChild(document.createTextNode(label));
  return pill;
}

/* 14-day bar row from by_day. Plain divs, height scaled to the max. */
export function renderSparkline(container, byDay) {
  container.replaceChildren();
  const days = (byDay || []).slice(-14);
  if (!days.length) {
    container.appendChild(emptyState('No earnings yet', 'Published videos will start reporting here.'));
    return;
  }
  const max = Math.max(...days.map((d) => d.cents || 0), 1);
  const row = el('div', { class: 'spark', role: 'img', 'aria-label': 'Daily estimated earnings, last 14 days' });
  for (const d of days) {
    const cents = d.cents || 0;
    const h = Math.max(4, Math.round((cents / max) * 72));
    const isPeak = cents > 0 && cents === max;
    row.appendChild(el('div', {
      class: 'spark-bar' + (isPeak ? ' spark-hot spark-peak' : cents > 0 ? ' spark-hot' : ''),
      style: `height:${h}%`,
      title: `${d.date}: ${money(cents)}`,
    }));
  }
  container.appendChild(row);
  const labels = el('div', { class: 'spark-labels' });
  labels.appendChild(el('span', { text: days[0] ? days[0].date.slice(5) : '' }));
  labels.appendChild(el('span', { text: days.length ? days[days.length - 1].date.slice(5) : '' }));
  container.appendChild(labels);
}

/* Video thumbnail: real image when we have one, rainbow placeholder otherwise. */
export function videoThumb(v) {
  if (v.thumbnail_url) {
    return el('div', { class: 'vthumb' }, [
      el('img', { src: v.thumbnail_url, alt: '', loading: 'lazy' }),
    ]);
  }
  return el('div', { class: 'vthumb vthumb-rainbow' }, [
    el('span', { class: 'vthumb-play', html: '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M8 5v14l11-7z" fill="#fff"/></svg>' }),
  ]);
}
