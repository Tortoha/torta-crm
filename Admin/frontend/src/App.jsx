import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './Login.jsx';
import Verification from './Verification.jsx';
import Layout from './Layout.jsx';
import Analytics from './Pages/Analytics.jsx';
import Users from './Pages/Users.jsx';
import Logs from './Pages/Logs.jsx';
import Feedback from './Pages/Feedback.jsx';
import Inbox from './Pages/Inbox.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/login/verification" element={<Verification />} />

        <Route path="/" element={<Layout />}>
          <Route index element={<Analytics />} />
          <Route path="users" element={<Users />} />
          <Route path="logs" element={<Logs />} />
          <Route path="feedback" element={<Feedback />} />
          <Route path="inbox" element={<Inbox />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
