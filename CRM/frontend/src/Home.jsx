import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Header from './Elements/Header.jsx';
import { API_BASE } from './api.js';

function Home() {
  const { t } = useTranslation();
  // Best-effort: public page, no redirect. If the visitor is logged in the
  // header shows Docs / bell / avatar; otherwise just the brand logo.
  const [user, setUser] = useState(null);
  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => {});
  }, []);

  return (
    <>
      <Header user={user} landing />
      <div className="home-wrap">
        <div className="home-hero">
          <h1 className="home-title">Torta CRM</h1>
          <p className="home-sub">{t('auth.home.subtitle')}</p>
          <Link to="/login" className="home-btn">{t('auth.home.signIn')}</Link>
        </div>
      </div>
    </>
  );
}

export default Home