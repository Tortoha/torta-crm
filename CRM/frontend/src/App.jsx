import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import './Style/App.css';

// ── Layouts (загружаются сразу — нужны как обёртки) ──
import Layout         from './Layout.jsx';
import OrgLayout      from './OrgLayout.jsx';
import ProductLayout  from './ProductLayout.jsx';
import SettingsLayout from './SettingsLayout.jsx';

// ── Страницы — lazy (каждая в отдельном chunk) ──
const Home          = lazy(() => import('./Home.jsx'));
const Login         = lazy(() => import('./Login.jsx'));
const Register      = lazy(() => import('./Register.jsx'));
const Verification  = lazy(() => import('./Verification.jsx'));
const Forgot        = lazy(() => import('./Forgot.jsx'));
const Reset         = lazy(() => import('./Reset.jsx'));
// Dashboard
const Dashboard     = lazy(() => import('./Pages/Dashboard/Dashboard.jsx'));
// Organization
const Organization  = lazy(() => import('./Pages/Organization/Organization.jsx'));
const OrgAnalytics  = lazy(() => import('./Pages/Organization/OrgAnalytics.jsx'));
const OrgSettings   = lazy(() => import('./Pages/Organization/OrgSettings.jsx'));
// Project
const Project       = lazy(() => import('./Pages/Project/Project.jsx'));
const Revenue       = lazy(() => import('./Pages/Project/Revenue.jsx'));
const Products      = lazy(() => import('./Pages/Project/Products.jsx'));
const Authentication   = lazy(() => import('./Pages/Project/Authentication.jsx'));
const ProjectSettings  = lazy(() => import('./Pages/Project/ProjectSettings.jsx'));
const Orders           = lazy(() => import('./Pages/Project/Orders.jsx'));
const Chat             = lazy(() => import('./Pages/Project/Chat.jsx'));
// Product
const ProductPage   = lazy(() => import('./Pages/Product/ProductPage.jsx'));
// Settings
const AccountSettings  = lazy(() => import('./Pages/Settings/Settings.jsx'));
const SettingsStub     = lazy(() => import('./Pages/Settings/SettingsStub.jsx'));

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
            <Route index                           element={<Organization />} />
            <Route path="analytics"               element={<OrgAnalytics />} />
            <Route path="settings"                element={<OrgSettings />} />
          </Route>
          <Route path="/project/:apiKey"           element={<Layout />}>
            <Route index            element={<Project />} />
            <Route path="dashboard" element={<Navigate to=".." relative="path" replace />} />
            <Route path="products"   element={<Products />} />
            <Route path="revenue"    element={<Revenue />} />
            <Route path="authentication" element={<Authentication />} />
            <Route path="email"      element={<Navigate to="../authentication" relative="path" replace />} />
            <Route path="oauth"      element={<Navigate to="../authentication" relative="path" replace />} />
            <Route path="url-config" element={<Navigate to="../authentication" relative="path" replace />} />
            <Route path="orders"     element={<Orders />} />
            <Route path="chat"       element={<Chat />} />
            <Route path="settings"   element={<ProjectSettings />} />
          </Route>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route path="account"       element={<AccountSettings />} />
            <Route path="security"      element={<SettingsStub title="Security" />} />
            <Route path="preferences"   element={<SettingsStub title="Preferences" />} />
            <Route path="notifications" element={<SettingsStub title="Notifications" />} />
          </Route>
          <Route path="/product/:productHash" element={<ProductLayout />}>
            <Route index                      element={<ProductPage />} />
            <Route path="variations"          element={<ProductPage />} />
            <Route path="seo"                 element={<ProductPage />} />
            <Route path="custom-fields"       element={<ProductPage />} />
            <Route path="reviews"             element={<ProductPage />} />
            <Route path="api-preview"         element={<ProductPage />} />
          </Route>
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
