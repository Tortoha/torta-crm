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
import KzWedge        from './KzWedge.jsx';
import TeamReady      from './TeamReady.jsx';
import CustomerFirst  from './CustomerFirst.jsx';
import HowItWorks     from './HowItWorks.jsx';
import UseCases       from './UseCases.jsx';
import Security       from './Security.jsx';
import PricingTeaser  from './PricingTeaser.jsx';
import Faq            from './Faq.jsx';
import FinalCta       from './FinalCta.jsx';
import Footer         from './Footer.jsx';
import '../../Style/Landing.css';
import '../../Style/LandingMocks.css';

export default function Landing() {
  // Best-effort user lookup — same pattern as the old Home.jsx. When the
  // user is logged in the header swaps "Get started" for "Dashboard".
  const [user, setUser] = useState(null);

  // Homepage SEO — also resets <title> when navigating back from a sub-page.
  useSeo({
    title: 'Torta CRM — run your online store from one place',
    description: 'One platform for your online store: physical & digital products, orders, inventory, bookings, customer chat across every messenger, and email campaigns. Start free, no credit card.',
    path: '',
  });

  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => {});
  }, []);

  return (
    <div className="ln-theme">
      <Header user={user} landing />
      <main className="ln-page">
        <Hero />
        <FeatureMarquee />
        <ProductTour />
        <AllInOne />
        <KzWedge />
        <TeamReady />
        <CustomerFirst />
        <HowItWorks />
        <UseCases />
        <Security />
        <PricingTeaser />
        <Faq />
        <FinalCta />
        <Footer />
      </main>
    </div>
  );
}
