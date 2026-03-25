import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDownIcon, KeyIcon } from '@heroicons/react/24/solid';
import { API_BASE } from '../api.js';
import '../Style/Header.css';

function ApiComboBox() {
  const [keys,    setKeys]    = useState([]);
  const [active,  setActive]  = useState(null);
  const [open,    setOpen]    = useState(false);
  const [hovered, setHovered] = useState(null);

  const listRef  = useRef(null);
  const itemRefs = useRef({});
  const wrapRef  = useRef(null);

  const [ind, setInd] = useState({ opacity: 0, y: 0, h: 0 });

  const loadKeys = () => {
    fetch(`${API_BASE}/api/api-keys`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return;
        setKeys(data);
        setActive(data.find(k => k.is_selected) || data[0] || null);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadKeys();
    window.addEventListener('api-keys-changed',  loadKeys);
    window.addEventListener('api-key-switched',  loadKeys);
    return () => {
      window.removeEventListener('api-keys-changed', loadKeys);
      window.removeEventListener('api-key-switched', loadKeys);
    };
  }, []);

  useEffect(() => {
    const h = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const activeId  = active?.id ?? null;
  const currentId = hovered ?? activeId;

  useLayoutEffect(() => {
    const container = listRef.current;
    const el = currentId != null ? itemRefs.current[currentId] : null;

    if (!container || !el || !open) {
      setInd(p => ({ ...p, opacity: 0 }));
      return;
    }

    const cr = container.getBoundingClientRect();
    const ir = el.getBoundingClientRect();

    setInd({ opacity: 1, y: ir.top - cr.top, h: ir.height });
  }, [currentId, open]);

  const switchKey = async (k) => {
    setActive(k);
    setOpen(false);
    try {
      await fetch(`${API_BASE}/api/api-keys/switch`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key_id: k.id }),
      });
      loadKeys();
      window.dispatchEvent(new CustomEvent('api-key-switched', { detail: k }));
    } catch { loadKeys(); }
  };

  if (!active) return null;

  const activeKey = keys.find(k => k.id === active.id);
  const userRole  = activeKey?.user_role || null;

  return (
    <div className="hdr-combo" ref={wrapRef}>
      <div className={`hdr-combo-block${open ? ' hdr-combo-block--open' : ''}`}>

        {/* Триггер */}
        <button
          className="hdr-combo-trigger"
          onClick={() => setOpen(v => !v)}
          type="button"
        >
          <KeyIcon className="hdr-combo-icon" />
          <span className="hdr-combo-label">{active.name}</span>
          {userRole && <span className="hdr-combo-role">{userRole}</span>}
          <ChevronDownIcon
            className={`hdr-combo-chevron${open ? ' hdr-combo-chevron--open' : ''}`}
          />
        </button>

        <div className={`hdr-combo-list-wrap${open ? ' hdr-combo-list-wrap--open' : ''}`}>
          <div className="hdr-combo-list" ref={listRef}>

            <div
              className="hdr-combo-indicator"
              style={{
                opacity:   ind.opacity,
                height:    `${ind.h}px`,
                transform: `translateY(${ind.y}px)`,
              }}
            />

            {keys.map(k => (
              <div
                key={k.id}
                ref={el => {
                  if (el) itemRefs.current[k.id] = el;
                  else delete itemRefs.current[k.id];
                }}
                className={`hdr-combo-item-wrap${currentId === k.id ? ' hdr-combo-item-wrap--current' : ''}`}
                onMouseEnter={() => setHovered(k.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <button
                  className="hdr-combo-item"
                  onClick={() => switchKey(k)}
                  type="button"
                >
                  <span className="hdr-combo-item-name">{k.name}</span>
                  <span className="hdr-combo-item-key">
                    {k.api_key.slice(0, 8)}…{k.api_key.slice(-4)}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="crm-header">
      <ApiComboBox />
    </header>
  );
}

export default Header