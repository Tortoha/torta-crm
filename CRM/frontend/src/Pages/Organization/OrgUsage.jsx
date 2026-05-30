// Org Usage — /org/:slug/usage.
//
// Layout mirrors Project Analytics (SectionShell + an-tile / an-kpi-grid):
//   • Plan header — current plan name + monthly price + upgrade CTA
//   • Usage tiles — one card per quota (Projects / Team / Storefront users /
//     File storage / Broadcasts), each with current vs limit + progress bar
//   • Plan limits — secondary card listing static caps (API rate, SDK access)
//
// Backend already exposes GET /api/orgs/{id}/usage which returns
// { plan, usage, limits, percent }. We pretty-print each metric and pick a
// bar color based on percent (blue ok / amber warn / red critical).

import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  FolderSimple, UsersThree, Users, HardDrives, Database,
  PaperPlaneTilt, Lightning, ShoppingBag, ArrowRight,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { SectionShell } from '../Project/Analytics.jsx';
import '../../Style/Analytics.css';
import '../../Style/OrgUsage.css';
import i18n from '../../i18n.js';

const RESOURCE_DEFS = [
  { key: 'projects',         Icon: FolderSimple,    type: 'count' },
  { key: 'team_members',     Icon: UsersThree,      type: 'count' },
  { key: 'storefront_users', Icon: Users,           type: 'count' },
  { key: 'storage_bytes',    Icon: HardDrives,      type: 'bytes' },
  { key: 'database_bytes',   Icon: Database,        type: 'bytes' },
  { key: 'broadcasts_today', Icon: PaperPlaneTilt,  type: 'count' },
];

function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / (1024 ** 2)).toFixed(1)} MB`;
  return `${(n / (1024 ** 3)).toFixed(2)} GB`;
}

function fmtCount(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat(i18n.language || 'en').format(n);
}

function fmtMetric(value, type) {
  return type === 'bytes' ? fmtBytes(value) : fmtCount(value);
}

// Pick severity for a percent so the bar + value glow accordingly.
function severity(percent) {
  if (percent == null) return 'unlimited';
  if (percent >= 95)   return 'crit';
  if (percent >= 80)   return 'warn';
  return 'ok';
}

// ── KPI tile with progress bar ────────────────────────────────────────
function UsageTile({ Icon, label, used, limit, percent, type }) {
  const { t } = useTranslation();
  const sev = severity(percent);
  const unlimited = limit == null;
  const usedFmt   = fmtMetric(used, type);
  const limitFmt  = unlimited
    ? t('usage.unlimited', { defaultValue: 'Unlimited' })
    : fmtMetric(limit, type);
  return (
    <div className={`an-tile ou-tile ou-tile--${sev}`}>
      <div className="ou-tile-head">
        <div className="ou-tile-icon"><Icon size={18} weight="regular" /></div>
        <div className="an-kpi-label">{label}</div>
      </div>
      <div className="ou-tile-value">
        <span className="ou-used">{usedFmt}</span>
        <span className="ou-sep"> / </span>
        <span className="ou-limit">{limitFmt}</span>
      </div>
      <div className="ou-bar">
        <div className={`ou-bar-fill ou-bar-fill--${sev}`}
             style={{ width: unlimited ? '8%' : `${Math.min(100, percent || 0)}%` }} />
      </div>
      <div className="ou-tile-foot">
        {unlimited
          ? t('usage.barUnlimited', { defaultValue: 'No cap on this plan' })
          : t('usage.barPercent', {
              defaultValue: '{{percent}}% used',
              percent: Math.min(100, percent || 0),
            })}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
export default function OrgUsage() {
  const { t }   = useTranslation();
  const { org } = useOutletContext();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!org?.id) return;
    try {
      const r = await fetch(`${API_BASE}/api/orgs/${org.id}/usage`,
                            { credentials: 'include' });
      if (r.ok) setData(await r.json());
    } catch {/* keep prior data */}
  }, [org?.id]);

  useEffect(() => {
    if (!org?.id) return;
    setLoading(true);
    // Reconcile S3 storage first so the file-storage tile reflects truth
    // (historical uploads sometimes missed the delta-counter). Fire-and-
    // forget — we still render even if it fails; reload runs after.
    fetch(`${API_BASE}/api/orgs/${org.id}/usage/reconcile-storage`,
          { method: 'POST', credentials: 'include' })
      .catch(() => {})
      .finally(() => {
        reload().finally(() => setLoading(false));
      });
  }, [org?.id, reload]);

  if (loading) {
    return (
      <div className="ou-page ou-page--loading">
        <div className="ou-skel" />
      </div>
    );
  }

  const plan      = data?.plan || {};
  const planSlug  = plan.slug || 'free';
  const planName  = plan.name || 'Free';
  const planPrice = plan.price_usd || 0;
  const usage     = data?.usage   || {};
  const limits    = data?.limits  || {};
  const percent   = data?.percent || {};

  const labelFor = (key) => t(`usage.metrics.${key}`, {
    defaultValue: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  });

  return (
    <div className="ou-page">
      <h1 className="crm-page-title">{t('usage.title', { defaultValue: 'Usage' })}</h1>

      {/* ── Plan header banner ── */}
      <section className="an-section">
        <SectionShell
          title={t('usage.planSection', { defaultValue: 'Current plan' })}
          hidePeriod>
          <div className="an-tile ou-plan">
            <div className="ou-plan-left">
              <div className="ou-plan-icon"><ShoppingBag size={24} weight="regular" /></div>
              <div>
                <div className="ou-plan-name">{planName}</div>
                <div className="ou-plan-sub">
                  {planSlug === 'free'
                    ? t('usage.planFreeSub', {
                        defaultValue: "You're on the Free plan — perfect for trying things out.",
                      })
                    : t('usage.planPaidSub', {
                        defaultValue: '${{price}}/mo · Includes all paid features and webhooks.',
                        price: planPrice,
                      })}
                </div>
              </div>
            </div>
            <Link to={`/org/${org?.slug}/billing`} className="auth-btn-check ou-plan-cta">
              <ArrowRight size={14} weight="regular" />
              {planSlug === 'free'
                ? t('usage.upgradeBtn', { defaultValue: 'Upgrade' })
                : t('usage.manageBtn',  { defaultValue: 'Manage' })}
            </Link>
          </div>
        </SectionShell>
      </section>

      {/* ── Usage tiles ── */}
      <section className="an-section">
        <SectionShell
          title={t('usage.usageSection', { defaultValue: 'Usage this period' })}
          hidePeriod>
          <div className="an-kpi-grid ou-kpi-grid">
            {RESOURCE_DEFS.map(({ key, Icon, type }) => (
              <UsageTile key={key}
                         Icon={Icon}
                         label={labelFor(key)}
                         used={usage[key]}
                         limit={limits[key]}
                         percent={percent[key]}
                         type={type} />
            ))}
          </div>
        </SectionShell>
      </section>

      {/* ── Static plan caps (API rate, SDK access) ── */}
      <section className="an-section">
        <SectionShell
          title={t('usage.capsSection', { defaultValue: 'Plan limits' })}
          hidePeriod>
          <div className="ou-caps-grid">
            <div className="an-tile ou-cap">
              <div className="ou-cap-icon"><Lightning size={18} weight="regular" /></div>
              <div className="ou-cap-text">
                <div className="ou-cap-label">{t('usage.caps.apiRate', { defaultValue: 'API requests / min' })}</div>
                <div className="ou-cap-value">
                  {plan.limits?.api_requests_per_minute_max || 60}
                </div>
              </div>
            </div>
            <div className="an-tile ou-cap">
              <div className="ou-cap-icon"><PaperPlaneTilt size={18} weight="regular" /></div>
              <div className="ou-cap-text">
                <div className="ou-cap-label">{t('usage.caps.broadcasts', { defaultValue: 'Email broadcasts' })}</div>
                <div className="ou-cap-value">
                  {limits.broadcasts_today === 0
                    ? t('usage.caps.broadcastsNone',   { defaultValue: 'Not included' })
                    : (limits.broadcasts_today
                        ? t('usage.caps.broadcastsLim', {
                            defaultValue: '{{n}}/day',
                            n: limits.broadcasts_today,
                          })
                        : t('usage.unlimited', { defaultValue: 'Unlimited' }))}
                </div>
              </div>
            </div>
          </div>
        </SectionShell>
      </section>
    </div>
  );
}
