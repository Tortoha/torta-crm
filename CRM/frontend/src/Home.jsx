import { Link } from 'react-router-dom';

function Home() {
  return (
    <div className="home-wrap">
      <div className="home-hero">
        <h1 className="home-title">Torta CRM</h1>
        <p className="home-sub">Manage your store, analytics and team — all in one place.</p>
        <Link to="/login" className="home-btn">Sign in to CRM</Link>
      </div>
    </div>
  );
}

export default Home