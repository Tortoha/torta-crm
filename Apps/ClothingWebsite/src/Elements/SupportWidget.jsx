import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { client } from "../api.js";
import "../Style/SupportWidget.css";

/**
 * Support chat panel — controlled component.
 *
 * Props:
 *   isOpen  — boolean, shows the panel when true
 *   onClose — called when the user dismisses the panel
 *
 * Polling only runs while the panel is open — no background requests.
 */
export default function SupportWidget({ isOpen, onClose }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft]       = useState("");
  const [sending, setSending]   = useState(false);

  const sinceRef  = useRef(0);
  const scrollRef = useRef(null);

  // Poll every 5 s while panel is open; stops completely when closed.
  useEffect(() => {
    if (!isOpen) return;
    const tick = async () => {
      try {
        const res = await client.chat.list(sinceRef.current);
        const incoming = res.data?.messages || [];
        if (incoming.length) {
          sinceRef.current = incoming[incoming.length - 1].id;
          setMessages(prev => {
            // Deduplicate — may overlap with the post-send immediate poll.
            const ids = new Set(prev.map(m => m.id));
            const fresh = incoming.filter(m => !ids.has(m.id));
            return fresh.length ? [...prev, ...fresh] : prev;
          });
        }
      } catch { /* ignore transient errors */ }
    };
    tick();                                    // immediate load on open
    const id = setInterval(tick, 5000);        // then every 5 s
    return () => clearInterval(id);
  }, [isOpen]);

  // Auto-scroll to bottom on new messages or when panel opens.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isOpen]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const tempId = -Date.now();
    setMessages(prev => [...prev, { id: tempId, direction: "in", text, optimistic: true }]);
    setDraft("");
    try {
      await client.chat.send(text);
      // Immediate poll to replace the optimistic message with the real one.
      const res = await client.chat.list(sinceRef.current);
      const incoming = res.data?.messages || [];
      if (incoming.length) sinceRef.current = incoming[incoming.length - 1].id;
      setMessages(prev => {
        const cleaned = prev.filter(m => !m.optimistic);
        return [...cleaned, ...incoming];
      });
    } catch {
      // Roll back optimistic insert — let user retry.
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  const onKey = e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (!isOpen) return null;

  return createPortal(
    // Full-screen transparent overlay — click outside panel → close
    <div className="sw-overlay" onClick={onClose}>
      <div className="sw-panel" role="dialog" aria-label="Support chat"
        onClick={e => e.stopPropagation()}>

        <div className="sw-scroll" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="sw-empty">
              <div className="sw-empty-title">Hi there! 👋</div>
              <div className="sw-empty-desc">
                Got a question about a product, your order, or anything else?
                Send us a message and we'll get back to you here.
              </div>
            </div>
          )}
          {messages.map(m => (
            <div key={m.id} className={`sw-msg sw-msg--${m.direction}`}>
              <div className="sw-bubble">{m.text}</div>
            </div>
          ))}
        </div>

        <div className="sw-composer">
          <input
            className="sw-input"
            type="text"
            placeholder="Write a message…"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKey}
            disabled={sending}
            autoFocus
          />
          <button
            className="sw-send"
            onClick={send}
            disabled={!draft.trim() || sending}
            type="button"
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M3.4 20.4 21 12 3.4 3.6l.1 6.5L17 12 3.5 13.9z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
