/* Rolling-digit odometer. Each digit is a vertical strip of 0-9 repeated three
   times; we translate the strip with a CSS transition so digits physically roll.
   Money in, dollars out: 123456 cents renders as $1,234.56. */

const LOOP = 10;           // digits per loop
const MIDDLE = LOOP;       // we always park inside the middle loop so the strip
const DURATION = 1200;     // ms, matched by the CSS transition
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

function moneyString(cents) {
  const dollars = (Math.round(cents) / 100);
  return dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export class Odometer {
  /**
   * @param {HTMLElement} root container the odometer renders into
   */
  constructor(root) {
    this.root = root;
    this.root.classList.add('od');
    this.root.setAttribute('role', 'text');
    this.root.setAttribute('aria-live', 'polite');
    this.parts = [];   // {el, isDigit, digit, loop} in render order
    this.lastChars = null;
  }

  setCents(cents) {
    const value = Number.isFinite(cents) ? Math.max(0, Math.round(cents)) : 0;
    const chars = ('' + moneyString(value)).split('');
    // Rebuild whenever the character count changes in either direction: digit
    // slots map 1:1 onto the money string, so a shorter string (value shrank,
    // e.g. the RPM estimate was lowered) would otherwise index past the layout.
    const relayout = this.lastChars === null || chars.length !== this.lastChars.length;

    if (relayout) this._build(chars);
    this._animate(chars);
    this.lastChars = chars;
    this.root.setAttribute('aria-label', 'Estimated earnings: $' + moneyString(value));
  }

  /* Rebuild the DOM. New leading digits start parked at 0 so they roll up. */
  _build(chars) {
    // Drop the old layout's safety timers with it — they would otherwise fire
    // against strips that no longer exist.
    for (const part of this.parts) {
      if (part.pendingTimer) { clearTimeout(part.pendingTimer); part.pendingTimer = null; }
    }
    const frag = document.createDocumentFragment();
    const dollar = document.createElement('span');
    dollar.className = 'od-dollar';
    dollar.textContent = '$';
    frag.appendChild(dollar);

    this.parts = [];
    for (const ch of chars) {
      if (/\d/.test(ch)) {
        const slot = document.createElement('span');
        slot.className = 'od-digit';
        const strip = document.createElement('span');
        strip.className = 'od-strip';
        for (let l = 0; l < 3; l++) {
          for (let d = 0; d < LOOP; d++) {
            const n = document.createElement('span');
            n.className = 'od-num';
            n.textContent = String(d);
            strip.appendChild(n);
          }
        }
        slot.appendChild(strip);
        frag.appendChild(slot);
        this.parts.push({ slot, strip, isDigit: true, digit: 0 });
      } else {
        const sep = document.createElement('span');
        sep.className = 'od-sep';
        sep.textContent = ch;
        frag.appendChild(sep);
        this.parts.push({ slot: sep, isDigit: false });
      }
    }
    this.root.replaceChildren(frag);
    // Flush style for the fresh strips BEFORE _animate writes a transition
    // target. A strip inserted and re-styled in the same frame has no computed
    // "before" state, so the browser applies the transform with no transition
    // and the digits snap instead of rolling — every character-count change
    // went through this path (e.g. $12.40 -> $156.75 on the hero).
    void this.root.offsetHeight;
  }

  /* Roll every digit strip CONTINUOUSLY to its target: no snap-to-zero.
     Strips hold three 0-9 loops; we always animate from the current transform
     to the new one, and after an upward roll we silently re-park inside the
     middle loop so there is always runway left. */
  _animate(chars) {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    for (let p = 0; p < this.parts.length; p++) {
      const part = this.parts[p];
      if (!part.isDigit) continue;
      const ch = chars[p] || '0';
      const target = parseInt(ch, 10) || 0;
      if (target === part.digit) continue;

      if (reduce) {
        if (part.pendingTimer) { clearTimeout(part.pendingTimer); part.pendingTimer = null; }
        part.rollId = (part.rollId || 0) + 1; // orphan any in-flight animated roll
        part.strip.style.transition = 'none';
        part.strip.style.transform = `translateY(-${MIDDLE + target}em)`;
        part.digit = target;
        continue;
      }

      // Strips always rest parked at the middle loop (transform = MIDDLE + digit).
      // Roll FORWARD on increases (crossing one extra loop on 9 -> 0), BACKWARD
      // only when the displayed value itself shrank (rare: RPM change).
      const crossing = part.digit === 9 && target === 0;
      const dest = MIDDLE + target + (crossing ? LOOP : 0);

      // Invalidate any roll still in flight so its re-park can't fire late
      // and snap the strip back to a stale digit.
      if (part.pendingTimer) { clearTimeout(part.pendingTimer); part.pendingTimer = null; }
      part.rollId = (part.rollId || 0) + 1;
      const rollId = part.rollId;

      part.strip.style.transition = `transform ${DURATION}ms ${EASE}`;
      part.strip.style.transform = `translateY(-${dest}em)`;

      const strip = part.strip;
      const after = () => {
        if (part.rollId !== rollId) return; // a newer roll owns the strip now
        strip.style.transition = 'none';
        // Re-park into the middle loop so future rolls always have runway.
        strip.style.transform = `translateY(-${MIDDLE + target}em)`;
      };
      strip.addEventListener('transitionend', after, { once: true });
      // Safety: if transitionend is missed (tab hidden), re-park later anyway.
      part.pendingTimer = setTimeout(after, DURATION + 200);
      part.digit = target;
    }
  }

  /* No destroy(): the odometer lives for the whole page (one dashboard mount,
     never re-initialized), so timers die with the document. _build clears a
     replaced layout's timers, which is the only teardown that can happen. */
}
