// Proactive "this feature needs a paid plan" plaque. Shown to Free orgs on
// gated pages (Email broadcasts, Cross-organization analytics) instead of a
// dead/non-interactive UI — turns every gate into a clear upgrade CTA.
//
// Props:
//   featureName — short feature label woven into the subtitle (e.g. "email broadcasts")
//   to          — navigation target for the Upgrade button (default "/pricing")

import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sparkle, ArrowRight } from '@phosphor-icons/react';

export default function UpgradePlaque({ featureName, to = '/pricing' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const title = t('upgrade.title', { defaultValue: 'Available on Standard and above' });
  const subtitle = featureName
    ? t('upgrade.subFeature', {
        defaultValue: 'Upgrade to Standard or higher to unlock {{feature}}.',
        feature: featureName,
      })
    : t('upgrade.sub', { defaultValue: 'Upgrade your plan to unlock this feature.' });

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
      gap: 14, padding: '48px 24px', maxWidth: 460, margin: '40px auto',
      background: 'var(--accent-tint)', borderRadius: 16,
    }}>
      <div style={{
        width: 56, height: 56, display: 'grid', placeItems: 'center',
        borderRadius: 16, background: 'var(--accent)', color: '#fff',
      }}>
        <Sparkle size={28} weight="fill" />
      </div>

      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>{subtitle}</p>

      <button type="button" onClick={() => navigate(to)} style={{
        marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6,
        border: 'none', borderRadius: 999, padding: '10px 20px',
        fontSize: 13, fontWeight: 600, cursor: 'pointer',
        background: 'var(--accent)', color: '#fff',
      }}>
        {t('upgrade.cta', { defaultValue: 'Upgrade' })} <ArrowRight size={14} weight="bold" />
      </button>
    </div>
  );
}
