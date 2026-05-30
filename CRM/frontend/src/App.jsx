import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import './Style/App.css';

// ── Layouts (загружаются сразу — нужны как обёртки) ──
import Layout         from './Layout.jsx';
import OrgLayout      from './OrgLayout.jsx';
import ProductLayout  from './ProductLayout.jsx';
import SettingsLayout from './SettingsLayout.jsx';
import DocsLayout     from './DocsLayout.jsx';

// ── Global plan-limit handling ──
// Installs a fetch interceptor at module load (once) that turns every 402
// "plan_limit_exceeded" response into a window CustomEvent the PlanLimitModal
// listens for. Modal mounts inside <Router> so it can use useNavigate().
import PlanLimitModal from './Elements/PlanLimitModal.jsx';
import { installPlanLimitInterceptor } from './Utils/planLimit.js';
installPlanLimitInterceptor();

// ── Страницы — lazy (каждая в отдельном chunk) ──
const Home          = lazy(() => import('./Home.jsx'));
const Login         = lazy(() => import('./Login.jsx'));
const Register      = lazy(() => import('./Register.jsx'));
const Verification  = lazy(() => import('./Verification.jsx'));
const Forgot        = lazy(() => import('./Forgot.jsx'));
const Reset         = lazy(() => import('./Reset.jsx'));
const Invite        = lazy(() => import('./Invite.jsx'));
const Preferences   = lazy(() => import('./Preferences.jsx'));
const AcceptTerms   = lazy(() => import('./AcceptTerms.jsx'));
// Dashboard
const Dashboard     = lazy(() => import('./Pages/Dashboard/Dashboard.jsx'));
// Organization
const Organization  = lazy(() => import('./Pages/Organization/Organization.jsx'));
const OrgAnalytics  = lazy(() => import('./Pages/Organization/OrgAnalytics.jsx'));
const OrgCustomers  = lazy(() => import('./Pages/Organization/OrgCustomers.jsx'));
const OrgPayments   = lazy(() => import('./Pages/Organization/OrgPayments.jsx'));
const OrgTeam       = lazy(() => import('./Pages/Organization/OrgTeam.jsx'));
const OrgSettings   = lazy(() => import('./Pages/Organization/OrgSettings.jsx'));
const OrgBilling    = lazy(() => import('./Pages/Organization/OrgBilling.jsx'));
const OrgUsage      = lazy(() => import('./Pages/Organization/OrgUsage.jsx'));
const OrgCheckout   = lazy(() => import('./Pages/Organization/OrgCheckout.jsx'));
// Project
const Project       = lazy(() => import('./Pages/Project/Project.jsx'));
const Analytics     = lazy(() => import('./Pages/Project/Analytics.jsx'));
const Alerts        = lazy(() => import('./Pages/Project/Alerts.jsx'));
const Targets       = lazy(() => import('./Pages/Project/Targets.jsx'));
const Products      = lazy(() => import('./Pages/Project/Products/Products.jsx'));
const ProductsList  = lazy(() => import('./Pages/Project/Products/ProductsList.jsx'));
const Categories    = lazy(() => import('./Pages/Project/Products/Categories.jsx'));
const Authentication   = lazy(() => import('./Pages/Project/Authentication.jsx'));
const ProjectSettings  = lazy(() => import('./Pages/Project/ProjectSettings.jsx'));
const Documents        = lazy(() => import('./Pages/Project/Documents.jsx'));
const Orders           = lazy(() => import('./Pages/Project/Orders.jsx'));
const Customers        = lazy(() => import('./Pages/Project/Customers.jsx'));
const Emails           = lazy(() => import('./Pages/Project/Emails.jsx'));
const Chat             = lazy(() => import('./Pages/Project/Chat.jsx'));
const Booking          = lazy(() => import('./Pages/Project/Booking/Booking.jsx'));
const Integrations     = lazy(() => import('./Pages/Project/Integrations/Integrations.jsx'));
// Product detail pages — live under their own ProductLayout at /product/:hash
const ProductOverview   = lazy(() => import('./Pages/Product/ProductOverview.jsx'));
const ProductReviews    = lazy(() => import('./Pages/Product/ProductReviews.jsx'));
const ProductApiPreview = lazy(() => import('./Pages/Product/ProductApiPreview.jsx'));
const ProductSettings   = lazy(() => import('./Pages/Product/ProductSettings.jsx'));
const ProductEditHistory = lazy(() => import('./Pages/Product/ProductEditHistory.jsx'));
// Project-level Products tabs (pricing, warehouses, inventory, settings)
const PromoCodes        = lazy(() => import('./Pages/Project/Products/PromoCodes.jsx'));
const Discounts         = lazy(() => import('./Pages/Project/Products/Discounts.jsx'));
const TierPricing       = lazy(() => import('./Pages/Project/Products/TierPricing.jsx'));
const Warehouses        = lazy(() => import('./Pages/Project/Products/Warehouses.jsx'));
const ProductsInventory = lazy(() => import('./Pages/Project/Products/ProductsInventory.jsx'));
const Batches           = lazy(() => import('./Pages/Project/Products/Batches.jsx'));
const ProductsSettings  = lazy(() => import('./Pages/Project/Products/ProductsSettings.jsx'));
// Settings
const AccountSettings  = lazy(() => import('./Pages/Settings/Settings.jsx'));
const SecuritySettings = lazy(() => import('./Pages/Settings/Security.jsx'));
// Docs
const DocsPage         = lazy(() => import('./Pages/Docs/DocsPage.jsx'));
// Landing satellites — public marketing/legal pages reachable via Header
// (Pricing tab) and Footer (Terms/Privacy/Refund). Lazy-loaded since most
// visitors land on `/` first.
const Pricing          = lazy(() => import('./Pages/Landing/Pricing.jsx'));
const Terms            = lazy(() => import('./Pages/Landing/Terms.jsx'));
const Privacy          = lazy(() => import('./Pages/Landing/Privacy.jsx'));
const Refund           = lazy(() => import('./Pages/Landing/Refund.jsx'));
const SecurityPage     = lazy(() => import('./Pages/Landing/SecurityPage.jsx'));

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
      {/* Global plan-limit modal — fires when a 402 plan_limit_exceeded
          response reaches the fetch interceptor. Mounted outside Routes
          so it works on every page. */}
      <PlanLimitModal />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/"                          element={<Home />} />
          <Route path="/pricing"                   element={<Pricing />} />
          <Route path="/terms"                     element={<Terms />} />
          <Route path="/privacy"                   element={<Privacy />} />
          <Route path="/refund"                    element={<Refund />} />
          <Route path="/security"                  element={<SecurityPage />} />
          <Route path="/login"                     element={<Login />} />
          <Route path="/login/verification"        element={<Verification />} />
          <Route path="/registration"              element={<Register />} />
          <Route path="/registration/verification" element={<Verification />} />
          <Route path="/forgot-password"           element={<Forgot />} />
          <Route path="/reset-password/:token"     element={<Reset />} />
          <Route path="/invite/:token"             element={<Invite />} />
          <Route path="/preferences"               element={<Preferences />} />
          <Route path="/accept-terms"              element={<AcceptTerms />} />
          <Route path="/dashboard"                 element={<Dashboard />} />
          <Route path="/org/:orgSlug"              element={<OrgLayout />}>
            <Route index                           element={<Organization />} />
            <Route path="analytics"               element={<OrgAnalytics />} />
            <Route path="customers"               element={<OrgCustomers />} />
            <Route path="payments"                element={<OrgPayments />} />
            <Route path="billing"                 element={<OrgBilling />} />
            <Route path="usage"                   element={<OrgUsage />} />
            <Route path="checkout"                element={<OrgCheckout />} />
            <Route path="team"                    element={<OrgTeam />} />
            <Route path="settings"                element={<OrgSettings />} />
          </Route>
          <Route path="/project/:apiKey"           element={<Layout />}>
            <Route index            element={<Project />} />
            <Route path="dashboard" element={<Navigate to=".." relative="path" replace />} />
            <Route path="products"   element={<Products />}>
              <Route index                element={<ProductsList />} />
              <Route path="categories"    element={<Categories />} />
              <Route path="inventory"     element={<ProductsInventory />} />
              <Route path="batches"       element={<Batches />} />
              <Route path="archive"       element={<ProductsList archived />} />
              <Route path="promo-codes"   element={<PromoCodes />} />
              <Route path="discounts"     element={<Discounts />} />
              <Route path="tier-pricing"  element={<TierPricing />} />
              <Route path="warehouses"    element={<Warehouses />} />
              <Route path="settings"      element={<ProductsSettings />} />
            </Route>
            {/* Legacy /revenue route — было дублирующее имя для Analytics
                page. Кикаем deep-links / bookmarks на единый /analytics. */}
            <Route path="revenue"    element={<Navigate to="../analytics" relative="path" replace />} />
            <Route path="analytics"  element={<Analytics />} />
            <Route path="alerts"     element={<Alerts />} />
            <Route path="targets"    element={<Targets />} />
            {/* Legacy /goals route — kept for bookmarks. Redirects to /targets. */}
            <Route path="goals"      element={<Navigate to="../targets" relative="path" replace />} />
            <Route path="authentication" element={<Authentication />} />
            <Route path="email"      element={<Navigate to="../authentication" relative="path" replace />} />
            <Route path="oauth"      element={<Navigate to="../authentication" relative="path" replace />} />
            <Route path="url-config" element={<Navigate to="../authentication" relative="path" replace />} />
            <Route path="orders"     element={<Orders />} />
            <Route path="booking"      element={<Booking />} />
            <Route path="customers"  element={<Customers />} />
            <Route path="emails"     element={<Emails />} />
            {/* Legacy /bookings (plural) — stale notification links used it
                before the External fix. Redirect so they don't dead-end. */}
            <Route path="bookings"     element={<Navigate to="../booking" relative="path" replace />} />
            <Route path="integrations" element={<Integrations />} />
            <Route path="chat"         element={<Chat />} />
            <Route path="settings"     element={<ProjectSettings />} />
            <Route path="documents"    element={<Documents />} />
          </Route>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route path="account"       element={<AccountSettings />} />
            <Route path="security"      element={<SecuritySettings />} />
            <Route path="preferences"   element={<Navigate to="/settings/account" replace />} />
            <Route path="notifications" element={<Navigate to="/settings/account" replace />} />
          </Route>
          <Route path="/docs" element={<DocsLayout />}>
            <Route index            element={<Navigate to="/docs/getting-started" replace />} />
            <Route path=":section"  element={<DocsPage />} />
          </Route>
          <Route path="/product/:productHash" element={<ProductLayout />}>
            <Route index                element={<ProductOverview />} />
            <Route path="settings"      element={<ProductSettings />} />
            <Route path="edit-history"  element={<ProductEditHistory />} />
            <Route path="inventory"     element={<Navigate to="../edit-history" relative="path" replace />} />
            <Route path="qa"            element={<Navigate to=".." relative="path" replace />} />
            <Route path="reviews"       element={<ProductReviews />} />
            <Route path="api-preview"   element={<ProductApiPreview />} />
          </Route>
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App