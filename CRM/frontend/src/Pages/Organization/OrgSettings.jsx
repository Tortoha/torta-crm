// Organization Settings — same bulk-style layout as Project Settings
// (Section + FieldCard + SearchableCombobox, all reused from ProjectSettings).
// One scrolling page, save-on-change, toast per commit.
//
// Sections:
//   1. General      — org name + display currency (with a warning modal that
//                     explains the org currency is an Analytics rollup, not a
//                     per-project re-price — analytics FX-converts every
//                     project's revenue into this code before summing).
//   2. Danger zone  — delete the organization (blocked while it still has
//                     projects, mirroring the backend guard).

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Buildings, Warning, UsersThree } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { CURRENCIES, formatMoney, getCurrencyMeta } from '../../Utils/currency.js';
import { Section, FieldCard, SearchableCombobox, SegmentSwitch } from '../Project/ProjectSettings.jsx';
import '../../Style/Authentication.css';
import '../../Style/Products.css';

// ── Currency change warning modal (org variant) ───────────────────────
// Unlike the project modal (numbers stay, only symbol changes), the org
// currency IS a real FX rollup — so the copy here explains the rollup
// behaviour instead of promising "numbers don't change".
function OrgCurrencyWarningModal({ fromCode, toCode, onCancel, onConfirm }) {
  const { t } = useTranslation();
  const fromMeta = getCurrencyMeta(fromCode);
  const toMeta   = getCurrencyMeta(toCode);
  return (
    <div className="auth-modal-overlay" onClick={onCancel}>
      <div className="auth-modal" onClick={e => e.stopPropagation()} style={{ width: 520 }}>
        <div className="auth-modal-body">
          <div className="auth-modal-title-row">
            <h2 className="auth-modal-title">{t('org.settings.currencyModal.title')}</h2>
          </div>

          <p className="cpm-section-hint" style={{ marginTop: 0 }}>
            {t('org.settings.currencyModal.introPre')}
            <b>{toMeta.name} ({toMeta.symbol})</b>{t('org.settings.currencyModal.introMid')}
            <b>{fromMeta.name} ({fromMeta.symbol})</b>{t('org.settings.currencyModal.introPost')}
          </p>

          {/* Identity preview — code + symbol, NOT a converted amount, so we
              don't imply a 1:1 swap (analytics actually FX-converts). */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr auto 1fr',
            gap: 12, alignItems: 'center',
            padding: 16, borderRadius: 16,
            background: 'var(--accent-tint)', margin: '8px 0 12px',
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 4 }}>{t('org.settings.currencyModal.was')}</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{fromMeta.code} {fromMeta.symbol}</div>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 18 }}>→</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 4 }}>{t('org.settings.currencyModal.willBe')}</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--accent)' }}>{toMeta.code} {toMeta.symbol}</div>
            </div>
          </div>

          <ul style={{
            margin: 0, padding: '0 0 0 18px',
            color: 'var(--muted)', fontSize: 13, lineHeight: 1.55,
          }}>
            <li>{t('org.settings.currencyModal.bullet1')}</li>
            <li>{t('org.settings.currencyModal.bullet2')}</li>
            <li>{t('org.settings.currencyModal.bullet3')}</li>
          </ul>

          <div className="auth-actions" style={{ marginTop: 16 }}>
            <button type="button" className="crm-submit-btn" onClick={onConfirm}>
              {t('org.settings.currencyModal.confirm', { code: toMeta.code })}
            </button>
            <button type="button" className="auth-btn-danger"
              onClick={onCancel} style={{ marginLeft: 'auto' }}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Delete organization modal ─────────────────────────────────────────
// Blocked while the org still has projects (backend rejects it too). When
// allowed, requires typing the org name to arm the irreversible delete.
function DeleteOrgModal({ orgName, projectCount, busy, error, onCancel, onConfirm }) {
  const { t } = useTranslation();
  const [confirmText, setConfirmText] = useState('');
  const blocked = (projectCount || 0) > 0;
  const armed = !blocked && confirmText.trim() === orgName.trim() && !busy;
  return (
    <div className="auth-modal-overlay" onClick={onCancel}>
      <div className="auth-modal" onClick={e => e.stopPropagation()} style={{ width: 480 }}>
        <div className="auth-modal-body">
          <div className="auth-modal-title-row">
            <h2 className="auth-modal-title">{t('org.settings.deleteModal.title')}</h2>
          </div>

          {blocked ? (
            <p className="cpm-section-hint" style={{ marginTop: 0 }}>
              {t('org.settings.deleteModal.blockedPre')}
              <b>{t('org.settings.deleteModal.blockedProjects', { count: projectCount })}</b>
              {t('org.settings.deleteModal.blockedPost')}
            </p>
          ) : (
            <>
              <p className="cpm-section-hint" style={{ marginTop: 0 }}>
                {t('org.settings.deleteModal.allowedPre')}<b>{orgName}</b>{t('org.settings.deleteModal.allowedPost')}
              </p>
              <input className="crm-input" placeholder={orgName} value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                style={{ marginTop: 4 }} autoFocus />
            </>
          )}

          {error && <p className="auth-msg auth-msg--err">{error}</p>}

          <div className="auth-actions" style={{ marginTop: 16 }}>
            {!blocked && (
              <button type="button" className="crm-submit-btn"
                disabled={!armed} onClick={onConfirm}>
                {busy ? t('org.settings.deleteModal.deleting') : t('org.settings.deleteModal.deleteButton')}
              </button>
            )}
            <button type="button" className="crm-submit-btn auth-btn-secondary"
              onClick={onCancel} style={{ marginLeft: blocked ? 0 : 'auto' }}>
              {blocked ? t('org.settings.deleteModal.close') : t('common.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Disconnect (per-project) confirmation ─────────────────────────────
// Turning sharing OFF can become irreversible if accounts later diverge, so
// (mirroring the delete flow) we require the org name typed back to arm it.
function DisconnectCustomersModal({ orgName, busy, onCancel, onConfirm }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const armed = text.trim() === orgName.trim() && !busy;
  return (
    <div className="auth-modal-overlay" onClick={onCancel}>
      <div className="auth-modal" onClick={e => e.stopPropagation()} style={{ width: 480 }}>
        <div className="auth-modal-body">
          <div className="auth-modal-title-row">
            <h2 className="auth-modal-title">{t('org.settings.customers.disconnectModal.title')}</h2>
          </div>
          <p className="cpm-section-hint" style={{ marginTop: 0 }}>
            {t('org.settings.customers.disconnectModal.warning')}
          </p>
          <p className="cpm-section-hint" style={{ marginTop: 8 }}>
            {t('org.settings.customers.disconnectModal.typePre')}<b>{orgName}</b>{t('org.settings.customers.disconnectModal.typePost')}
          </p>
          <input className="crm-input" placeholder={orgName} value={text}
            onChange={e => setText(e.target.value)} style={{ marginTop: 4 }} autoFocus />
          <div className="auth-actions" style={{ marginTop: 16 }}>
            <button type="button" className="crm-submit-btn" disabled={!armed}
              onClick={() => onConfirm(text.trim())}>
              {t('org.settings.customers.disconnectModal.confirm')}
            </button>
            <button type="button" className="crm-submit-btn auth-btn-secondary"
              onClick={onCancel} style={{ marginLeft: 'auto' }}>{t('common.cancel')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Merge-conflict blocker (shown when turning sharing ON) ─────────────
function CustomerConflictModal({ conflicts, onClose }) {
  const { t } = useTranslation();
  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={e => e.stopPropagation()} style={{ width: 480 }}>
        <div className="auth-modal-body">
          <div className="auth-modal-title-row">
            <h2 className="auth-modal-title">{t('org.settings.customers.conflictModal.title')}</h2>
          </div>
          <p className="cpm-section-hint" style={{ marginTop: 0 }}>
            {t('org.settings.customers.conflictModal.intro')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' }}>
            {conflicts.map(c => (
              <div key={c.email} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', borderRadius: 12, background: 'var(--accent-tint)', fontSize: 13,
              }}>
                <span>{c.email}</span>
                <span style={{ color: 'var(--muted)' }}>
                  {t('org.settings.customers.conflictModal.accounts', { count: c.accounts })}
                </span>
              </div>
            ))}
          </div>
          <div className="auth-actions" style={{ marginTop: 16 }}>
            <button type="button" className="crm-submit-btn" onClick={onClose}>
              {t('org.settings.customers.conflictModal.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────
export default function OrgSettings() {
  const { t } = useTranslation();
  const { org } = useOutletContext();
  const navigate = useNavigate();

  const [toast, setToast] = useState('');
  const tref = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    if (tref.current) clearTimeout(tref.current);
    tref.current = setTimeout(() => setToast(''), 2400);
  }, []);

  // ── General: name + currency ──
  const [name, setName] = useState(org?.name || '');
  const [currency, setCurrency] = useState((org?.currency || 'USD').toUpperCase());
  const [pendingCurrency, setPendingCurrency] = useState(null);

  // Debounced name save (skip the first run so mounting doesn't re-PATCH the
  // value we just loaded). Matches the CRM auto-save convention for text.
  const firstName = useRef(true);
  useEffect(() => {
    if (firstName.current) { firstName.current = false; return; }
    const v = name.trim();
    if (!v || !org?.id) return;
    const timer = setTimeout(async () => {
      const r = await fetch(`${API_BASE}/api/orgs/${org.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: v }),
      });
      showToast(r.ok ? t('common.saved') : t('common.saveFailed'));
    }, 500);
    return () => clearTimeout(timer);
  }, [name, org?.id, showToast, t]);

  const saveCurrency = async (next) => {
    const r = await fetch(`${API_BASE}/api/orgs/${org.id}/currency`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: next }),
    });
    if (r.ok) { setCurrency(next); showToast(t('common.saved')); }
    else showToast(t('common.saveFailed'));
  };

  // ── Customers: org-shared identity toggle ──
  const [shared, setShared]               = useState(org?.customers_shared !== false);
  const [sharingBusy, setSharingBusy]     = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [conflicts, setConflicts]         = useState(null);   // null = closed; [...] = blocking list

  const applySharing = async (next, confirmText) => {
    setSharingBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/orgs/${org.id}/customers-sharing`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shared: next, confirm: confirmText ?? null }),
      });
      if (r.ok) {
        setShared(next);
        setDisconnectOpen(false);
        showToast(t('common.saved'));
      } else if (r.status === 409) {
        const j = await r.json().catch(() => ({}));
        setConflicts(j?.detail?.conflicts || []);
      } else {
        showToast(t('common.saveFailed'));
      }
    } catch {
      showToast(t('common.saveFailed'));
    } finally {
      setSharingBusy(false);
    }
  };

  const onToggleSharing = async (next) => {
    if (next === shared || sharingBusy) return;
    if (next) {
      // Turning ON — surface blocking conflicts before committing.
      try {
        const r = await fetch(`${API_BASE}/api/orgs/${org.id}/customers-sharing/conflicts`,
                              { credentials: 'include' });
        const j = await r.json().catch(() => ({}));
        if ((j?.conflicts || []).length) { setConflicts(j.conflicts); return; }
      } catch { /* fall through — backend re-checks on PATCH anyway */ }
      applySharing(true);
    } else {
      setDisconnectOpen(true);   // turning OFF needs typed confirmation
    }
  };

  // ── Danger zone: project count gate + delete ──
  const [projectCount, setProjectCount] = useState(null);
  useEffect(() => {
    if (!org?.id) return;
    fetch(`${API_BASE}/api/orgs/${org.id}/projects`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(rows => setProjectCount(Array.isArray(rows) ? rows.length : 0))
      .catch(() => setProjectCount(0));
  }, [org?.id]);

  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting]     = useState(false);
  const [deleteErr, setDeleteErr]   = useState('');
  const doDelete = async () => {
    setDeleting(true);
    setDeleteErr('');
    try {
      const r = await fetch(`${API_BASE}/api/orgs/${org.id}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (r.ok) { navigate('/dashboard'); return; }
      const j = await r.json().catch(() => ({}));
      setDeleteErr(j.detail || t('org.settings.deleteModal.couldNotDelete'));
    } catch {
      setDeleteErr(t('org.settings.deleteModal.networkError'));
    } finally {
      setDeleting(false);
    }
  };

  const hasProjects = (projectCount || 0) > 0;

  return (
    <>
      <h1 className="crm-page-title">{t('org.settings.title')}</h1>

      <div className="bulk-settings">

        {/* ── General ── */}
        <Section icon={<Buildings weight="duotone" />} title={t('org.settings.general.title')}
          subtitle={t('org.settings.general.subtitle')}>

          <FieldCard label={t('org.settings.general.nameLabel')}
            hint={t('org.settings.general.nameHint')}>
            <input className="crm-input" value={name} maxLength={100}
              style={{ maxWidth: 360 }}
              onChange={(e) => setName(e.target.value)} />
          </FieldCard>

          <FieldCard label={t('org.settings.general.currencyLabel')}
            hint={<>
              {t('org.settings.general.currencyHintPre')}
              <b>{t('org.settings.general.currencyHintBold')}</b>{t('org.settings.general.currencyHintPost')}
            </>}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
              <SearchableCombobox
                value={currency}
                onChange={(next) => {
                  if (next === currency) return;
                  setPendingCurrency(next);
                }}
                searchPlaceholder={t('org.settings.general.currencySearchPlaceholder')}
                options={(() => {
                  const list = CURRENCIES.some(c => c.code === currency)
                    ? CURRENCIES
                    : [getCurrencyMeta(currency), ...CURRENCIES];
                  return list.map(c => ({
                    value: c.code,
                    label: `${c.code} — ${c.name}`,
                    subLabel: c.symbol,
                    searchText: `${c.code} ${c.name} ${c.symbol}`,
                  }));
                })()} />
              <div style={{
                padding: '8px 14px', borderRadius: 999,
                background: 'var(--accent-tint)', color: 'var(--accent)',
                fontVariantNumeric: 'tabular-nums', fontWeight: 600,
                whiteSpace: 'nowrap',
              }}>
                {formatMoney(1234.5, currency)}
              </div>
            </div>
          </FieldCard>
        </Section>

        {/* ── Customers ── */}
        <Section icon={<UsersThree weight="duotone" />} title={t('org.settings.customers.title')}
          subtitle={t('org.settings.customers.subtitle')}>
          <FieldCard label={t('org.settings.customers.modeLabel')}
            hint={shared
              ? t('org.settings.customers.modeHintShared')
              : t('org.settings.customers.modeHintPerProject')}>
            <SegmentSwitch
              value={shared ? 'shared' : 'per_project'}
              disabled={sharingBusy}
              onChange={(v) => onToggleSharing(v === 'shared')}
              options={[
                { value: 'shared',      label: t('org.settings.customers.shared') },
                { value: 'per_project', label: t('org.settings.customers.perProject') },
              ]} />
          </FieldCard>
        </Section>

        {/* ── Danger zone ── */}
        <Section icon={<Warning weight="duotone" />} title={t('org.settings.danger.title')}
          subtitle={t('org.settings.danger.subtitle')}>
          <FieldCard label={t('org.settings.danger.deleteLabel')}
            hint={
              hasProjects
                ? <>{t('org.settings.danger.deleteHintBlockedPre')}<b>{t('org.settings.danger.deleteHintBlockedProjects', { count: projectCount })}</b>{t('org.settings.danger.deleteHintBlockedPost')}</>
                : <>{t('org.settings.danger.deleteHintAllowed')}</>
            }>
            <button type="button" className="auth-btn-danger"
              disabled={hasProjects}
              onClick={() => { setDeleteErr(''); setShowDelete(true); }}>
              {t('org.settings.danger.deleteButton')}
            </button>
          </FieldCard>
        </Section>
      </div>

      {/* Currency-change warning modal — gates the dropdown commit. */}
      {pendingCurrency && createPortal(
        <OrgCurrencyWarningModal
          fromCode={currency}
          toCode={pendingCurrency}
          onCancel={() => setPendingCurrency(null)}
          onConfirm={() => {
            const next = pendingCurrency;
            setPendingCurrency(null);
            saveCurrency(next);
          }} />,
        document.body,
      )}

      {/* Delete-organization confirmation modal. */}
      {showDelete && createPortal(
        <DeleteOrgModal
          orgName={org?.name || ''}
          projectCount={projectCount}
          busy={deleting}
          error={deleteErr}
          onCancel={() => { if (!deleting) setShowDelete(false); }}
          onConfirm={doDelete} />,
        document.body,
      )}

      {/* Switch-to-per-project confirmation. */}
      {disconnectOpen && createPortal(
        <DisconnectCustomersModal
          orgName={org?.name || ''}
          busy={sharingBusy}
          onCancel={() => { if (!sharingBusy) setDisconnectOpen(false); }}
          onConfirm={(text) => applySharing(false, text)} />,
        document.body,
      )}

      {/* Merge-conflict blocker (turning sharing ON). */}
      {conflicts && createPortal(
        <CustomerConflictModal conflicts={conflicts} onClose={() => setConflicts(null)} />,
        document.body,
      )}

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </>
  );
}
