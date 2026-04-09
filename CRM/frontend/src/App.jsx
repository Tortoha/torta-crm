import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import './Style/App.css';

// ── Layouts (загружаются сразу — нужны как обёртки) ──
import Layout    from './Layout.jsx';
import OrgLayout from './OrgLayout.jsx';

// ── Страницы — lazy (каждая в отдельном chunk) ──
const Home          = lazy(() => import('./Home.jsx'));
const Login         = lazy(() => import('./Login.jsx'));
const Register      = lazy(() => import('./Register.jsx'));
const Verification  = lazy(() => import('./Verification.jsx'));
const Forgot        = lazy(() => import('./Forgot.jsx'));
const Reset         = lazy(() => import('./Reset.jsx'));
const Dashboard     = lazy(() => import('./Pages/Dashboard.jsx'));
const Organizations = lazy(() => import('./Pages/Organizations.jsx'));
const OrgAnalytics  = lazy(() => import('./Pages/OrgAnalytics.jsx'));
const Projects      = lazy(() => import('./Pages/Projects.jsx'));
const Revenue       = lazy(() => import('./Pages/Revenue.jsx'));
const Api           = lazy(() => import('./Pages/Api.jsx'));
const Products      = lazy(() => import('./Pages/Products.jsx'));
const Settings      = lazy(() => import('./Pages/Settings.jsx'));
const Email         = lazy(() => import('./Pages/Email.jsx'));
const OAuth         = lazy(() => import('./Pages/OAuth.jsx'));
const UrlConfig     = lazy(() => import('./Pages/UrlConfig.jsx'));

// ── Fallback пока chunk грузится ──
function PageLoader() {
  return (
    <div id="mask" className="mask">
      <svg><circle cx="50" cy="50" r="40" /></svg>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/"                          element={<Home />} />
          <Route path="/login"                     element={<Login />} />
          <Route path="/login/verification"        element={<Verification />} />
          <Route path="/registration"              element={<Register />} />
          <Route path="/registration/verification" element={<Verification />} />
          <Route path="/forgot-password"           element={<Forgot />} />
          <Route path="/reset-password/:token"     element={<Reset />} />
          <Route path="/dashboard"                 element={<Dashboard />} />
          <Route path="/org/:orgSlug"              element={<OrgLayout />}>
            <Route index                           element={<Organizations />} />
            <Route path="analytics"               element={<OrgAnalytics />} />
          </Route>
          <Route path="/project/:apiKey"           element={<Layout />}>
            <Route index            element={<Projects />} />
            <Route path="dashboard" element={<Navigate to=".." relative="path" replace />} />
            <Route path="products"   element={<Products />} />
            <Route path="revenue"    element={<Revenue />} />
            <Route path="api"        element={<Api />} />
            <Route path="email"      element={<Email />} />
            <Route path="oauth"      element={<OAuth />} />
            <Route path="url-config" element={<UrlConfig />} />
            <Route path="settings"   element={<Settings />} />
          </Route>
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
