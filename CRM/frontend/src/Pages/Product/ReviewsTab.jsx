import { Star } from '@phosphor-icons/react';

export default function ReviewsTab({ product }) {
  const reviews = product.reviews || [];
  if (reviews.length === 0)
    return <div className="prod-tab-content"><div className="prod-empty-state">No reviews yet.</div></div>;

  return (
    <div className="prod-tab-content">
      <div className="prod-reviews-list">
        {reviews.map(r => (
          <div key={r.id} className="prod-review-card">
            <div className="prod-review-header">
              <span className="prod-review-author">{r.user_name}</span>
              <div className="prod-review-stars">
                {[1,2,3,4,5].map(n => (
                  <Star key={n} className={`prod-star${n <= r.rating ? ' prod-star--on' : ''}`} />
                ))}
              </div>
              <span className="prod-review-date">
                {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
            {r.comment && <p className="prod-review-comment">{r.comment}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
