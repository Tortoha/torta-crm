// Signature illustrations for the product feature pages. Each is a small CSS
// composition animated by a subtle GSAP timeline that plays once when it
// scrolls into view. Reduced-motion users skip the animation entirely (the
// .pf-anim CSS override keeps everything visible). Tasteful by design —
// one-shot entrances, with at most one gentle looping accent per scene.

import { useEffect } from 'react';
import gsap from 'gsap';
import {
  ImageSquare, FilePdf, PaperPlaneTilt, ChatCircle, Globe,
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

/* ── Realtime: messages arriving live into one inbox ─────────────── */
function RealtimeIllus() {
  const ref = useGsapInView(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo('.pf-rt-msg', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.18 });
    // Looping typing dots on the last bubble.
    gsap.to('.pf-rt-typing i', { y: -3, opacity: 1, duration: 0.4, stagger: 0.14, repeat: -1, yoyo: true, ease: 'sine.inOut' });
  });
  const msgs = [
    { logo: 'telegram', from: 'Daniel', ch: 'Telegram', text: 'Is the jacket back in stock?' },
    { logo: 'whatsapp', from: 'Mia', ch: 'WhatsApp', text: 'Thanks, order received! 🙌' },
  ];
  return (
    <div className="pf-rt" ref={ref}>
      {msgs.map(({ logo, from, ch, text }, i) => (
        <div className="pf-rt-msg pf-card pf-anim" key={i}>
          <div className="pf-rt-av pf-rt-av--logo"><img src={`/brand-logos/${logo}.svg`} alt="" /></div>
          <div className="pf-rt-body">
            <div className="pf-rt-from">{from} <i>{ch}</i></div>
            <div className="pf-rt-text">{text}</div>
          </div>
        </div>
      ))}
      <div className="pf-rt-msg pf-card pf-anim">
        <div className="pf-rt-av"><ChatCircle weight="fill" /></div>
        <div className="pf-rt-body">
          <div className="pf-rt-from">Web chat <i>Live</i></div>
          <div className="pf-rt-typing"><i /><i /><i /></div>
        </div>
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
};
