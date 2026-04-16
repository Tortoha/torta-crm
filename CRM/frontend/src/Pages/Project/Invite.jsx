import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { API_BASE } from '../../api.js';

function Invite() {
  const { token }    = useParams();
  const navigate     = useNavigate();
  const [info, setInfo]     = useState(null);
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/invites/validate/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.detail) setError(data.detail);
        else setInfo(data);
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleJoin = async () => {
    setJoining(true);
    const res = await fetch(`${API_BASE}/api/invites/accept/${token}`, {
      method: 'POST',
      credentials: 'include',
    });
    const data = await res.json();

    if (res.status === 401) {
      navigate(`/login?redirect=/invite/${token}`);
      return;
    }
    if (!res.ok) { setError(data.detail || 'Error'); setJoining(false); return; }

    window.dispatchEvent(new CustomEvent('api-keys-changed'));
    navigate('/dashboard');
  };

  if (loading) return <div className="invite-page"><p>Checking invite…</p></div>;
  if (error)   return <div className="invite-page invite-page--error"><p>{error}</p></div>;

  return (
    <div className="invite-page">
      <div className="invite-card">
        <h1>You're invited!</h1>
        <p>Join project <strong>{info.project_name}</strong></p>
        <p>Your role will be: <strong>{info.role_name}</strong></p>
        <button onClick={handleJoin} disabled={joining}>
          {joining ? 'Joining…' : 'Accept Invite'}
        </button>
      </div>
    </div>
  );
}

export default Invite