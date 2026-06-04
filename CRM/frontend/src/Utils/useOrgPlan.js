// Lightweight hook to read an organization's current plan on any page, so
// gated features can show a proactive "upgrade" plaque instead of a dead UI.
// Source of truth: GET /api/orgs/{orgId}/subscription → { plan_slug, ... }.
//
// Usage:
//   const { isFree, planSlug, loading } = useOrgPlan(orgId);

import { useEffect, useState } from 'react';
import { API_BASE } from '../api.js';

export function useOrgPlan(orgId) {
  const [planSlug, setPlanSlug] = useState(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!orgId) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    fetch(`${API_BASE}/api/orgs/${orgId}/subscription`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(sub => { if (alive) { setPlanSlug(sub?.plan_slug || 'free'); setLoading(false); } })
      .catch(() => { if (alive) { setPlanSlug('free'); setLoading(false); } });
    return () => { alive = false; };
  }, [orgId]);

  return { planSlug, loading, isFree: (planSlug || 'free') === 'free' };
}
