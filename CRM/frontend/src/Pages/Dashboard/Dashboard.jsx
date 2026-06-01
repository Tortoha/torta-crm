import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass, Plus, FolderSimple } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { InteractiveSection } from '../../Utils/InteractiveSection.js';
import Header from '../../Elements/Header.jsx';
import Modal from '../../Elements/Modal.jsx';
import CreateOrgForm from '../../Elements/CreateOrgForm.jsx';
import '../../Style/Layout.css';
import '../../Style/Dashboard.css';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtDate = iso => iso
  ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '—';

// ─── Tilt config ─────────────────────────────────────────────────────────────

const TILT = {
  maxAngle: 18, lerp: 0.05, lerpOut: 0.07,
  scale: 1.05, perspective: 700,
  gloss: { opacity: 0.18, spread: 60 },
};

// ─── OrgCard ─────────────────────────────────────────────────────────────────

function OrgCard({ org }) {
  const { t } = useTranslation();
  const { ref, glossRef, handlers } = InteractiveSection(TILT);
  const plan = org.plan_slug || 'free';
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
  return (
    <Link ref={ref} className="db-card db-card--tilt" to={`/org/${org.slug}`} {...handlers}>
      <div ref={glossRef} className="db-card-gloss" />
      <div className="db-card-inner">
        <span className="db-card-badge">{planLabel}</span>
        <div className="db-card-row">
          <div className="db-card-icon">
            <FolderSimple className="db-card-icon-svg" />
          </div>
          <div className="db-card-text">
            <div className="db-card-name">{org.name}</div>
            <div className="db-card-meta">{t('dashboard.projectCount', { count: org.projects_count })} · {fmtDate(org.created_at)}</div>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard() {
  const { t } = useTranslation();
  const [user,    setUser]    = useState(null);
  const [orgs,    setOrgs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const [search,  setSearch]  = useState('');
  const navigate = useNavigate();

  const closeOrgModal = () => setModal(false);

  // A new org row appeared in the DB (free submit OR paid silent-create) —
  // prepend it so it shows immediately, even if the user abandons payment.
  const addOrg = org => setOrgs(prev => (prev.some(o => o.id === org.id) ? prev : [org, ...prev]));

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/me`,   { credentials: 'include' }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch(`${API_BASE}/api/orgs`, { credentials: 'include' }).then(r => r.json()),
    ])
    .then(([u, o]) => {
      // Hard ToS gate — users who signed up via Google start with
      // terms_accepted_at = NULL and are bounced to /accept-terms
      // until they click through the consent screen.
      if (!u?.terms_accepted_at) { navigate('/accept-terms', { replace: true }); return; }
      setUser(u); setOrgs(Array.isArray(o) ? o : []);
    })
    .catch(() => navigate('/login'))
    .finally(() => setLoading(false));
  }, [navigate]);

  if (loading) return (
    <div id="mask" className="mask">
      <svg><circle cx="50" cy="50" r="40" /></svg>
    </div>
  );

  const filtered = orgs.filter(o => o.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="crm-root">
      <Header user={user} />
      <main className="crm-main crm-main--flat">
        <div className="crm-content">
          <h1 className="crm-page-title db-page-title">{t('dashboard.title')}</h1>

          <div className="db-toolbar">
            <div className="db-search-wrap">
              <MagnifyingGlass className="db-search-icon" />
              <input className="db-search-input" placeholder={t('dashboard.searchPlaceholder')}
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="db-new-btn" onClick={() => setModal(true)} type="button">
              <Plus className="db-new-icon" /> {t('dashboard.newOrganization')}
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="db-empty">
              {orgs.length === 0
                ? t('dashboard.empty')
                : t('dashboard.noResults')}
            </div>
          ) : (
            <div className="db-grid">
              {filtered.map(org => <OrgCard key={org.id} org={org} />)}
            </div>
          )}
        </div>
      </main>

      {modal && (
        <Modal title={t('dashboard.modalTitle')} onClose={closeOrgModal} maxWidth={400}>
          <CreateOrgForm
            labels={{
              name:            t('dashboard.nameLabel'),
              namePlaceholder: t('dashboard.namePlaceholder'),
              plan:            t('dashboard.planLabel', { defaultValue: 'Plan' }),
              create:          t('dashboard.create'),
              creating:        t('dashboard.creating'),
              nameRequired:    t('dashboard.nameRequired'),
              error:           t('dashboard.error'),
            }}
            onOrgCreated={addOrg}
            onDone={(org, { paid }) => { closeOrgModal(); if (paid) navigate(`/org/${org.slug}`); }}
          />
        </Modal>
      )}
    </div>
  );
}

export default Dashboard