/* ChromaTube page controller. Boots the landing page or the dashboard
   depending on <body data-page>. Imports api/ui/odometer modules. */

import { Api, ApiError } from './api.js';
import {
  qs, qsa, el, money, formatViews, timeAgo, formatUtc,
  CADENCE_LABEL, setError, toast, openModal, closeModal, wireModal,
  skeletons, emptyState, statusPill, renderSparkline, videoThumb,
} from './ui.js';
import { Odometer } from './odometer.js';

const FALLBACK_PACKS = [
  { id: 'starter', name: 'Starter', credits: 20, price_cents: 1900 },
  { id: 'creator', name: 'Creator', credits: 60, price_cents: 4900 },
  { id: 'studio', name: 'Studio', credits: 150, price_cents: 9900 },
];

const POLL_MS = 15000;

/* Login-method experiment (backend: src/experiments.js). The server assigns a
   sticky variant on first load; ct_ab_force pins the pitch for manual checks
   and e2e. Variant decides the connect form's pitch:
     'password' — password pane first (cookie tab as fallback)
     'cookie'   — cookie pane only
     'any'      — control: current managed/cookie tabs */
const AB_FORCE_KEY = 'ct_ab_force';
let AB_VARIANT = 'any';

function abVariant() {
  const forced = localStorage.getItem(AB_FORCE_KEY);
  return forced === 'password' || forced === 'cookie' || forced === 'any' ? forced : AB_VARIANT;
}

async function loadAssignment() {
  try {
    const data = await Api.experimentAssignment();
    if (data && data.variant) AB_VARIANT = data.variant;
  } catch (err) { /* control pitch when the store is unreachable */ }
}

/* ---------------- Landing page ---------------- */

function bootLanding() {
  loadAssignment(); // fire-and-forget: assignment is recorded even if the user bounces
  wireModal('auth-modal');
  renderPricing();
  wireAuthTabs();
  wireAuthForms();
  wirePasswordToggles();
  wireLandingNav();
  wireHeroOdometer();
}

/* The hero counter is a real odometer, the same one the dashboard uses. */
function wireHeroOdometer() {
  const hero = qs('#hero-odometer');
  if (!hero) return;
  const od = new Odometer(hero);
  const steps = [0, 12.4, 156.75, 980.5, 2437.8];
  let i = 0;
  od.setCents(0);
  const tick = () => {
    i += 1;
    if (i < steps.length) {
      od.setCents(Math.round(steps[i] * 100));
      setTimeout(tick, 1400);
    }
  };
  setTimeout(tick, 1600);
}

function wireLandingNav() {
  qsa('[data-open-auth]').forEach((btn) => {
    btn.addEventListener('click', () => {
      // Static mirror deploy (GitHub Pages): the API lives on the app origin,
      // so send the visitor there instead of opening the local modal.
      if (window.CHROMATUBE_OFFICIAL) {
        window.location.href = `${window.CHROMATUBE_OFFICIAL}/app.html`;
        return;
      }
      const tab = btn.getAttribute('data-open-auth') || 'signup';
      selectAuthTab(tab);
      openModal('auth-modal');
    });
  });
  const seeHow = qs('[data-scroll-how]');
  if (seeHow) seeHow.addEventListener('click', () => {
    const target = qs('#how');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function wireAuthTabs() {
  qsa('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => selectAuthTab(tab.getAttribute('data-tab')));
  });
  qsa('.auth-switch-link').forEach((link) => {
    link.addEventListener('click', () => selectAuthTab(link.getAttribute('data-tab')));
  });
}

const AUTH_COPY = {
  signup: {
    title: 'Create your account',
    sub: 'Type a video idea, pick a schedule — ChromaTube runs the rest.',
    other: 'login',
    switchText: 'Already have an account?',
    switchLabel: 'Log in',
  },
  login: {
    title: 'Welcome back',
    sub: 'Log in to your channel, your schedule and your credits.',
    other: 'signup',
    switchText: 'New here?',
    switchLabel: 'Create an account',
  },
};

function selectAuthTab(name) {
  const copy = AUTH_COPY[name] || AUTH_COPY.signup;
  const title = qs('#auth-title');
  const sub = qs('#auth-sub');
  if (title) title.textContent = copy.title;
  if (sub) sub.textContent = copy.sub;
  qsa('.auth-tab').forEach((t) => t.classList.toggle('active', t.getAttribute('data-tab') === name));
  // The footer link always offers the OTHER pane, ChatGPT/Claude style.
  qsa('.auth-switch-text').forEach((s) => { s.textContent = copy.switchText; });
  qsa('.auth-switch-link').forEach((l) => {
    l.setAttribute('data-tab', copy.other);
    l.textContent = copy.switchLabel;
  });
  qsa('.auth-pane').forEach((p) => { p.hidden = p.getAttribute('data-pane') !== name; });
}

/* Show/Hide for password fields. Visible text + aria-pressed per the
   accessible show-password pattern; refocus the field so typing continues. */
function wirePasswordToggles() {
  qsa('.pwd-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement && btn.parentElement.querySelector('input');
      if (!input) return;
      const showing = input.type === 'password';
      input.type = showing ? 'text' : 'password';
      btn.textContent = showing ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', showing ? 'true' : 'false');
      btn.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
      input.focus({ preventScroll: true });
    });
  });
}

/* No session (or an ended one): open the auth card in place instead of
   bouncing to the landing page. Context banner explains WHY:
   ?credits=0 is the PayPal cancel_url (src/routes/checkout.js). */
function showAuthGate() {
  if (dash.authGateShown) return;
  dash.authGateShown = true;
  const params = new URLSearchParams(window.location.search);
  const banner = qs('#auth-banner');
  if (banner) {
    banner.hidden = false;
    banner.textContent = params.get('credits') === '0'
      ? 'Your checkout was cancelled and you have not been charged. Log in or sign up to finish buying credits.'
      : 'Your session has ended. Log in to get back to your dashboard.';
  }
  selectAuthTab('login');
  openModal('auth-modal');
}

function wireAuthForms() {
  const signupForm = qs('#signup-form');
  const loginForm = qs('#login-form');

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError(qs('#signup-error'), null);
    const btn = signupForm.querySelector('button[type=submit]');
    const original = btn.textContent;
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.textContent = 'Creating your account…';
    try {
      const email = qs('#signup-email').value.trim();
      const password = qs('#signup-password').value;
      if (!email || !password) throw new ApiError('Enter an email and a password.', 400);
      await Api.signup(email, password);
      try { await Api.login(email, password); } catch (err) { /* session may already be set by signup */ }
      window.location.href = '/app.html' + window.location.search;
    } catch (err) {
      setError(qs('#signup-error'), err.message || 'Sign up failed. Try again.');
      btn.disabled = false;
      btn.classList.remove('is-loading');
      btn.textContent = original;
    }
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError(qs('#login-error'), null);
    const btn = loginForm.querySelector('button[type=submit]');
    const original = btn.textContent;
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.textContent = 'Logging in…';
    try {
      const email = qs('#login-email').value.trim();
      const password = qs('#login-password').value;
      if (!email || !password) throw new ApiError('Enter an email and a password.', 400);
      await Api.login(email, password);
      window.location.href = '/app.html' + window.location.search;
    } catch (err) {
      setError(
        qs('#login-error'),
        err.status === 401
          ? 'That email and password do not match. Try again, or switch to Sign up to create an account.'
          : (err.message || 'Log in failed. Try again.')
      );
      btn.disabled = false;
      btn.classList.remove('is-loading');
      btn.textContent = original;
    }
  });
}

async function renderPricing() {
  const grid = qs('#pricing-grid');
  if (!grid) return;
  grid.replaceChildren(skeletons(3, 'skel-card'));
  let packs = null;
  let usedFallback = false;
  try {
    const data = await Api.catalog();
    packs = data && Array.isArray(data.packs) && data.packs.length ? data.packs : null;
  } catch (err) { /* fall through to fallback */ }
  if (!packs) { packs = FALLBACK_PACKS; usedFallback = true; }

  grid.replaceChildren();
  for (const pack of packs) {
    const perVideo = pack.credits > 0 ? Math.round(pack.price_cents / pack.credits) : null;
    grid.appendChild(el('div', { class: 'pack' }, [
      el('div', { class: 'pack-name', text: pack.name || pack.id }),
      el('div', { class: 'pack-credits', text: `${pack.credits} credits = ${pack.credits} videos` }),
      el('div', { class: 'pack-price', text: money(pack.price_cents) }),
      perVideo ? el('div', { class: 'pack-per-video', text: `${money(perVideo)} per finished, uploaded video` }) : null,
      el('button', { class: 'btn btn-primary', type: 'button', text: 'Buy with card', onclick: () => buyFromLanding(pack) }),
      el('div', { class: 'paypal-slot', id: `paypal-slot-${pack.id}`, 'data-pack-id': pack.id }),
    ].filter(Boolean)));
  }
  mountPayPalButtons(packs);
  if (usedFallback) {
    grid.appendChild(el('p', { class: 'pricing-note', text: 'Showing standard packs. Live pricing will load when the store is reachable.' }));
  }
}

/* ---------------- PayPal ---------------- */

let payPalSdkPromise = null;
let payPalSdkReady = null;

async function loadPayPalSdk(clientId) {
  if (!payPalSdkPromise) {
    payPalSdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=CAPTURE`;
      s.onload = () => { payPalSdkReady = window.paypal; resolve(window.paypal); };
      s.onerror = () => reject(new Error('PayPal SDK failed to load.'));
      document.head.appendChild(s);
    });
  }
  return payPalSdkPromise;
}

async function mountPayPalButtons(packs) {
  try {
    const cfg = await Api.paypalConfig();
    if (!cfg || !cfg.enabled || !cfg.client_id || !packs || !packs.length) return;
    const paypal = await loadPayPalSdk(cfg.client_id);
    if (!paypal || !paypal.Buttons) return;
    for (const pack of packs) {
      const slot = document.getElementById(`paypal-slot-${pack.id}`);
      if (!slot || slot.childElementCount > 0) continue;
      paypal.Buttons({
        style: { layout: 'horizontal', height: 40, label: 'paypal' },
        createOrder: async () => {
          const data = await Api.paypalOrder(pack.id);
          if (!data || !data.order_id) throw new ApiError('PayPal did not return an order.', 502);
          return data.order_id;
        },
        onApprove: async (approved) => {
          const data = await Api.paypalCapture(appendedOrder(approved));
          handlePaypalResult(data, pack);
        },
        onError: (err) => {
          console.error('PayPal button error:', err);
          toast('PayPal checkout failed. Try again or pay with card.', 'error');
        },
      }).render(slot);
    }
  } catch (err) {
    // Unconfigured or unreachable PayPal must never break the page or the
    // card flow — stay quiet at info level.
    console.info('PayPal buttons not mounted:', err && err.message ? err.message : err);
  }
}

// The SDK hands back { orderID } (capital ID); accept both spellings.
function appendedOrder(approved) {
  return (approved && (approved.orderID || approved.order_id)) || '';
}

async function handlePaypalResult(data, pack) {
  if (data && (data.granted || data.reason === 'already_granted' || data.reason === 'duplicate_capture')) {
    toast(`Paid with PayPal. ${pack.credits} credits added.`, 'success');
    try { await loadMe(); } catch (_e) { /* landing page has no dashboard */ }
  } else {
    toast('PayPal payment captured but credits are not confirmed yet.', 'error');
  }
}

async function buyFromLanding(pack) {
  try {
    const me = await Api.me();
    if (me && me.user) {
      const data = await Api.checkout(pack.id);
      if (data && data.url) { window.location.href = data.url; return; }
      throw new ApiError('Checkout did not return a payment link.', 500);
    }
    throw new ApiError('not-logged-in', 401);
  } catch (err) {
    if (err.status === 401 || err.message === 'not-logged-in') {
      if (window.CHROMATUBE_OFFICIAL) {
        window.location.href = `${window.CHROMATUBE_OFFICIAL}/app.html`;
        return;
      }
      selectAuthTab('signup');
      openModal('auth-modal');
      toast('Create an account first, then buy credits on your dashboard.', 'info');
    } else {
      toast(err.message || 'Could not start checkout.', 'error');
    }
  }
}

/* ---------------- Dashboard ---------------- */

const dash = {
  me: null,
  earnings: null,
  odometer: null,
  packs: FALLBACK_PACKS,
  lastChannelStatus: undefined,
  timers: [],
};

function bootDashboard() {
  loadAssignment(); // fire-and-forget: must not delay the dashboard
  const od = qs('#odometer');
  if (od) dash.odometer = new Odometer(od);
  populateTimeSelect();
  wireSidebar();
  // Auth card (used when the session is missing or has expired).
  wireModal('auth-modal');
  wireAuthTabs();
  wireAuthForms();
  wirePasswordToggles();
  // NOTE: the connect form is built and self-wired by buildConnectForm()
  // when the channel state renders (no static form in app.html).
  wireScheduleForm();
  wireLogout();
  renderCreditsSkeleton();

  const params = new URLSearchParams(window.location.search);
  if (params.get('credits') === '1') {
    toast('Payment received. Your credit balance will update within a minute.', 'success', 8000);
    setTimeout(refreshDashboard, 3000);
    setTimeout(refreshDashboard, 10000);
  }

  refreshDashboard();
  dash.timers.push(setInterval(() => refreshDashboard(['me', 'videos', 'earnings']), POLL_MS));

  // Load the two non-polled feeds once (and again alongside each poll cycle).
  loadSchedules();
  loadLearnings();
  loadCatalog();
  dash.timers.push(setInterval(loadSchedules, POLL_MS * 2));
}

function populateTimeSelect() {
  const sel = qs('#schedule-time');
  if (!sel || sel.options.length) return;
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    sel.appendChild(el('option', { value: `${hh}:00`, text: `${hh}:00 UTC` }));
  }
  sel.value = '15:00';
}

function wireSidebar() {
  qsa('.side-link').forEach((link) => {
    link.addEventListener('click', () => {
      qsa('.side-link').forEach((l) => l.classList.remove('active'));
      link.classList.add('active');
    });
  });
  const toggle = qs('#side-toggle');
  if (toggle) toggle.addEventListener('click', () => qs('.sidebar').classList.toggle('sidebar-open'));
}

function wireLogout() {
  const btn = qs('#logout-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await Api.logout(); } catch (err) { /* logging out locally regardless */ }
    window.location.href = '/';
  });
}

/* One refresh pass. sections defaults to everything. */
async function refreshDashboard(sections) {
  const want = (s) => !sections || sections.includes(s);
  const jobs = [];
  if (want('me')) jobs.push(loadMe().catch((e) => dashError(e)));
  if (want('videos')) jobs.push(loadVideos().catch((e) => dashError(e)));
  if (want('earnings')) jobs.push(loadEarnings().catch((e) => dashError(e)));
  await Promise.all(jobs);
}

function dashError(err) {
  toast(err.message || 'Could not load dashboard data.', 'error');
}

/* --- Me: user, balance, channel state --- */

async function loadMe() {
  let data;
  try {
    data = await Api.me();
  } catch (err) {
    if (err.status === 401) { showAuthGate(); return; }
    throw err;
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get('credits') === '0' && !dash.cancelToastShown) {
    dash.cancelToastShown = true;
    toast('Checkout cancelled. You have not been charged — you can buy credits anytime.', 'info', 8000);
  }
  dash.me = data;
  renderUser(data);
  renderChannel(data);
  renderBalance(data);
  return data;
}

function renderUser(data) {
  const emailEl = qs('#user-email');
  if (emailEl && data && data.user) emailEl.textContent = data.user.email || '';
}

function renderBalance(data) {
  const el2 = qs('#balance-value');
  if (!el2) return;
  const credits = data && data.user ? (data.user.balance_credits ?? 0) : 0;
  el2.textContent = `${credits} credit${credits === 1 ? '' : 's'}`;
}

/* --- Channel card: two connect paths -------------------------------
   'managed' (recommended) — we create the Google/YouTube account after the
   user buys credits and hand them the login in this dashboard.
   'cookie' — connect an existing channel by pasting a YouTube session cookie
   (never a Google password). */

function renderChannel(data) {
  const wrap = qs('#channel-body');
  if (!wrap) return;
  const channel = data && data.channel ? data.channel : null;
  const status = channel ? channel.status : 'none';

  if (dash.lastChannelStatus === 'pending_setup' && status === 'connected') {
    toast(`Your channel "${channel.title || ''}" is live.`, 'success');
  }
  dash.lastChannelStatus = status;

  if (!status || status === 'none') {
    wrap.replaceChildren(buildConnectForm(data));
  } else if (status === 'pending_setup') {
    const managed = channel.connect_mode === 'managed';
    wrap.replaceChildren(el('div', { class: 'channel-pending' }, [
      el('div', { class: 'spinner', 'aria-hidden': 'true' }),
      el('div', { class: 'pending-title', text: managed ? 'Creating your channel…' : 'Connecting your channel…' }),
      el('div', { class: 'pending-sub', text: managed
        ? 'We are setting up your YouTube account and finishing setup. Your login will appear here — most setups finish within a day. This page updates automatically.'
        : 'We are signing in with the cookie you gave us and finishing setup. If it does not work, we will tell you here — usually within a few hours. This page updates automatically.' }),
    ]));
  } else if (status === 'connected') {
    const head = el('div', { class: 'channel-connected' }, [
      el('div', { class: 'channel-avatar', 'aria-hidden': 'true', text: (channel.title || 'C').slice(0, 1).toUpperCase() }),
      el('div', {}, [
        el('div', { class: 'channel-title', text: channel.title || 'Your channel' }),
        el('div', { class: 'pill pill-uploaded', text: 'Connected' }),
      ]),
    ]);
    wrap.replaceChildren(...(channel.provisioned ? [head, buildCredentialCard()] : [head]));
  } else if (status === 'failed') {
    wrap.replaceChildren(el('div', { class: 'channel-failed' }, [
      el('div', { class: 'pending-title', text: 'We could not create your channel.' }),
      el('div', { class: 'pending-sub', text: 'Your credits are untouched — we will either fix it and finish setup automatically, or refund. Try again, or contact support if it keeps failing.' }),
      el('button', {
        class: 'btn btn-primary', type: 'button', text: 'Try again',
        onclick: () => wrap.replaceChildren(buildConnectForm(data)),
      }),
      el('a', { class: 'muted-link', href: 'mailto:support@chromatube.dev', text: 'Contact support' }),
    ]));
  } else if (status === 'needs_attention') {
    const causes = {
      cookie_invalid: 'Your cookie did not work. The most common cause is copying before signing in to YouTube.',
      cookie_expired: 'We lost access to your channel — YouTube sessions expire every few weeks. Videos are paused until you reconnect.',
      token_revoked: 'Reconnect our access to your channel to resume uploads.',
    };
    wrap.replaceChildren(el('div', { class: 'channel-failed' }, [
      el('div', { class: 'pending-title', text: 'Your channel needs attention' }),
      el('div', { class: 'pending-sub', text: causes[channel.status_reason] || 'We need a fresh connection to keep working on your channel.' }),
      el('button', {
        class: 'btn btn-primary', type: 'button', text: 'Paste a new cookie',
        onclick: () => {
          localStorage.setItem(CONNECT_TAB_KEY, 'cookie');
          wrap.replaceChildren(buildConnectForm(data));
        },
      }),
    ]));
  } else {
    wrap.replaceChildren(emptyState('Unknown channel state', `Status: ${status}`));
  }
}

/* Credential hand-off for a managed channel. The strings are never embedded
   in /api/me or page HTML — they are fetched only when the user reveals. */
function buildCredentialCard() {
  const card = el('div', { class: 'cred-card' });
  const reveal = el('button', { class: 'btn btn-ghost btn-small', type: 'button', text: 'Reveal login' });
  card.append(
    el('div', { class: 'cred-title', text: 'Your channel login' }),
    el('div', { class: 'pending-sub', text: 'These credentials were created for you. You own this account — it is a real Google account, not a shared one.' }),
    reveal,
    el('p', { class: 'fine-print', text: 'Keep these somewhere safe. Sign in at youtube.com anytime — if you change the password there, update it with us so uploads keep working.' }),
    el('a', { class: 'cred-studio-link', href: 'https://www.youtube.com/', target: '_blank', rel: 'noopener noreferrer', text: 'Open YouTube Studio →' }),
  );
  reveal.addEventListener('click', async () => {
    reveal.disabled = true;
    try {
      const creds = await Api.channelCredentials();
      if (!creds || creds.kind !== 'managed') throw new Error('No managed login stored for this channel');
      const emailIn = el('input', { class: 'input', type: 'text', readonly: true, value: creds.email || '', 'aria-label': 'Channel login email' });
      const pwdIn = el('input', { class: 'input', type: 'password', readonly: true, value: creds.password || '', 'aria-label': 'Channel login password' });
      const show = el('button', { class: 'pwd-toggle', type: 'button', text: 'Show', onclick: () => {
        const isPw = pwdIn.type === 'password';
        pwdIn.type = isPw ? 'text' : 'password';
        show.textContent = isPw ? 'Hide' : 'Show';
      } });
      card.insertBefore(
        el('div', { class: 'cred-rows' }, [
          credRow('Email', [emailIn, copyBtn(creds.email || '')]),
          credRow('Password', [el('div', { class: 'pwd-wrap' }, [pwdIn, show]), copyBtn(creds.password || '')]),
        ]),
        card.querySelector('.fine-print') // insert before the fine print
      );
      reveal.remove();
    } catch (ex) {
      toast(ex.message || 'Could not load the login.', 'error');
      reveal.disabled = false;
    }
  });
  return card;
}

function credRow(label, controls) {
  return el('div', { class: 'cred-row' }, [
    el('span', { class: 'field-label', text: label }),
    el('div', { class: 'cred-controls' }, controls),
  ]);
}

function copyBtn(text) {
  const btn = el('button', { class: 'btn btn-ghost btn-small', type: 'button', text: 'Copy' });
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    } catch (err) {
      toast('Copy failed — select the value and copy it manually.', 'error');
    }
  });
  return btn;
}

/* --- Connect form: managed tab + cookie tab ------------------------- */

const REQUIRED_COOKIES = ['__Secure-1PSID', '__Secure-1PSIDTS', 'SAPISID'];
const OPTIONAL_COOKIES = ['__Secure-1PSIDCC', 'HSID', 'SSID'];
const CONNECT_TAB_KEY = 'chromatube.connectTab';

function parseCookiePasteClient(text) {
  let value = typeof text === 'string' ? text.trim() : '';
  if (!value) return '';
  if (/^curl\s/.test(value)) {
    // Copy-as-cURL: take the -H header that carries the cookie line.
    const header = /-H\s*\$?'([^']*cookie\s*:[^']*)'/i.exec(value) || /-H\s*\$?'([^']*)'/.exec(value);
    if (header) value = header[1];
  }
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:cookie|set-cookie)\s*:\s*/i, '').trim())
    .filter(Boolean)
    .join('\n');
}

/* Mirrors src/routes/channel.js cookieProblem() so every paste mistake gets
   the server's exact cause client-side, before submit. */
function cookieProblemClient(raw) {
  if (!raw.trim()) return '';
  if (/^set-cookie\s*:/i.test(raw) || (/\bHttpOnly\b/.test(raw) && /\bExpires\s*=/.test(raw))) {
    return 'You pasted the wrong side of the headers. Use the cookie: line under Request Headers.';
  }
  const value = parseCookiePasteClient(raw);
  const missing = REQUIRED_COOKIES.filter((name) => !value.includes(name));
  if (missing.length === 0) return '';
  if (missing.includes('__Secure-1PSID')) {
    if (/SAPISID/.test(value)) {
      return 'This looks like a Google.com cookie, not a YouTube one. Repeat the steps on youtube.com.';
    }
    return 'No __Secure-1PSID found — you are probably signed out of YouTube. Sign in, then copy the cookie again.';
  }
  if (missing.includes('__Secure-1PSIDTS')) {
    return 'Missing __Secure-1PSIDTS — this cookie expires within minutes without it. Copy the full cookie: line, not one row.';
  }
  const found = REQUIRED_COOKIES.filter((name) => value.includes(name)).length;
  return `Only ${found} of the 3 required cookies found (${missing.join(', ')} missing). Use the Network-tab method to copy them all at once.`;
}

function buildConnectForm(data) {
  const hasPurchased = Boolean(data && data.user && data.user.has_purchased);
  const variant = abVariant();
  const saved = localStorage.getItem(CONNECT_TAB_KEY);
  const DEFAULT_TAB = { any: 'managed', password: 'password', cookie: 'cookie' };
  let tab = DEFAULT_TAB[variant];
  if (variant === 'any' && saved === 'cookie') tab = 'cookie';
  if (variant === 'password' && (saved === 'cookie' || saved === 'password')) tab = saved;
  Api.experimentEvent('connect_form_view', variant).catch(() => {});

  const managedBtn = el('button', { class: 'mode-tab', type: 'button', 'data-mode': 'managed' }, [
    el('span', { text: 'We set it up for you' }),
    el('span', { class: 'mode-badge', text: 'Recommended' }),
  ]);
  const passwordBtn = el('button', { class: 'mode-tab', type: 'button', 'data-mode': 'password', text: 'Use my Google login' });
  const cookieBtn = el('button', { class: 'mode-tab', type: 'button', 'data-mode': 'cookie', text: 'Connect my existing channel' });
  const managedPane = el('div', { class: 'mode-pane', 'data-pane': 'managed' });
  const passwordPane = el('div', { class: 'mode-pane', 'data-pane': 'password', hidden: true });
  const cookiePane = el('div', { class: 'mode-pane', 'data-pane': 'cookie', hidden: true });

  /* Pitch per variant: control offers managed+cookie; the password arm leads
     with a Google-login form (cookie as the fallback tab); the cookie arm
     shows only the paste box. */
  const tabs =
    variant === 'any' ? [managedBtn, cookieBtn] :
    variant === 'password' ? [passwordBtn, cookieBtn] : [];
  const tabsRow = el('div', { class: 'mode-tabs' }, tabs);
  if (!tabs.length) tabsRow.hidden = true;
  const card = el('div', { class: 'mode-card', id: 'connect-form' }, [
    tabsRow,
    managedPane,
    passwordPane,
    cookiePane,
  ]);

  function selectTab(mode) {
    tab = mode;
    localStorage.setItem(CONNECT_TAB_KEY, mode);
    managedBtn.classList.toggle('active', mode === 'managed');
    passwordBtn.classList.toggle('active', mode === 'password');
    cookieBtn.classList.toggle('active', mode === 'cookie');
    managedPane.hidden = mode !== 'managed';
    passwordPane.hidden = mode !== 'password';
    cookiePane.hidden = mode !== 'cookie';
  }
  managedBtn.addEventListener('click', () => selectTab('managed'));
  passwordBtn.addEventListener('click', () => selectTab('password'));
  cookieBtn.addEventListener('click', () => selectTab('cookie'));

  /* Managed pane: upsell until the first purchase, then the create form. */
  if (!hasPurchased) {
    const seePacks = el('button', {
      class: 'btn btn-primary', type: 'button', text: 'See credit packs',
      onclick: () => {
        const grid = qs('#packs-grid') || qs('#pricing-grid');
        if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    });
    const switchLink = el('button', {
      class: 'muted-link', type: 'button', text: 'Connect an existing channel instead →',
    });
    switchLink.addEventListener('click', () => selectTab('cookie'));
    managedPane.append(
      el('div', { class: 'managed-upsell' }, [
        el('div', { class: 'pending-title', text: 'Buy a credit pack to get your managed channel' }),
        el('div', { class: 'pending-sub', text: 'Your managed YouTube channel is included with any credit pack. Each video uses 1 credit.' }),
        seePacks,
        switchLink,
      ]),
    );
  } else {
    const name = el('input', { class: 'input', type: 'text', name: 'channel_name', placeholder: 'Channel name, e.g. Daily Space Facts', required: true, 'aria-label': 'Channel name' });
    const niche = el('input', { class: 'input', type: 'text', name: 'niche', placeholder: 'Niche, e.g. space documentaries', required: true, 'aria-label': 'Channel niche' });
    const err = el('div', { class: 'form-error', hidden: true });
    const form = el('form', { class: 'stack', autocomplete: 'off' });
    form.append(
      el('p', { class: 'pane-sub', text: 'After you buy credits, we create your YouTube channel, keep it running, and hand you the login. You own the account.' }),
      el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Channel name' }), name]),
      el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Niche' }), niche]),
      err,
      el('button', { class: 'btn btn-primary', type: 'submit', text: 'Create my channel' }),
      el('p', { class: 'fine-print', text: 'We generate the account, run the setup, then hand you the email and password. You own the channel and can change the password any time.' }),
    );
    wireConnectSubmit(form, err, () => ({
      mode: 'managed', channel_name: name.value.trim(), niche: niche.value.trim(),
    }));
    managedPane.append(form);
  }

  /* Password pane (login_method=password arm): Google email + password form. */
  {
    const pEmail = el('input', { class: 'input', type: 'email', name: 'google_email', placeholder: 'you@gmail.com', required: true, 'aria-label': 'Google account email' });
    const pPw = el('input', { class: 'input', type: 'password', name: 'google_password', required: true, 'aria-label': 'Google account password' });
    const pName = el('input', { class: 'input', type: 'text', name: 'channel_name', placeholder: 'Channel name, e.g. Daily Space Facts', required: true, 'aria-label': 'Channel name' });
    const pNiche = el('input', { class: 'input', type: 'text', name: 'niche', placeholder: 'Niche, e.g. space documentaries', required: true, 'aria-label': 'Channel niche' });
    const pErr = el('div', { class: 'form-error', hidden: true });
    const pForm = el('form', { class: 'stack', autocomplete: 'off' });
    pForm.append(
      el('p', { class: 'pane-sub', text: 'Already have a YouTube channel? Give us your Google login and we run the whole setup for you — no cookie digging, no dev tools.' }),
      el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Google account email' }), pEmail]),
      el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Google account password' }), pPw]),
      el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Channel name' }), pName]),
      el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Niche' }), pNiche]),
      pErr,
      el('button', { class: 'btn btn-primary', type: 'submit', text: 'Connect my channel' }),
      el('p', { class: 'fine-print', text: 'Your password is encrypted and used only to set up your channel. Change your Google password at any time to revoke us instantly.' }),
    );
    wireConnectSubmit(pForm, pErr, () => ({
      mode: 'password',
      google_email: pEmail.value.trim(),
      google_password: pPw.value,
      channel_name: pName.value.trim(),
      niche: pNiche.value.trim(),
    }));
    passwordPane.append(pForm);
    if (variant === 'password') {
      const toCookie = el('button', { class: 'muted-link', type: 'button', text: 'Prefer pasting a cookie? →' });
      toCookie.addEventListener('click', () => selectTab('cookie'));
      passwordPane.append(toCookie);
    }
  }

  /* Cookie pane: paste box with live validation chips + how-to instructions. */
  const cookieBox = el('textarea', {
    class: 'input cookie-box', name: 'cookie', rows: 4, 'aria-label': 'YouTube cookie',
    placeholder: 'Paste the full cookie: value from a youtube.com request, or one name=value per line',
    spellcheck: 'false',
  });
  const chips = el('div', { class: 'cookie-chips', 'aria-live': 'polite' });
  const pasteNote = el('div', { class: 'cookie-note', hidden: true });
  const pasteWarn = el('div', { class: 'form-error', hidden: true });
  const email = el('input', { class: 'input', type: 'email', name: 'google_email', placeholder: 'you@gmail.com', required: true, 'aria-label': 'Google account email' });
  const name = el('input', { class: 'input', type: 'text', name: 'channel_name', placeholder: 'Channel name, e.g. Daily Space Facts', required: true, 'aria-label': 'Channel name' });
  const niche = el('input', { class: 'input', type: 'text', name: 'niche', placeholder: 'Niche, e.g. space documentaries', required: true, 'aria-label': 'Channel niche' });
  const err = el('div', { class: 'form-error', hidden: true });
  const submit = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Connect my channel', disabled: true });

  cookieBox.addEventListener('input', () => {
    const raw = cookieBox.value;
    const value = parseCookiePasteClient(raw);
    const cleaned = !/^set-cookie\s*:/i.test(raw) && (/(^cookie\s*:|^curl\s)/i.test(raw) || /"/.test(raw));
    pasteNote.hidden = !cleaned || !value;
    pasteNote.textContent = 'Cleaned up your paste (dropped the header prefix and quotes).';
    const problem = cookieProblemClient(raw);
    pasteWarn.hidden = !problem;
    pasteWarn.textContent = problem;
    chips.replaceChildren(
      ...REQUIRED_COOKIES.map((name2) => {
        const ok = value.includes(name2);
        return el('span', { class: `cookie-chip ${ok ? 'chip-ok' : 'chip-miss'}`, 'data-cookie': name2 }, [
          el('span', { text: `${ok ? '✓' : '✗'} ` }),
          document.createTextNode(name2),
        ]);
      }),
      ...OPTIONAL_COOKIES.map((name2) => {
        const ok = value.includes(name2);
        return el('span', { class: `cookie-chip ${ok ? 'chip-ok' : 'chip-opt'}`, 'data-cookie': name2 }, [
          el('span', { text: `${ok ? '✓' : '·'} ` }),
          document.createTextNode(name2),
          el('span', { class: 'chip-opt-note', text: ' optional' }),
        ]);
      }),
    );
    submit.disabled = !raw.trim() || Boolean(problem);
  });
  cookieBox.dispatchEvent(new Event('input')); // render the initial ✗ chips

  const form = el('form', { class: 'stack', autocomplete: 'off' });
  form.append(
    el('p', { class: 'pane-sub', text: 'Already have a YouTube channel? Connect it by pasting a cookie from your browser — never your Google password.' }),
    el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Google account email' }), email]),
    el('label', { class: 'field' }, [
      el('span', { class: 'field-label', text: 'YouTube cookie' }),
      cookieBox, chips, pasteNote, pasteWarn,
      buildCookieHelp(),
    ]),
    el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Channel name' }), name]),
    el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Niche' }), niche]),
    err,
    submit,
    el('p', { class: 'fine-print', text: 'Your cookie lets us upload to your channel. You can disconnect at any time, and revoking the session in your Google account stops us instantly.' }),
  );
  wireConnectSubmit(form, err, () => ({
    mode: 'cookie',
    google_email: email.value.trim(),
    cookie: cookieBox.value,
    channel_name: name.value.trim(),
    niche: niche.value.trim(),
  }));
  cookiePane.append(form);
  if (variant === 'password') {
    const toPassword = el('button', { class: 'muted-link', type: 'button', text: 'Use my Google login instead →' });
    toPassword.addEventListener('click', () => selectTab('password'));
    cookiePane.append(toPassword);
  }

  selectTab(tab);
  return card;
}

function wireConnectSubmit(form, err, payloadOf) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError(err, null);
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await Api.connectChannel(payloadOf());
      toast('Channel setup started. We will take it from here.', 'success');
      await loadMe();
    } catch (ex) {
      setError(err, ex.message || 'Could not start channel setup.');
      btn.disabled = false;
    }
  });
}

function buildCookieHelp() {
  const step = (text) => el('li', { text });
  return el('details', { class: 'cookie-help' }, [
    el('summary', { text: 'How do I find my cookie?' }),
    el('p', { class: 'cookie-help-note', text: 'You must be signed in to YouTube in the browser you use these steps in — otherwise the cookie will not work.' }),
    el('ol', { class: 'cookie-steps' }, [
      step('Open youtube.com and make sure you are signed in (your avatar shows top-right).'),
      step('Press F12 (Alt+Cmd+I on Mac) to open DevTools.'),
      step('Click the Network tab.'),
      step('With Network open, reload the page. Rows start filling the list.'),
      step('Click the first row (named www.youtube.com or similar).'),
      step('Under Request Headers, find the line starting with cookie:.'),
      step('Right-click that line, choose Copy value, and paste it into the box above.'),
    ]),
    el('p', { class: 'cookie-help-note', text: 'Alternative — the Application tab:' }),
    el('ol', { class: 'cookie-steps' }, [
      step('In the same DevTools, click the Application tab (Storage on Mac).'),
      step('In the left sidebar: Storage → Cookies → https://www.youtube.com.'),
      step('Confirm you see __Secure-1PSID, __Secure-1PSIDTS and SAPISID — if __Secure-1PSID is missing you are signed out.'),
      step('Select the rows, right-click, Copy, and paste them one per line as name=value.'),
    ]),
  ]);
}

/* --- Earnings --- */

async function loadEarnings() {
  const data = await Api.earnings();
  dash.earnings = data;
  const total = data ? (data.total_est_cents || 0) : 0;
  if (dash.odometer) dash.odometer.setCents(total);
  const skel = qs('#earnings-skel');
  if (skel) skel.hidden = true;
  const sub = qs('#earnings-sub');
  if (sub) {
    const views = data ? (data.lifetime_views || 0) : 0;
    const published = data ? (data.videos_published || 0) : 0;
    sub.textContent = `Estimated, from ${views.toLocaleString('en-US')} views on ${published} published video${published === 1 ? '' : 's'}.`;
  }
  const spark = qs('#sparkline');
  if (spark) renderSparkline(spark, data ? data.by_day : []);
}

/* --- Schedules --- */

function wireScheduleForm() {
  const form = qs('#schedule-form');
  if (!form) return;
  const err = qs('#schedule-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError(err, null);
    const idea = qs('#schedule-idea').value.trim();
    const cadence = qs('#schedule-cadence').value;
    const time = qs('#schedule-time').value;
    if (!idea) { setError(err, 'Describe your video idea first.'); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await Api.createSchedule(idea, cadence, time);
      qs('#schedule-idea').value = '';
      toast('Schedule created. Videos will start releasing on it.', 'success');
      await loadSchedules();
    } catch (ex) {
      setError(err, ex.message || 'Could not create the schedule.');
    } finally {
      btn.disabled = false;
    }
  });
}

async function loadSchedules() {
  const list = qs('#schedule-list');
  if (!list) return;
  try {
    const data = await Api.schedules();
    const items = data && Array.isArray(data.schedules) ? data.schedules : [];
    if (!items.length) {
      list.replaceChildren(emptyState('No releases scheduled', 'Pick an idea, a cadence and a time, then press Start releasing.'));
      return;
    }
    list.replaceChildren();
    for (const s of items) {
      list.appendChild(el('div', { class: 'schedule-row' }, [
        el('div', { class: 'schedule-main' }, [
          el('div', { class: 'schedule-idea', text: s.niche_idea || s.idea || 'Video idea' }),
          el('div', { class: 'schedule-meta', text: `${CADENCE_LABEL[s.cadence] || s.cadence || ''} at ${s.time_utc || ''} UTC` }),
        ]),
        el('div', { class: 'schedule-next' }, [
          el('span', { class: 'schedule-next-label', text: 'Next release' }),
          el('span', { class: 'schedule-next-time', text: s.next_run_at ? formatUtc(s.next_run_at) : 'Not set' }),
        ]),
      ]));
    }
  } catch (err) {
    list.replaceChildren();
    setError(qs('#schedule-list-error'), err.message || 'Could not load schedules.');
  }
}

/* --- Credits --- */

async function loadCatalog() {
  try {
    const data = await Api.catalog();
    if (data && Array.isArray(data.packs) && data.packs.length) dash.packs = data.packs;
  } catch (err) { /* keep fallback packs */ }
  renderPacks();
}

function renderCreditsSkeleton() {
  const grid = qs('#packs-grid');
  if (grid) grid.replaceChildren(skeletons(3, 'skel-card'));
}

function renderPacks() {
  const grid = qs('#packs-grid');
  if (!grid) return;
  grid.replaceChildren();
  for (const pack of dash.packs) {
    grid.appendChild(el('div', { class: 'pack' }, [
      el('div', { class: 'pack-name', text: pack.name || pack.id }),
      el('div', { class: 'pack-credits', text: `${pack.credits} credits` }),
      el('div', { class: 'pack-price', text: money(pack.price_cents) }),
      el('button', { class: 'btn btn-primary', type: 'button', text: 'Buy with card', onclick: () => buyPack(pack.id) }),
      el('div', { class: 'paypal-slot', id: `paypal-slot-${pack.id}`, 'data-pack-id': pack.id }),
    ]));
  }
  mountPayPalButtons(dash.packs);
}

async function buyPack(packId) {
  try {
    const data = await Api.checkout(packId);
    if (data && data.url) { window.location.href = data.url; return; }
    throw new ApiError('Checkout did not return a payment link.', 500);
  } catch (err) {
    toast(err.message || 'Could not start checkout.', 'error');
  }
}

/* --- Videos grid --- */

async function loadVideos() {
  const grid = qs('#videos-grid');
  if (!grid) return;
  let videos = [];
  try {
    const data = await Api.videos();
    videos = data && Array.isArray(data.videos) ? data.videos : [];
    setError(qs('#videos-error'), null);
  } catch (err) {
    setError(qs('#videos-error'), err.message || 'Could not load videos.');
    // Always clear the initial skeleton on failure, but keep already-loaded cards on later poll failures.
    if (grid.querySelector('.skeleton')) grid.replaceChildren(emptyState('Videos unavailable', 'We could not reach the video list.'));
    return;
  }

  if (!videos.length) {
    grid.replaceChildren(emptyState('No videos yet', 'Connect a channel and set a schedule. Your first video will show up here.'));
    return;
  }

  grid.replaceChildren();
  for (const v of videos) {
    const tags = Array.isArray(v.variant_tags) && v.variant_tags.length
      ? el('div', { class: 'vtags' }, v.variant_tags.slice(0, 4).map((t) => el('span', { class: 'vtag', text: t })))
      : null;

    const body = [
      el('div', { class: 'vrow' }, [
        statusPill(v.status),
        el('span', { class: 'vviews', text: formatViews(v.views) }),
      ]),
      el('div', { class: 'vearn', text: `${money(v.est_earnings_cents)} est.` }),
    ];
    if (tags) body.push(tags);

    grid.appendChild(el('div', { class: 'vcard' }, [
      videoThumb(v),
      el('div', { class: 'vbody' }, [
        el('div', { class: 'vtitle', text: v.title || 'Untitled video' }),
        el('div', { class: 'vmeta', text: v.published_at ? `Published ${timeAgo(v.published_at)}` : 'Not published yet' }),
        ...body,
      ]),
    ]));
  }
}

/* --- Learnings feed --- */

async function loadLearnings() {
  const feed = qs('#learnings-list');
  if (!feed) return;
  try {
    const data = await Api.learnings();
    const items = data && Array.isArray(data.learnings) ? data.learnings : [];
    items.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    setError(qs('#learnings-error'), null);
    if (!items.length) {
      feed.replaceChildren(emptyState('No learnings yet', 'When a video outperforms the rest, what we learned from it shows up here.'));
      return;
    }
    feed.replaceChildren();
    for (const l of items) {
      feed.appendChild(el('div', { class: 'learning' }, [
        el('div', { class: 'learning-avatar', 'aria-hidden': 'true', html: rainbowDot() }),
        el('div', { class: 'learning-body' }, [
          el('div', { class: 'learning-head' }, [
            el('span', { class: 'learning-src', text: 'ChromaTube engine' }),
            el('span', { class: 'learning-time', text: l.created_at ? timeAgo(l.created_at) : '' }),
          ]),
          el('div', { class: 'learning-text', text: l.text || '' }),
          l.detail ? el('div', { class: 'learning-detail', text: l.detail }) : null,
        ]),
      ]));
    }
  } catch (err) {
    setError(qs('#learnings-error'), err.message || 'Could not load learnings.');
    if (feed.querySelector('.skeleton')) feed.replaceChildren(emptyState('Learnings unavailable', 'We could not reach the learning feed.'));
  }
}

function rainbowDot() {
  return '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff0033"/><stop offset=".33" stop-color="#ffcc00"/><stop offset=".66" stop-color="#00c853"/><stop offset="1" stop-color="#2962ff"/></linearGradient></defs><rect width="24" height="24" rx="12" fill="url(#lg)"/></svg>';
}

/* ---------------- Boot ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.getAttribute('data-page');
  if (page === 'landing') bootLanding();
  else if (page === 'app') bootDashboard();
});
