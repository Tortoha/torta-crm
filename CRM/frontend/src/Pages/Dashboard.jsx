import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, Link } from 'react-router-dom';
import { MagnifyingGlass, Plus, X, FolderSimple } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import Header from '../Elements/Header.jsx';
import '../Style/Layout.css';
import '../Style/Dashboard.css';

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Tilt settings ──────────────────────────────────────────────────────────

const TILT = {
  maxAngle:    18,
  lerp:        0.05,
  lerpOut:     0.07,
  scale:       1.05,
  perspective: 700,
  gloss:      { opacity: 0.18, spread: 60 },
};

// ─── TiltCard ───────────────────────────────────────────────────────────────

function TiltCard({ org, children }) {
  const ref      = useRef(null);
  const glossRef = useRef(null); // отдельный оверлей для блика
  const rafRef   = useRef(null);
  const cur      = useRef({ rx: 0, ry: 0, x: 0, y: 0, scale: 1 });
  const tgt      = useRef({ rx: 0, ry: 0, x: 0, y: 0, scale: 1, hovered: false });

  const loop = useCallback(() => {
    const c = cur.current, t = tgt.current;
    const lf = t.hovered ? TILT.lerp : TILT.lerpOut;
    c.rx    += (t.rx    - c.rx)    * lf;
    c.ry    += (t.ry    - c.ry)    * lf;
    c.x     += (t.x     - c.x)     * lf;
    c.y     += (t.y     - c.y)     * lf;
    c.scale += (t.scale - c.scale) * lf;

    const el = ref.current;
    if (!el) return;
    el.style.transform = `perspective(${TILT.perspective}px) rotateX(${c.rx}deg) rotateY(${c.ry}deg) scale(${c.scale})`;

    // Блик — на отдельный div, карточка не мутнеет
    if (glossRef.current) {
      glossRef.current.style.opacity  = t.hovered ? '1' : '0';
      glossRef.current.style.backgroundImage = `radial-gradient(circle at ${50 + c.x * TILT.gloss.spread}% ${50 + c.y * TILT.gloss.spread}%, rgba(255,255,255,${TILT.gloss.opacity}) 0%, transparent 70%)`;
    }

    if (!t.hovered && Math.abs(c.rx) + Math.abs(c.ry) + Math.abs(c.scale - 1) * 20 < 0.05) {
      el.style.transform = '';
      cur.current = { rx: 0, ry: 0, x: 0, y: 0, scale: 1 };
      rafRef.current = null;
      return;
    }
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const onMouseEnter = useCallback(() => {
    tgt.current.hovered = true;
    tgt.current.scale   = TILT.scale;
    if (!rafRef.current) rafRef.current = requestAnimationFrame(loop);
  }, [loop]);

  const onMouseMove = useCallback(e => {
    const el = ref.current;
    if (!el) return;
    const { left, top, width, height } = el.getBoundingClientRect();
    const x = (e.clientX - left) / width  - 0.5;
    const y = (e.clientY - top)  / height - 0.5;
    tgt.current.rx = -y * TILT.maxAngle;
    tgt.current.ry =  x * TILT.maxAngle;
    tgt.current.x  = x; tgt.current.y = y;
  }, []);

  const onMouseLeave = useCallback(() => {
    Object.assign(tgt.current, { hovered: false, rx: 0, ry: 0, x: 0, y: 0, scale: 1 });
  }, []);

  return (
    <Link ref={ref} className="db-card db-card--tilt" to={`/org/${org.slug}`}
      onMouseEnter={onMouseEnter} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>
      {/* Блик поверх контента, pointer-events: none чтобы не мешал */}
      <div ref={glossRef} className="db-card-gloss" />
      {children}
    </Link>
  );
}

// ─── CreateOrgModal ──────────────────────────────────────────────────────────

function CreateOrgModal({ onClose, onCreated }) {
  const [name,   setName]   = useState('');
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = async e => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setErr('Name is required');
    setSaving(true);
    setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/orgs`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) return setErr(data.detail || 'Error');
      onCreated(data);
      onClose();
    } catch {
      setErr('Network error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="hdr-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="hdr-modal">
        <div className="hdr-modal-head">
          <span className="hdr-modal-title">New organization</span>
          <button className="hdr-modal-close" onClick={onClose} type="button" aria-label="Close">
            <X className="hdr-modal-close-icon" />
          </button>
        </div>
        <form className="hdr-modal-body" onSubmit={handleSubmit}>
          <div className="hdr-modal-field">
            <h4 className="hdr-modal-label">Name</h4>
            <input
              className="hdr-modal-input"
              placeholder="Organization name"
              value={name}
              onChange={e => { setName(e.target.value); setErr(''); }}
              autoFocus
              maxLength={100}
            />
          </div>
          {err && <span className="hdr-modal-err">{err}</span>}
          <button className="hdr-modal-submit" type="submit" disabled={saving || !name.trim()}>
            {saving ? 'Creating…' : 'Create'}
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function Dashboard() {
  const [user,    setUser]    = useState(null);
  const [orgs,    setOrgs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const [search,  setSearch]  = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/me`,   { credentials: 'include' }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch(`${API_BASE}/api/orgs`, { credentials: 'include' }).then(r => r.json()),
    ])
    .then(([user, orgs]) => { setUser(user); setOrgs(Array.isArray(orgs) ? orgs : []); })
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

          <h1 className="crm-page-title db-page-title">
            Your Organizations
          </h1>

          <div className="db-toolbar">
            <div className="db-search-wrap">
              <MagnifyingGlass className="db-search-icon" />
              <input
                className="db-search-input"
                placeholder="Search organizations…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <button className="db-new-btn" onClick={() => setModal(true)} type="button">
              <Plus className="db-new-icon" />
              New organization
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="db-empty">
              {orgs.length === 0 ? 'No organizations yet. Create one to get started.' : 'No organizations match your search.'}
            </div>
          ) : (
            <div className="db-grid">
              {filtered.map(org => (
                <TiltCard key={org.id} org={org}>
                  <div className="db-card-inner">
                    <span className="db-card-badge">
                      {org.projects_count} project{org.projects_count !== 1 ? 's' : ''}
                    </span>
                    <div className="db-card-row">
                      <div className="db-card-icon">
                        <FolderSimple className="db-card-icon-svg" />
                      </div>
                      <div className="db-card-text">
                        <div className="db-card-name">{org.name}</div>
                        <div className="db-card-meta">{fmtDate(org.created_at)}</div>
                      </div>
                    </div>
                  </div>
                </TiltCard>
              ))}
            </div>
          )}

        </div>
      </main>

      {modal && (
        <CreateOrgModal
          onClose={() => setModal(false)}
          onCreated={org => setOrgs(prev => [org, ...prev])}
        />
      )}
    </div>
  );
}

export default Dashboard