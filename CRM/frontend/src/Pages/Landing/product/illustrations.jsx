// Signature illustrations for the product feature pages. Each is a small CSS
// composition animated by a subtle GSAP timeline that plays once when it
// scrolls into view. Reduced-motion users skip the animation entirely (the
// .pf-anim CSS override keeps everything visible). Tasteful by design —
// one-shot entrances, with at most one gentle looping accent per scene.

import { useEffect } from 'react';
import gsap from 'gsap';
import {
  ImageSquare, FilePdf, PaperPlaneTilt, Globe,
} from '@phosphor-icons/react';
import { useInView } from '../../../Utils/useInView.js';

// Run a GSAP context scoped to the returned ref, once, when it enters view.
function useGsapInView(build) {
  const { ref, inView } = useInView({ threshold: 0.3 });
  useEffect(() => {
    if (!inView || !ref.current) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(build, ref);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView]);
  return ref;
}

/* ── Database: records populating a table ─────────────────────────── */
function DatabaseIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo('.pf-db-row.pf-anim',
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.5, stagger: 0.11 });
    tl.fromTo('.pf-db-dot',
      { scale: 0 }, { scale: 1, duration: 0.3, stagger: 0.11, ease: 'back.out(2)' }, 0.15);
  });
  const rows = [
    ['Emma Carter', '#10428', 'Paid'],
    ['Liam Novak', '#10427', 'Shipped'],
    ['Sofia Reyes', '#10426', 'Paid'],
    ['Noah Berg', '#10425', 'Refunded'],
  ];
  return (
    <div className="pf-db" ref={ref}>
      <div className="pf-db-row pf-db-row--head">
        <span /><span>Customer</span><span>Order</span><span>Status</span>
      </div>
      {rows.map((r, i) => (
        <div className="pf-db-row pf-anim" key={i}>
          <i className="pf-db-dot" />
          <span className="pf-db-cell-strong">{r[0]}</span>
          <span>{r[1]}</span>
          <span className="pf-db-pill">{r[2]}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Auth: OTP card + social provider chips ──────────────────────── */
function AuthIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo('.pf-auth-card', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5 });
    tl.fromTo('.pf-auth-otp i', { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.08 }, '-=0.1');
    tl.fromTo('.pf-auth-prov', { opacity: 0, scale: 0.6 },
      { opacity: 1, scale: 1, duration: 0.35, stagger: 0.06, ease: 'back.out(1.8)' }, '-=0.1');
  });
  // Real, official brand SVGs (public/brand-logos/*.svg) — all are providers
  // we actually support. <img> keeps each logo's own colours.
  const provs = ['google', 'apple', 'discord', 'slack', 'gitlab', 'spotify', 'twitch', 'facebook'];
  const code = ['4', '8', '1', '5', '0', '2'];
  return (
    <div className="pf-auth" ref={ref}>
      <div className="pf-auth-card pf-card pf-anim">
        <span className="pf-auth-label">Verification code</span>
        <div className="pf-auth-otp">
          {code.map((d, i) => <i key={i} className={i < 4 ? 'is-on' : ''}>{i < 4 ? d : ''}</i>)}
        </div>
      </div>
      <div className="pf-auth-providers">
        {provs.map((name, i) => (
          <div className="pf-auth-prov pf-anim" key={i}>
            <img className="pf-auth-logo" src={`/brand-logos/${name}.svg`} alt="" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Storage: uploads filling their progress bars ────────────────── */
function StorageIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo('.pf-store-file', { opacity: 0, x: -18 }, { opacity: 1, x: 0, duration: 0.45, stagger: 0.14 });
    tl.to('.pf-store-fill', { width: (i, el) => el.dataset.to, duration: 0.9, stagger: 0.14, ease: 'power1.inOut' }, '-=0.3');
  });
  const files = [
    { Ic: ImageSquare, name: 'hero-banner.webp', to: '100%', pct: '100%' },
    { Ic: FilePdf, name: 'size-guide.pdf', to: '100%', pct: '100%' },
    { Ic: ImageSquare, name: 'product-04.webp', to: '72%', pct: '72%' },
  ];
  return (
    <div className="pf-store" ref={ref}>
      {files.map(({ Ic, name, to, pct }, i) => (
        <div className="pf-store-file pf-card pf-anim" key={i}>
          <div className="pf-store-ic"><Ic weight="bold" /></div>
          <div className="pf-store-meta">
            <span className="pf-store-name">{name}</span>
            <div className="pf-store-track"><div className="pf-store-fill" data-to={to} /></div>
          </div>
          <span className="pf-store-pct">{pct}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Automations: an event fanning out to destinations ───────────── */
function AutomationsIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo('.pf-flow-node', { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.5 });
    tl.fromTo('.pf-flow-dest', { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: 0.45, stagger: 0.12 }, '-=0.2');
    // Gentle continuous "flow" along the wires.
    gsap.set('.pf-flow-line', { strokeDasharray: '6 10' });
    gsap.to('.pf-flow-line', { strokeDashoffset: -32, duration: 1.4, repeat: -1, ease: 'none' });
  });
  const dests = [
    { logo: 'slack', label: 'Slack' },
    { logo: 'discord', label: 'Discord' },
    { Ic: Globe, label: 'Your endpoint' },
  ];
  return (
    <div className="pf-flow" ref={ref}>
      <div className="pf-flow-node pf-card pf-anim">
        <span className="pf-flow-badge">order.paid</span>
        <b>New paid order</b>
        <span>#10428 · $128.00</span>
      </div>
      <div className="pf-flow-wire">
        <svg viewBox="0 0 64 140" preserveAspectRatio="none">
          <path className="pf-flow-line" d="M0,70 C32,70 32,24 64,24" />
          <path className="pf-flow-line" d="M0,70 L64,70" />
          <path className="pf-flow-line" d="M0,70 C32,70 32,116 64,116" />
        </svg>
      </div>
      <div className="pf-flow-dests">
        {dests.map(({ logo, Ic, label }, i) => (
          <div className="pf-flow-dest pf-card pf-anim" key={i}>
            {logo ? <img className="pf-flow-logo" src={`/brand-logos/${logo}.svg`} alt="" /> : <Ic weight="fill" />} {label}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Email: a message composed, then sent ────────────────────────── */
function EmailIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo('.pf-mail-card', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5 });
    tl.fromTo('.pf-mail-line', { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.3, stagger: 0.1 }, '-=0.15');
    tl.fromTo('.pf-mail-sent', { opacity: 0, scale: 0.85 },
      { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(1.8)' }, '+=0.1');
  });
  return (
    <div className="pf-mail" ref={ref}>
      <div className="pf-mail-card pf-card pf-anim">
        <div className="pf-mail-line"><span>From</span><em>Aurora Atelier</em></div>
        <div className="pf-mail-line"><span>To</span><em>customer@email.com</em></div>
        <div className="pf-mail-line pf-mail-line--subj"><span>Subj</span><em>Your order is on its way ✦</em></div>
      </div>
      <div className="pf-mail-sent pf-anim"><PaperPlaneTilt weight="fill" /> Delivered in seconds</div>
    </div>
  );
}

/* ── Realtime: multiplayer presence — live cursors, an avatar presence
      stack and a field being edited live, mirroring the real in-app
      experience (the arrow path is the SAME one CursorOverlay draws). ──── */
const RT_ARROW = 'M 3 2.5 L 14 9 Q 14.6 9.3 14 9.8 L 9.6 10.1 Q 8.8 10.3 8.5 11 L 6.8 15.2 Q 6.1 16.2 5.6 15.1 Z';

function RtCursor({ cls, name, colour }) {
  return (
    <div className={`pf-rt-cur pf-anim ${cls}`}>
      <svg viewBox="0 0 18 18" width="17" height="17">
        <path d={RT_ARROW} fill={colour} stroke="#fff" strokeWidth="1"
          strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span className="pf-rt-cur-tag" style={{ background: colour }}>{name}</span>
    </div>
  );
}

function RealtimeIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.fromTo('.pf-rt-canvas', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5 });
    tl.fromTo('.pf-rt-ava', { scale: 0 },
      { scale: 1, duration: 0.34, stagger: 0.07, ease: 'back.out(2.2)' }, '-=0.2');
    tl.fromTo('.pf-rt-row', { opacity: 0, x: -10 },
      { opacity: 1, x: 0, duration: 0.32, stagger: 0.09 }, '-=0.15');
    tl.fromTo('.pf-rt-cur', { opacity: 0, scale: 0.4 },
      { opacity: 1, scale: 1, duration: 0.4, stagger: 0.14, ease: 'back.out(2)' }, '-=0.05');

    // Type the title in, char by char (no TextPlugin dependency). The <b> is
    // pre-filled in JSX so reduced-motion (GSAP never runs) still shows text.
    const typed = ref.current?.querySelector('.pf-rt-typed');
    const full = 'Polo Sweater';
    const o = { n: 0 };
    tl.to(o, { n: full.length, duration: 1.0, ease: 'none', snap: { n: 1 },
      onUpdate: () => { if (typed) typed.textContent = full.slice(0, Math.round(o.n)); } }, '-=0.1');

    // The one looping accent: gentle, desynced cursor drift. Small amplitude so
    // it reads as "alive", never busy — best animation is the unnoticed one.
    gsap.to('.pf-rt-cur--a', { x: 24, y: 16, duration: 2.6, repeat: -1, yoyo: true, ease: 'sine.inOut' });
    gsap.to('.pf-rt-cur--b', { x: -20, y: 22, duration: 3.2, repeat: -1, yoyo: true, ease: 'sine.inOut', delay: 0.35 });
  });

  const avatars = [
    { i: 'M', c: '#0071E3' }, { i: 'D', c: '#8b5cf6' }, { i: 'S', c: '#06b6d4' },
  ];
  return (
    <div className="pf-rt" ref={ref}>
      <div className="pf-rt-canvas pf-card pf-anim">
        <div className="pf-rt-top">
          <span className="pf-rt-title">Product overview</span>
          <div className="pf-rt-stack">
            {avatars.map((a, i) => (
              <span className="pf-rt-ava" key={i} style={{ background: a.c }}>{a.i}</span>
            ))}
            <span className="pf-rt-ava pf-rt-ava--more">+2</span>
          </div>
        </div>

        <div className="pf-rt-row pf-rt-field">
          <span className="pf-rt-field-label">Title</span>
          <span className="pf-rt-typed-wrap">
            <b className="pf-rt-typed">Polo Sweater</b><i className="pf-rt-caret" />
          </span>
          <span className="pf-rt-editing">Mia</span>
        </div>

        <div className="pf-rt-row pf-rt-skel"><i style={{ width: '72%' }} /></div>
        <div className="pf-rt-row pf-rt-skel"><i style={{ width: '54%' }} /></div>
      </div>

      <RtCursor cls="pf-rt-cur--a" name="Mia" colour="#0071E3" />
      <RtCursor cls="pf-rt-cur--b" name="Daniel" colour="#8b5cf6" />
    </div>
  );
}

export const ILLUSTRATIONS = {
  database: DatabaseIllus,
  auth: AuthIllus,
  storage: StorageIllus,
  automations: AutomationsIllus,
  email: EmailIllus,
  realtime: RealtimeIllus,
};

/* ════════════════════════════════════════════════════════════════════
   Interactive capability-card art (Supabase-style hover panels).

   Each card writes the cursor position into CSS vars (--mx/--my for the
   spotlight glow + border highlight, --rx/--ry = normalized -1..1 offset
   from centre for parallax — see ProductPage's pointer handlers). The
   layers below read those vars purely in CSS (.rt-l → translate by --d),
   so movement is driven by hover + cursor position, with no JS per frame
   and no autonomous loop. Reduced-motion users get the static scene.
   ════════════════════════════════════════════════════════════════════ */
const RtArrow = ({ size = 16 }) => (
  <svg viewBox="0 0 18 18" width={size} height={size}>
    <path d={RT_ARROW} fill="currentColor" />
  </svg>
);

// All scenes are MONOCHROME (grey) at rest and shift to the single accent on
// card hover — no inline colours anywhere, so the palette stays one accent.

// 1 — Live presence: an avatar stack + scattered depth dots.
function ArtPresence() {
  return (
    <div className="rt-card-art rt-card-art--presence">
      <i className="rt-l rt-bgdot rt-bgdot--1" style={{ '--d': '-7px' }} />
      <i className="rt-l rt-bgdot rt-bgdot--2" style={{ '--d': '13px' }} />
      <div className="rt-l rt-stack" style={{ '--d': '10px' }}>
        <span className="rt-ava">M</span>
        <span className="rt-ava">D</span>
        <span className="rt-ava">S</span>
        <span className="rt-ava">A</span>
        <span className="rt-ava rt-ava--more">+3</span>
      </div>
    </div>
  );
}

// 2 — Live cursors: two named pointers at different parallax depths.
function ArtCursors() {
  return (
    <div className="rt-card-art rt-card-art--cursors">
      <span className="rt-l rt-cur rt-cur--a" style={{ '--d': '13px' }}>
        <RtArrow /><em>Mia</em>
      </span>
      <span className="rt-l rt-cur rt-cur--b" style={{ '--d': '-9px' }}>
        <RtArrow /><em>Daniel</em>
      </span>
    </div>
  );
}

// 3 — Cursor chat: a pointer carrying a bubble, with the Ctrl+M hint.
function ArtChat() {
  return (
    <div className="rt-card-art rt-card-art--chat">
      <span className="rt-l rt-cur rt-cur--c" style={{ '--d': '13px' }}>
        <RtArrow />
        <span className="rt-cur-bubble">back in 5 ✦</span>
      </span>
      <span className="rt-l rt-kbd" style={{ '--d': '-7px' }}><i>Ctrl</i><i>M</i></span>
    </div>
  );
}

// 4 — Shared editing: a field being typed into, a teammate's pointer on it.
function ArtEdit() {
  return (
    <div className="rt-card-art rt-card-art--edit">
      <div className="rt-l rt-field" style={{ '--d': '7px' }}>
        <span className="rt-field-txt">Polo Sweater</span>
        <i className="rt-field-caret" />
        <span className="rt-field-tag">Mia</span>
      </div>
      <span className="rt-l rt-cur rt-cur--d" style={{ '--d': '16px' }}>
        <RtArrow size={14} />
      </span>
    </div>
  );
}

// 5 — Jump to a teammate: a pointer arcing toward a teammate avatar.
// Self-contained centred row so cursor → arc → avatar always stay connected.
function ArtJump() {
  return (
    <div className="rt-card-art rt-card-art--jump">
      <div className="rt-l rt-jump" style={{ '--d': '10px' }}>
        <span className="rt-cur"><RtArrow /></span>
        <svg className="rt-jump-line" viewBox="0 0 80 44" preserveAspectRatio="none">
          <path d="M4,34 Q40,-4 76,20" />
        </svg>
        <span className="rt-target"><span className="rt-ava">D</span></span>
      </div>
    </div>
  );
}

// 6 — Built to scale: one socket fanning out to many clients. Rendered TWICE —
// a grey base + an accent copy revealed by a radial mask that follows the
// cursor, so the ILLUSTRATION's own lines light up under the pointer (Supabase
// Postgres-style), not the card frame.
const ScaleScene = () => (
  <div className="rt-scale">
    <svg className="rt-wires" viewBox="0 0 180 100" preserveAspectRatio="none">
      <path d="M24,50 C76,50 92,20 156,20" />
      <path d="M24,50 L156,50" />
      <path d="M24,50 C76,50 92,80 156,80" />
    </svg>
    <span className="rt-node rt-node--hub" />
    <span className="rt-node rt-node--a" />
    <span className="rt-node rt-node--b" />
    <span className="rt-node rt-node--c" />
  </div>
);
function ArtScale() {
  return (
    <div className="rt-card-art rt-card-art--scale">
      <div className="rt-scale-layer rt-scale-base"><ScaleScene /></div>
      <div className="rt-scale-layer rt-scale-glow" aria-hidden="true"><ScaleScene /></div>
    </div>
  );
}

// Per-card interaction flags read by ProductPage.
ArtCursors.hasLiveCursor = true;   // the "…" bubble rides the REAL cursor — only here
ArtCursors.pointer = true;         // scene layers parallax with the cursor
ArtChat.pointer = true;
ArtEdit.pointer = true;
ArtScale.illusGlow = true;         // the ILLUSTRATION (not the card) lights up under the cursor

// Per-slug capability-card art. Order matches `cards` in product.json.
// Only slugs listed here get the interactive hover panels; the rest keep
// the plain static cards.
export const CARD_ART = {
  realtime: [ArtPresence, ArtCursors, ArtChat, ArtEdit, ArtJump, ArtScale],
};
