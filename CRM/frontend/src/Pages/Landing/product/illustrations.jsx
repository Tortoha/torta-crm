// Signature illustrations for the product feature pages. Each is a small CSS
// composition animated by a subtle GSAP timeline that plays once when it
// scrolls into view. Reduced-motion users skip the animation entirely (the
// .pf-anim CSS override keeps everything visible). Tasteful by design —
// one-shot entrances, with at most one gentle looping accent per scene.

import { useEffect } from 'react';
import gsap from 'gsap';
import {
  ImageSquare, FilePdf, PaperPlaneTilt, Globe,
  InstagramLogo, ChatCircleDots, CheckCircle,
  MusicNotes, VideoCamera, FileZip, DownloadSimple, EnvelopeSimple,
  FileText, Storefront,
  Star, SealCheck,
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

/* ── Products: a live inventory card — variant rows whose stock bars fill
      in, a warehouse tag, and a "received / batch" badge floating up. ──── */
function ProductsIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo('.pf-inv-card', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5 });
    tl.fromTo('.pf-inv-row', { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.4, stagger: 0.12 }, '-=0.2');
    tl.to('.pf-inv-fill', { width: (i, el) => el.dataset.to, duration: 0.85, stagger: 0.12, ease: 'power1.inOut' }, '-=0.35');
    tl.fromTo('.pf-inv-recv', { opacity: 0, scale: 0.7, y: 10 }, { opacity: 1, scale: 1, y: 0, duration: 0.45, ease: 'back.out(2)' }, '-=0.1');
    gsap.to('.pf-inv-recv', { y: -5, duration: 1.9, repeat: -1, yoyo: true, ease: 'sine.inOut', delay: 0.6 });
  });
  const rows = [
    { sw: 'var(--accent)',            name: 'Gray / M',  to: '88%', n: '142' },
    { sw: 'rgba(var(--fg-rgb), 0.8)', name: 'Black / M', to: '56%', n: '90' },
    { sw: 'rgba(var(--fg-rgb), 0.3)', name: 'Sand / L',  to: '20%', n: '11' },
  ];
  return (
    <div className="pf-inv" ref={ref}>
      <div className="pf-inv-card pf-card pf-anim">
        <div className="pf-inv-head">
          <b>Cotton Tee</b>
          <span className="pf-inv-wh">Main warehouse</span>
        </div>
        {rows.map((r, i) => (
          <div className="pf-inv-row pf-anim" key={i}>
            <i className="pf-inv-sw" style={{ background: r.sw }} />
            <span className="pf-inv-name">{r.name}</span>
            <span className="pf-inv-track"><i className="pf-inv-fill" data-to={r.to} /></span>
            <span className="pf-inv-n">{r.n}</span>
          </div>
        ))}
      </div>
      <span className="pf-inv-recv pf-anim">+120 received · Batch B-2026</span>
    </div>
  );
}

/* ── Booking: a week calendar with appointment blocks of different durations
      dropping into their slots; one keeps drifting (a live reschedule) and a
      "Confirmed" pill settles in — mirrors the real Booking calendar. ───── */
function BookingIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.fromTo('.pf-cal-card', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5 });
    tl.fromTo('.pf-cal-day', { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.05 }, '-=0.2');
    tl.fromTo('.pf-cal-ev', { opacity: 0, scaleY: 0.3 }, { opacity: 1, scaleY: 1, duration: 0.45, stagger: 0.12, ease: 'back.out(1.5)' }, '-=0.05');
    tl.fromTo('.pf-cal-chk', { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: 0.42, ease: 'back.out(2.4)' }, '-=0.1');
    gsap.to('.pf-cal-ev--move', { yPercent: 30, duration: 2.7, repeat: -1, yoyo: true, ease: 'sine.inOut', delay: 0.6 });
  });
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const evs = [
    { c: 0, t: '6%',  h: '24%', name: 'Haircut', time: '09:00', cls: '' },
    { c: 2, t: '14%', h: '46%', name: 'Consult', time: '10:30', cls: 'pf-cal-ev--move' },
    { c: 3, t: '56%', h: '22%', name: 'Fitting', time: '13:00', cls: 'pf-cal-ev--soft' },
  ];
  return (
    <div className="pf-cal" ref={ref}>
      <div className="pf-cal-card pf-card pf-anim">
        <div className="pf-cal-days">
          {days.map((d, i) => <span className="pf-cal-day pf-anim" key={i}>{d}</span>)}
        </div>
        <div className="pf-cal-body">
          {evs.map((e, i) => (
            <span className={`pf-cal-ev pf-anim ${e.cls}`} key={i}
              style={{ '--c': e.c, '--t': e.t, '--h': e.h }}>
              <em>{e.name}</em><i>{e.time}</i>
            </span>
          ))}
        </div>
        <span className="pf-cal-chk pf-anim"><CheckCircle weight="fill" /> Confirmed</span>
      </div>
    </div>
  );
}

/* ── Chat: messenger channels on the left, their wires converging into a
      single live inbox on the right — the omnichannel story in one frame. ─ */
function ChatIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo('.pf-omni-ch', { opacity: 0, scale: 0.5, x: -12 },
      { opacity: 1, scale: 1, x: 0, duration: 0.42, stagger: 0.08, ease: 'back.out(1.8)' });
    tl.fromTo('.pf-omni-inbox', { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: 0.5 }, '-=0.25');
    tl.fromTo('.pf-omni-msg', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.34, stagger: 0.14 }, '-=0.15');
    tl.fromTo('.pf-omni-badge', { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(2.4)' }, '-=0.05');
    gsap.set('.pf-omni-line', { strokeDasharray: '5 9' });
    gsap.to('.pf-omni-line', { strokeDashoffset: -28, duration: 1.3, repeat: -1, ease: 'none' });
  });
  const chans = [
    { logo: 'telegram' }, { logo: 'whatsapp' }, { Ic: InstagramLogo }, { logo: 'discord' }, { Ic: ChatCircleDots },
  ];
  return (
    <div className="pf-omni" ref={ref}>
      <div className="pf-omni-channels">
        {chans.map(({ logo, Ic }, i) => (
          <span className="pf-omni-ch pf-anim" key={i}>
            {logo ? <img src={`/brand-logos/${logo}.svg`} alt="" /> : <Ic weight="fill" />}
          </span>
        ))}
      </div>
      <svg className="pf-omni-wire" viewBox="0 0 56 240" preserveAspectRatio="none">
        <path className="pf-omni-line" d="M2,22 C38,22 28,120 54,120" />
        <path className="pf-omni-line" d="M2,71 C38,71 32,120 54,120" />
        <path className="pf-omni-line" d="M2,120 L54,120" />
        <path className="pf-omni-line" d="M2,169 C38,169 32,120 54,120" />
        <path className="pf-omni-line" d="M2,218 C38,218 28,120 54,120" />
      </svg>
      <div className="pf-omni-inbox pf-card pf-anim">
        <div className="pf-omni-inbox-head">
          <span className="pf-omni-dot" /> One inbox
          <span className="pf-omni-badge pf-anim">3</span>
        </div>
        <span className="pf-omni-msg pf-anim">Is the jacket back in stock?</span>
        <span className="pf-omni-msg is-me pf-anim">Yes — restocked this morning ✦</span>
      </div>
    </div>
  );
}

/* ── Digital: the files you sell fan in, bundle into a single ZIP, then a
      "Delivered by email" pill confirms hands-free delivery. ───────────── */
function DigitalIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo('.pf-dl-file', { opacity: 0, y: -18, rotate: 0 },
      { opacity: 1, y: 0, rotate: (i) => (i - 1) * 7, duration: 0.45, stagger: 0.1, ease: 'back.out(1.5)' });
    tl.fromTo('.pf-dl-zip', { opacity: 0, scale: 0.6, y: 10 },
      { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: 'back.out(1.8)' }, '+=0.05');
    tl.fromTo('.pf-dl-sent', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4 }, '-=0.1');
    gsap.to('.pf-dl-zip-ar', { y: 5, duration: 1.1, repeat: -1, yoyo: true, ease: 'sine.inOut' });
  });
  const files = [
    { Ic: FilePdf, name: 'guide.pdf' },
    { Ic: MusicNotes, name: 'track.mp3' },
    { Ic: VideoCamera, name: 'promo.mp4' },
  ];
  return (
    <div className="pf-dl" ref={ref}>
      <div className="pf-dl-files">
        {files.map(({ Ic, name }, i) => (
          <span className="pf-dl-file pf-card pf-anim" key={i}>
            <Ic weight="fill" /> {name}
          </span>
        ))}
      </div>
      <div className="pf-dl-zip pf-card pf-anim">
        <span className="pf-dl-zip-ic"><FileZip weight="fill" /></span>
        <span className="pf-dl-zip-meta"><b>orders.zip</b><i>3 files · ready</i></span>
        <span className="pf-dl-zip-ar"><DownloadSimple weight="bold" /></span>
      </div>
      <span className="pf-dl-sent pf-anim"><EnvelopeSimple weight="fill" /> Delivered by email</span>
    </div>
  );
}

/* ── Analytics: KPI tiles + a revenue line that draws itself in, with a
      live pulsing dot at the leading edge. ──────────────────────────── */
function AnalyticsIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo('.pf-an-card', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5 });
    tl.fromTo('.pf-an-kpi', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, stagger: 0.1 }, '-=0.2');
    const path = ref.current?.querySelector('.pf-an-line');
    if (path) {
      const len = path.getTotalLength() || 300;
      gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
      tl.to(path, { strokeDashoffset: 0, duration: 1.0, ease: 'power1.inOut' }, '-=0.1');
    }
    tl.fromTo('.pf-an-area', { opacity: 0 }, { opacity: 1, duration: 0.5 }, '-=0.55');
    tl.fromTo('.pf-an-dot', { scale: 0 }, { scale: 1, duration: 0.3, ease: 'back.out(2)' }, '-=0.15');
    gsap.to('.pf-an-dot', { scale: 1.35, duration: 1.1, repeat: -1, yoyo: true, ease: 'sine.inOut', delay: 0.5, transformOrigin: 'center' });
  });
  return (
    <div className="pf-an" ref={ref}>
      <div className="pf-an-card pf-card pf-anim">
        <div className="pf-an-kpis">
          <div className="pf-an-kpi pf-anim"><span>Revenue</span><b>$24.8k</b><i className="pf-an-up">▲ 18%</i></div>
          <div className="pf-an-kpi pf-anim"><span>Margin</span><b>41%</b><i className="pf-an-up">▲ 4%</i></div>
        </div>
        <div className="pf-an-chart">
          <svg viewBox="0 0 260 92" preserveAspectRatio="none">
            <path className="pf-an-area pf-anim" d="M0,72 L20,62 L55,66 L95,42 L135,48 L175,26 L215,32 L258,12 L258,92 L0,92 Z" />
            <path className="pf-an-line" d="M0,72 L20,62 L55,66 L95,42 L135,48 L175,26 L215,32 L258,12" />
          </svg>
          <span className="pf-an-dot" />
        </div>
      </div>
    </div>
  );
}

/* ── Accounting: a built export file whose wires fan out to the accounting
      systems it lands in, then a "Sent" pill. ───────────────────────── */
function AccountingIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo('.pf-acc-file', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5 });
    tl.fromTo('.pf-acc-row', { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.3, stagger: 0.08 }, '-=0.2');
    tl.fromTo('.pf-acc-dest', { opacity: 0, x: 14, scale: 0.8 }, { opacity: 1, x: 0, scale: 1, duration: 0.38, stagger: 0.1, ease: 'back.out(1.6)' }, '-=0.1');
    tl.fromTo('.pf-acc-sent', { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(2.4)' }, '-=0.05');
    gsap.set('.pf-acc-line', { strokeDasharray: '5 8' });
    gsap.to('.pf-acc-line', { strokeDashoffset: -26, duration: 1.3, repeat: -1, ease: 'none' });
  });
  const dests = [
    { label: '1C', soft: false }, { label: 'Kompra', soft: true },
    { label: 'QuickBooks', soft: true }, { label: 'Xero', soft: false },
  ];
  return (
    <div className="pf-acc" ref={ref}>
      <div className="pf-acc-file pf-card pf-anim">
        <div className="pf-acc-file-head"><FileText weight="fill" /> <b>orders_june.csv</b></div>
        <div className="pf-acc-row pf-anim"><span>Orders</span><i>142</i></div>
        <div className="pf-acc-row pf-anim"><span>Net</span><i>$22,140</i></div>
        <div className="pf-acc-row pf-anim"><span>VAT 12%</span><i>$2,657</i></div>
      </div>
      <svg className="pf-acc-wire" viewBox="0 0 44 200" preserveAspectRatio="none">
        <path className="pf-acc-line" d="M2,100 C28,100 20,30 42,30" />
        <path className="pf-acc-line" d="M2,100 C28,100 22,77 42,77" />
        <path className="pf-acc-line" d="M2,100 C28,100 22,123 42,123" />
        <path className="pf-acc-line" d="M2,100 C28,100 20,170 42,170" />
      </svg>
      <div className="pf-acc-dests">
        {dests.map((d, i) => (
          <span className={`pf-acc-dest pf-anim${d.soft ? ' is-soft' : ''}`} key={i}>{d.label}</span>
        ))}
      </div>
      <span className="pf-acc-sent pf-anim"><CheckCircle weight="fill" /> Sent</span>
    </div>
  );
}

/* ── POS: a barcode with a scan beam sweeping across it, a receipt that
      fills in, and a "Stock updated" pill (the omnichannel payoff). ──── */
function PosIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo('.pf-pos-scan', { opacity: 0, y: -14 }, { opacity: 1, y: 0, duration: 0.45 });
    tl.fromTo('.pf-pos-receipt', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5 }, '-=0.2');
    tl.fromTo('.pf-pos-line', { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.3, stagger: 0.1 }, '-=0.2');
    tl.fromTo('.pf-pos-paid', { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: 0.42, ease: 'back.out(2.4)' }, '-=0.05');
    gsap.fromTo('.pf-pos-beam', { top: '14%' }, { top: '76%', duration: 1.5, repeat: -1, yoyo: true, ease: 'sine.inOut' });
  });
  const bars = [3, 1, 2, 1, 3, 2, 1, 2, 3, 1, 1, 2, 3, 1, 2, 1, 3, 2, 1, 3];
  return (
    <div className="pf-pos" ref={ref}>
      <div className="pf-pos-scan pf-card pf-anim">
        <div className="pf-pos-barcode">
          {bars.map((w, i) => <i key={i} style={{ width: w + 'px' }} />)}
          <span className="pf-pos-beam" />
        </div>
        <span className="pf-pos-code">7 6 2 0 4 1 · scanned</span>
      </div>
      <div className="pf-pos-receipt pf-card pf-anim">
        <div className="pf-pos-line pf-anim"><span>Cotton Tee · Gray M</span><i>$24</i></div>
        <div className="pf-pos-line pf-anim"><span>Cap · Black</span><i>$15</i></div>
        <div className="pf-pos-line pf-pos-total pf-anim"><span>Total · Cash</span><i>$39</i></div>
      </div>
      <span className="pf-pos-paid pf-anim"><CheckCircle weight="fill" /> Stock updated</span>
    </div>
  );
}

/* ── Multi-store: separate stores (each its own currency) whose wires
      converge into one organization-wide total. ─────────────────────── */
function MultiStoreIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo('.pf-ms-store', { opacity: 0, x: -14, scale: 0.9 }, { opacity: 1, x: 0, scale: 1, duration: 0.4, stagger: 0.1, ease: 'back.out(1.5)' });
    tl.fromTo('.pf-ms-total', { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: 0.5 }, '-=0.2');
    tl.fromTo('.pf-ms-total b', { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4 }, '-=0.15');
    gsap.set('.pf-ms-line', { strokeDasharray: '5 8' });
    gsap.to('.pf-ms-line', { strokeDashoffset: -26, duration: 1.3, repeat: -1, ease: 'none' });
  });
  const stores = [
    { name: 'Aurora', meta: '₸4.2M' }, { name: 'Nova', meta: '$18.9k' }, { name: 'Lumen', meta: '€12.4k' },
  ];
  return (
    <div className="pf-ms" ref={ref}>
      <div className="pf-ms-stores">
        {stores.map((s, i) => (
          <span className="pf-ms-store pf-anim" key={i}>
            <Storefront weight="fill" />
            <span className="pf-ms-store-meta"><b>{s.name}</b><i>{s.meta}</i></span>
          </span>
        ))}
      </div>
      <svg className="pf-ms-wire" viewBox="0 0 44 150" preserveAspectRatio="none">
        <path className="pf-ms-line" d="M2,24 C28,24 20,75 42,75" />
        <path className="pf-ms-line" d="M2,75 L42,75" />
        <path className="pf-ms-line" d="M2,126 C28,126 20,75 42,75" />
      </svg>
      <div className="pf-ms-total pf-card pf-anim">
        <span className="pf-ms-total-label">All stores</span>
        <b>$71.3k</b>
        <span className="pf-ms-total-sub">3 stores · USD</span>
      </div>
    </div>
  );
}

/* ── Team & roles: a member with a role, and a per-page permission matrix
      where the active level (none / view / manage) lights up per row. ──── */
function TeamIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo('.pf-rl-card', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5 });
    tl.fromTo('.pf-rl-member', { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(1.8)' }, '-=0.2');
    tl.fromTo('.pf-rl-row', { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.34, stagger: 0.1 }, '-=0.1');
    tl.fromTo('.pf-rl-seg.is-on', { scale: 0.3 }, { scale: 1, duration: 0.32, stagger: 0.1, ease: 'back.out(2.4)' }, '-=0.1');
  });
  const LBL = ['—', 'View', 'Manage'];
  const rows = [
    { page: 'Products', lvl: 2 },
    { page: 'Orders', lvl: 2 },
    { page: 'Promo codes', lvl: 1 },
    { page: 'Billing', lvl: 0 },
  ];
  return (
    <div className="pf-rl" ref={ref}>
      <div className="pf-rl-card pf-card pf-anim">
        <div className="pf-rl-member pf-anim">
          <span className="pf-rl-ava">M</span>
          <span className="pf-rl-name"><b>Mia</b><i>Manager</i></span>
        </div>
        {rows.map((r, i) => (
          <div className="pf-rl-row pf-anim" key={i}>
            <span className="pf-rl-page">{r.page}</span>
            <div className="pf-rl-segs">
              {[0, 1, 2].map(s => (
                <span key={s} className={`pf-rl-seg${s === r.lvl ? ' is-on' : ''}`}>{LBL[s]}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Multi-currency: the same product priced in three currencies, plus a
      row of more currency-symbol chips. ─────────────────────────────── */
function CurrenciesIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo('.pf-cur-tag', { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.4, stagger: 0.12, ease: 'back.out(1.4)' });
    tl.fromTo('.pf-cur-chip', { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.3, stagger: 0.05, ease: 'back.out(2)' }, '-=0.1');
  });
  const tags = [
    { sym: '$', amt: '24.00', cc: 'USD' },
    { sym: '₸', amt: '11 200', cc: 'KZT' },
    { sym: '€', amt: '22.40', cc: 'EUR' },
  ];
  const chips = ['£', '₽', 'R$', '¥', 'zł', '₺', '₴', '﷼'];
  return (
    <div className="pf-cur" ref={ref}>
      <div className="pf-cur-tags">
        {tags.map((t, i) => (
          <span className="pf-cur-tag pf-card pf-anim" key={i}>
            <b>{t.sym}{t.amt}</b><i>{t.cc}</i>
          </span>
        ))}
      </div>
      <div className="pf-cur-chips">
        {chips.map((c, i) => <span className="pf-cur-chip pf-anim" key={i}>{c}</span>)}
      </div>
    </div>
  );
}

/* ── Reviews: a verified-buyer review card — stars pop in, photos and a
      merchant reply settle. ─────────────────────────────────────────── */
function ReviewsIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo('.pf-rv-card', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5 });
    tl.fromTo('.pf-rv-verified', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.34, ease: 'back.out(2)' }, '-=0.2');
    tl.fromTo('.pf-rv-star', { scale: 0, rotate: -25 }, { scale: 1, rotate: 0, duration: 0.3, stagger: 0.08, ease: 'back.out(2.4)' }, '-=0.1');
    tl.fromTo('.pf-rv-photo', { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.3, stagger: 0.08, ease: 'back.out(1.8)' }, '-=0.05');
    tl.fromTo('.pf-rv-reply', { opacity: 0, x: 14 }, { opacity: 1, x: 0, duration: 0.4 }, '-=0.05');
  });
  return (
    <div className="pf-rv" ref={ref}>
      <div className="pf-rv-card pf-card pf-anim">
        <div className="pf-rv-head">
          <span className="pf-rv-ava">L</span>
          <span className="pf-rv-meta">
            <b>Liam</b>
            <span className="pf-rv-verified pf-anim"><SealCheck weight="fill" /> Verified buyer</span>
          </span>
        </div>
        <div className="pf-rv-stars">
          {[0, 1, 2, 3, 4].map(i => <Star key={i} className="pf-rv-star" weight="fill" />)}
        </div>
        <p className="pf-rv-text">Exactly as described — fast delivery, great quality.</p>
        <div className="pf-rv-photos">
          {[0, 1, 2].map(i => <span className="pf-rv-photo pf-anim" key={i} />)}
        </div>
        <div className="pf-rv-reply pf-anim"><b>Store</b> Thanks, Liam! ✦</div>
      </div>
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
  products: ProductsIllus,
  booking: BookingIllus,
  chat: ChatIllus,
  digital: DigitalIllus,
  analytics: AnalyticsIllus,
  accounting: AccountingIllus,
  pos: PosIllus,
  'multi-store': MultiStoreIllus,
  team: TeamIllus,
  currencies: CurrenciesIllus,
  reviews: ReviewsIllus,
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
