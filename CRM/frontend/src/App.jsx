import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import './Style/App.css';

import Home          from './Home.jsx';
import Login         from './Login.jsx';
import Register      from './Register.jsx';
import Verification  from './Verification.jsx';
import Forgot        from './Forgot.jsx';
import Reset         from './Reset.jsx';
import Layout        from './Layout.jsx';
import Dashboard     from './Pages/Dashboard.jsx';
import Revenue       from './Pages/Revenue.jsx';
import Api           from './Pages/Api.jsx';
import Team          from './Pages/Team.jsx';
import Products      from './Pages/Products.jsx';
import Settings      from './Pages/Settings.jsx';
import Invite        from './Pages/Invite.jsx';
import Email         from './Pages/Email.jsx';
import OAuth         from './Pages/OAuth.jsx';

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
        <Route path="/invite/:token"             element={<Invite />} />
        <Route path="/dashboard"                 element={<Layout />}>
          <Route index element={<Dashboard />} />
        </Route>
        <Route path="/revenue"                   element={<Layout />}>
          <Route index element={<Revenue />} />
        </Route>
        <Route path="/api"                       element={<Layout />}>
          <Route index element={<Api />} />
        </Route>
        <Route path="/team"                      element={<Layout />}>
          <Route index element={<Team />} />
        </Route>
        <Route path="/products"                  element={<Layout />}>
          <Route index element={<Products />} />
        </Route>
        <Route path="/settings"                  element={<Layout />}>
          <Route index element={<Settings />} />
        </Route>
        <Route path="/email"                     element={<Layout />}>
          <Route index element={<Email />} />
        </Route>
        <Route path="/oauth"                     element={<Layout />}>
          <Route index element={<OAuth />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App