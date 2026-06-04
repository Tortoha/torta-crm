// Landing root — composes all sections in their fixed visual order. Hero is
// loaded eagerly (first paint), the rest are imported normally too since the
// page is a single bundle and most users scroll all the way down anyway.

import { useEffect, useState } from 'react';
import Header from '../../Elements/Header.jsx';
import { API_BASE } from '../../api.js';
import { useSeo } from '../../Utils/useSeo.js';
import Hero           from './Hero.jsx';
import FeatureMarquee from './FeatureMarquee.jsx';
import ProductTour    from './ProductTour.jsx';
import AllInOne       from './AllInOne.jsx';
import TeamReady      from './TeamReady.jsx';
import CustomerFirst  from './CustomerFirst.jsx';
import HowItWorks     from './HowItWorks.jsx';
import UseCases       from './UseCases.jsx';
import Security       from './Security.jsx';
import FinalCta       from './FinalCta.jsx';
import Footer         from './Footer.jsx';
import '../../Style/Landing.css';

export default function Landing() {
  // Best-effort user lookup — same pattern as the old Home.jsx. When the
  // user is logged in the header swaps "Get started" for "Dashboard".
  const [user, setUser] = useState(null);

  // Homepage SEO — also resets <title> when navigating back from a sub-page.
  useSeo({
    title: 'Torta CRM — run your online store from one place',
    description: 'Torta CRM is one platform to run your online store — orders, bookings, live customer chat, email campaigns and analytics, without juggling a dozen tools. Start free, no credit card.',
    canonical: 'https://tortacrm.com/',
  });

  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => {});
  }, []);

  return (
    <>
      <Header user={user} landing />
      <main className="ln-page">
        <Hero />
        <FeatureMarquee />
        <ProductTour />
        <AllInOne />
        <TeamReady />
        <CustomerFirst />
        <HowItWorks />
        <UseCases />
        <Security />
        <FinalCta />
        <Footer />
      </main>
    </>
  );
}
