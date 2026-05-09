// Product Q&A management page — answer customer questions submitted via storefront.
// Read-only list of all questions for this product, with an inline answer textarea.

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext, useParams } from 'react-router-dom';
import { API_BASE } from '../../api.js';
import { decodeHash } from '../../Utils/hashids.js';
import '../../Style/Authentication.css';
import '../../Style/Products.css';

export default function ProductQA() {
  const { projectId, setProductContext } = useOutletContext();
  const { productHash } = useParams();
  const productId = decodeHash(productHash);
  const pq = `?project_id=${projectId}`;

  const [product, setProduct] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [toast, setToast] = useState('');

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2400);
  }, []);

  const load = useCallback(async () => {
    const [p, q] = await Promise.all([
      fetch(`${API_BASE}/api/products/${productId}${pq}`,                { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      fetch(`${API_BASE}/api/products/${productId}/questions${pq}`,       { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    ]);
    setProduct(p);
    setQuestions(Array.isArray(q) ? q : []);
    if (p) setProductContext?.({ name: p.title, hash: productHash });
  }, [productId, pq, productHash, setProductContext]);

  useEffect(() => { load(); return () => setProductContext?.(null); }, [load]); // eslint-disable-line

  if (!product) return <p className="crm-placeholder">Loading…</p>;

  return (
    <div className="prod-page po-page">
      <h1 className="crm-page-title">Q&A · {product.title}</h1>

      <section className="po-block">
        <h2 className="po-block-title">Customer questions</h2>
        <p className="po-block-hint">
          Visible to all storefront visitors after you publish an answer.
          Once answered, the Q&A appears on the product page below the reviews.
        </p>
        {questions.length === 0 ? (
          <p className="crm-placeholder">No questions yet.</p>
        ) : (
          <div className="po-qa-list">
            {questions.map(q => (
              <QARow key={q.id} q={q} productId={productId} pq={pq}
                onSaved={() => { load(); showToast('Answer saved'); }} />
            ))}
          </div>
        )}
      </section>

      {toast && createPortal(
        <div className="auth-toast">{toast}</div>,
        document.body,
      )}
    </div>
  );
}

function QARow({ q, productId, pq, onSaved }) {
  const [answer, setAnswer] = useState(q.answer || '');
  const submit = async () => {
    const r = await fetch(`${API_BASE}/api/products/${productId}/questions/${q.id}/answer${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer }),
    });
    if (r.ok) onSaved?.();
  };
  return (
    <div className="po-qa-row">
      <div className="po-qa-q">
        <span className="po-qa-meta">Q · {q.created_at?.slice(0, 10)} · user #{q.user_id}</span>
        <p className="po-qa-text">{q.question}</p>
      </div>
      <div className="po-qa-a">
        <span className="po-qa-meta">{q.answered_at ? `Answered ${q.answered_at.slice(0, 10)}` : 'Not answered yet'}</span>
        <textarea className="crm-input po-qa-textarea" rows={3}
          placeholder="Type your answer here…"
          value={answer} onChange={e => setAnswer(e.target.value)} maxLength={5000} />
        <div className="po-qa-actions">
          <button type="button" className="crm-add-btn" onClick={submit}>
            {q.answered_at ? 'Update answer' : 'Publish answer'}
          </button>
        </div>
      </div>
    </div>
  );
}
