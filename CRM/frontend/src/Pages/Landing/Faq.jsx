// FAQ — answers the common buyer objections AND powers FAQ rich results in
// Google. The matching FAQPage JSON-LD lives in index.html; the question/answer
// text here MUST stay in sync with that schema (Google requires the structured
// data to reflect what's visible on the page). English is the default (the SPA
// is client-i18n'd, so crawlers see English); other languages fall back to it.

import { useTranslation } from 'react-i18next';
import { useInView } from '../../Utils/useInView.js';

const FAQ = [
  { key: 'what',
    q: 'What is Torta CRM?',
    a: 'Torta CRM is one platform to run an online store — products, orders, bookings, live customer chat, email campaigns and analytics — without juggling a dozen separate tools.' },
  { key: 'free',
    q: 'Is there a free plan?',
    a: 'Yes. Start free, no credit card required. Upgrade only when you need more projects, team members, or storage.' },
  { key: 'allinone',
    q: 'How is it different from using separate tools?',
    a: 'Instead of stitching together a store builder, a CRM, a help desk, an email tool and a spreadsheet, Torta runs all of it in one workspace with shared customer and order data.' },
  { key: 'developer',
    q: 'Do I need a developer to set it up?',
    a: 'No — you run everything from the console. There is also a developer API and the torta-js SDK if you want to connect a custom storefront.' },
  { key: 'security',
    q: 'Is my data secure?',
    a: 'Yes. Two-key API security, per-project access control, DKIM-signed email and role-based permissions are wired in by default.' },
  { key: 'refund',
    q: 'Can I get a refund?',
    a: 'Yes — a 14-day money-back guarantee on your first payment, one-time per organization. You keep access until the current period ends.' },
];

export default function Faq() {
  const { t } = useTranslation();
  const { ref, inView } = useInView({ threshold: 0.2 });
  return (
    <section className="ln-section ln-section--tight" id="faq">
      <div className="ln-wrap">
        <div ref={ref} className={`ln-section-head ln-section-head--center ln-reveal${inView ? ' ln-in' : ''}`}>
          <span className="ln-eyebrow">{t('landing.faq.eyebrow', { defaultValue: 'FAQ' })}</span>
          <h2 className="ln-section-title">{t('landing.faq.title', { defaultValue: 'Common questions' })}</h2>
        </div>
        <div className="ln-faq-list">
          {FAQ.map(({ key, q, a }) => (
            <details key={key} className="ln-faq-item">
              <summary className="ln-faq-q">{t(`landing.faq.items.${key}.q`, { defaultValue: q })}</summary>
              <p className="ln-faq-a">{t(`landing.faq.items.${key}.a`, { defaultValue: a })}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
