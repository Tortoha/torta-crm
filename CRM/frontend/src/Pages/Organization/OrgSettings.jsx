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
import { Buildings, Warning } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { CURRENCIES, formatMoney, getCurrencyMeta } from '../../Utils/currency.js';
import { Section, FieldCard, SearchableCombobox } from '../Project/ProjectSettings.jsx';
import '../../Style/Authentication.css';
import '../../Style/Products.css';

// ── Currency change warning modal (org variant) ───────────────────────
// Unlike the project modal (numbers stay, only symbol changes), the org
// currency IS a real FX rollup — so the copy here explains the rollup
// behaviour instead of promising "numbers don't change".
function OrgCurrencyWarningModal({ fromCode, toCode, onCancel, onConfirm }) {
  const fromMeta = getCurrencyMeta(fromCode);
  const toMeta   = getCurrencyMeta(toCode);
  return (
    <div className="auth-modal-overlay" onClick={onCancel}>
      <div className="auth-modal" onClick={e => e.stopPropagation()} style={{ width: 520 }}>
        <div className="auth-modal-body">
          <div className="auth-modal-title-row">
            <h2 className="auth-modal-title">Change organization currency?</h2>
          </div>

          <p className="cpm-section-hint" style={{ marginTop: 0 }}>
            The Analytics page will roll every project up into{' '}
            <b>{toMeta.name} ({toMeta.symbol})</b> instead of{' '}
            <b>{fromMeta.name} ({fromMeta.symbol})</b>.
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
              <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 4 }}>Was</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{fromMeta.code} {fromMeta.symbol}</div>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 18 }}>→</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 4 }}>Will be</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--accent)' }}>{toMeta.code} {toMeta.symbol}</div>
            </div>
          </div>

          <ul style={{
            margin: 0, padding: '0 0 0 18px',
            color: 'var(--muted)', fontSize: 13, lineHeight: 1.55,
          }}>
            <li><b>Display-only rollup.</b> Each project keeps its own currency — nothing is re-priced.</li>
            <li><b>Analytics FX-converts</b> every project's revenue into this currency before summing, so cross-project totals stay comparable.</li>
            <li><b>Per-project pages are unaffected</b> — orders, products and invoices still use each project's own currency.</li>
          </ul>

          <div className="auth-actions" style={{ marginTop: 16 }}>
            <button type="button" className="crm-submit-btn" onClick={onConfirm}>
              Change to {toMeta.code}
            </button>
            <button type="button" className="auth-btn-danger"
              onClick={onCancel} style={{ marginLeft: 'auto' }}>
              Cancel
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
  const [confirmText, setConfirmText] = useState('');
  const blocked = (projectCount || 0) > 0;
  const armed = !blocked && confirmText.trim() === orgName.trim() && !busy;
  return (
    <div className="auth-modal-overlay" onClick={onCancel}>
      <div className="auth-modal" onClick={e => e.stopPropagation()} style={{ width: 480 }}>
        <div className="auth-modal-body">
          <div className="auth-modal-title-row">
            <h2 className="auth-modal-title">Delete organization?</h2>
          </div>

          {blocked ? (
            <p className="cpm-section-hint" style={{ marginTop: 0 }}>
              This organization still has <b>{projectCount} project{projectCount === 1 ? '' : 's'}</b>.
              Delete every project first — an organization with projects can't be removed.
            </p>
          ) : (
            <>
              <p className="cpm-section-hint" style={{ marginTop: 0 }}>
                This permanently deletes <b>{orgName}</b>. This can't be undone.
                Type the organization name to confirm.
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
                {busy ? 'Deleting…' : 'Delete organization'}
              </button>
            )}
            <button type="button" className="crm-submit-btn auth-btn-secondary"
              onClick={onCancel} style={{ marginLeft: blocked ? 0 : 'auto' }}>
              {blocked ? 'Close' : 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────
export default function OrgSettings() {
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
    const t = setTimeout(async () => {
      const r = await fetch(`${API_BASE}/api/orgs/${org.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: v }),
      });
      showToast(r.ok ? 'Saved' : 'Save failed');
    }, 500);
    return () => clearTimeout(t);
  }, [name, org?.id, showToast]);

  const saveCurrency = async (next) => {
    const r = await fetch(`${API_BASE}/api/orgs/${org.id}/currency`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: next }),
    });
    if (r.ok) { setCurrency(next); showToast('Saved'); }
    else showToast('Save failed');
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
      setDeleteErr(j.detail || 'Could not delete organization');
    } catch {
      setDeleteErr('Network error — try again');
    } finally {
      setDeleting(false);
    }
  };

  const hasProjects = (projectCount || 0) > 0;

  return (
    <>
      <h1 className="crm-page-title">Settings</h1>

      <div className="bulk-settings">

        {/* ── General ── */}
        <Section icon={<Buildings weight="duotone" />} title="General"
          subtitle="Organization name and the display currency used across org-level analytics.">

          <FieldCard label="Organization name"
            hint="Shown in the breadcrumb switcher and on the dashboard.">
            <input className="crm-input" value={name} maxLength={100}
              style={{ maxWidth: 360 }}
              onChange={(e) => setName(e.target.value)} />
          </FieldCard>

          <FieldCard label="Display currency"
            hint={<>
              The Analytics page rolls every project up into this currency.
              <b> Each project keeps its own currency</b> — analytics FX-converts
              their revenue into this one before summing, so cross-project totals
              stay comparable. Per-project pages are unaffected.
            </>}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
              <SearchableCombobox
                value={currency}
                onChange={(next) => {
                  if (next === currency) return;
                  setPendingCurrency(next);
                }}
                searchPlaceholder="Search 49 currencies (USD, ₸, tenge…)"
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

        {/* ── Danger zone ── */}
        <Section icon={<Warning weight="duotone" />} title="Danger zone"
          subtitle="Irreversible actions.">
          <FieldCard label="Delete organization"
            hint={
              hasProjects
                ? <>This organization has <b>{projectCount} project{projectCount === 1 ? '' : 's'}</b>. Delete every project before you can remove the organization.</>
                : <>Permanently removes this organization. This can't be undone.</>
            }>
            <button type="button" className="auth-btn-danger"
              disabled={hasProjects}
              onClick={() => { setDeleteErr(''); setShowDelete(true); }}>
              Delete organization…
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

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </>
  );
}
