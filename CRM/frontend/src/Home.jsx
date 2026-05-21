import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

function Home() {
  const { t } = useTranslation();
  return (
    <div className="home-wrap">
      <div className="home-hero">
        <h1 className="home-title">Torta CRM</h1>
        <p className="home-sub">{t('auth.home.subtitle')}</p>
        <Link to="/login" className="home-btn">{t('auth.home.signIn')}</Link>
      </div>
    </div>
  );
}

export default Home