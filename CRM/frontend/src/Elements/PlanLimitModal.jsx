// Global plan-limit modal — listens for the `plan_limit_exceeded` window event
// (dispatched by Utils/planLimit.js fetch interceptor) and renders a one-off
// modal explaining which resource hit its limit and offering an upgrade CTA.
//
// Mounted once at the App root so any 402 anywhere in the app triggers it.
// The interceptor is the single source — components that hit 402 still see
// the raw response and render their own inline error if useful.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from '@phosphor-icons/react';
import { onPlanLimit } from '../Utils/planLimit.js';
import '../Style/Modal.css';

// Human-friendly resource labels. Falls back to the raw key if unknown.
const RESOURCE_LABELS = {
  projects:           'projects',
  team_members:       'team members',
  storefront_users:   'storefront customers',
  storage_bytes:      'storage',
  emails_today:       'emails (today)',
  broadcasts:         'email broadcasts',
};

// Pretty-print byte counts for storage limits — same shape as the
// Org Settings usage meter. Returns "" for non-byte resources.
function fmtBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576)    return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024)       return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

export default function PlanLimitModal() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [detail, setDetail] = useState(null);

  useEffect(() => onPlanLimit(setDetail), []);

  if (!detail) return null;
  const resource = detail.resource || '';
  const planName = detail.plan || 'free';
  const isBytes  = resource === 'storage_bytes';
  const current  = isBytes ? fmtBytes(detail.current) : (detail.current ?? 0);
  const limit    = isBytes ? fmtBytes(detail.limit)   : (detail.limit   ?? 0);
  const resLabel = RESOURCE_LABELS[resource] || resource;

  function close()    { setDetail(null); }
  function upgrade()  { setDetail(null); navigate('/pricing'); }

  return createPortal(
    <div className="modal-backdrop" onClick={close}>
      <div className="modal plimit-modal" onClick={e => e.stopPropagation()}>
        <div className="plimit-body">
          <h2 className="plimit-title">
            {t('planLimit.title', { defaultValue: 'Plan limit reached' })}
          </h2>
          <p className="plimit-sub">
            {t('planLimit.body', {
              defaultValue:
                'Your {{plan}} plan is capped at {{limit}} {{resource}}. You currently have {{current}}.',
              plan:     planName,
              limit,
              current,
              resource: resLabel,
            })}
          </p>
          <p className="plimit-cta-line">
            {t('planLimit.upgradePrompt', {
              defaultValue: 'Upgrade to a higher plan to keep going.',
            })}
          </p>
          <div className="plimit-actions">
            <button type="button" className="plimit-btn-ghost" onClick={close}>
              {t('planLimit.later', { defaultValue: 'Maybe later' })}
            </button>
            <button type="button" className="plimit-btn-primary" onClick={upgrade}>
              {t('planLimit.upgrade', { defaultValue: 'See plans' })}
              <ArrowRight size={14} weight="bold" />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
