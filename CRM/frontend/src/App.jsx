import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import './Style/App.css';

import Home          from './Home.jsx';
import Login         from './Login.jsx';
import Register      from './Register.jsx';
import Verification  from './Verification.jsx';
import Forgot        from './Forgot.jsx';
import Reset         from './Reset.jsx';
import Layout        from './Layout.jsx';
import OrgLayout     from './OrgLayout.jsx';
import Dashboard     from './Pages/Dashboard.jsx';
import Organizations from './Pages/Organizations.jsx';
import OrgAnalytics  from './Pages/OrgAnalytics.jsx';
import Projects      from './Pages/Projects.jsx';
import Revenue       from './Pages/Revenue.jsx';
import Api           from './Pages/Api.jsx';
import Products      from './Pages/Products.jsx';
import Settings      from './Pages/Settings.jsx';
import Email         from './Pages/Email.jsx';
import OAuth         from './Pages/OAuth.jsx';
import UrlConfig     from './Pages/UrlConfig.jsx';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/"                          element={<Home />} />
        <Route path="/login"                     element={<Login/>} />
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
    </Router>
  );
}

export default App
