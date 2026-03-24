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
        <Route path="/dashboard"                 element={<Layout />}>
          <Route index element={<Dashboard />} />
        </Route>
        <Route path="/revenue"                   element={<Layout />}>
          <Route index element={<Revenue />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App