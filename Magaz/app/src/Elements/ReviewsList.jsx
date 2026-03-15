import { useState } from "react";
import Star from "./Star";
import { API_BASE } from "../api.js"

function ReviewsList({ reviews, currentUserId, onReviewDeleted }) {
    const [hoveredReviewId, setHoveredReviewId] = useState(null);
    const [deletingReviewId, setDeletingReviewId] = useState(null);

    const formatTimeAgo = (dateString) => {
        if (!dateString) return "just now";

        const reviewDate = new Date(dateString);
        const now = new Date();
        const diffMs = now - reviewDate;
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);
        const diffMonth = Math.floor(diffDay / 30);
        const diffYear = Math.floor(diffDay / 365);

        if (diffSec < 60) return "just now";
        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffHour < 24) return `${diffHour}h ago`;
        if (diffDay < 30) return `${diffDay}d ago`;
        if (diffMonth < 12) return `${diffMonth}mo ago`;
        return `${diffYear}y ago`;
    };

    const handleDeleteReview = async (reviewId) => {
        setDeletingReviewId(reviewId);

        try {
            const response = await fetch(`${API_BASE}/api/reviews/${reviewId}`, {
                method: "DELETE",
                credentials: "include",
            });

            if (response.ok) {
                onReviewDeleted();
            } else {
                const errorData = await response.json();
                console.error("Failed to delete review:", errorData);
            }
        } catch (error) {
            console.error("Error deleting review:", error);
        } finally {
            setDeletingReviewId(null);
        }
    };

    const sortedReviews = reviews ? [...reviews].sort((a, b) => {
        return new Date(b.created_at) - new Date(a.created_at);
    }) : [];

    if (sortedReviews.length === 0) return null;

    return (
        <div className="reviews-list">
            {sortedReviews.map((r) => (
                <article
                    key={r.id}
                    className="review-card"
                    onMouseEnter={() => setHoveredReviewId(r.id)}
                    onMouseLeave={() => setHoveredReviewId(null)}
                >
                    <div className="review-header">
                        <div className="review-author">
                            <span className="review-user-time">
                                {r.user_name} · {formatTimeAgo(r.created_at)}
                            </span>
                        </div>
                        <div className="review-stars-only">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <Star
                                    key={star}
                                    fillType={star <= r.rating ? "full" : "empty"}
                                />
                            ))}
                        </div>
                    </div>
                    {r.comment && <p className="review-text">{r.comment}</p>}

                    {currentUserId === r.user_id && hoveredReviewId === r.id && (
                        <button
                            className="btn-delete-review"
                            onClick={() => handleDeleteReview(r.id)}
                            disabled={deletingReviewId === r.id}
                        >
                            ×
                        </button>
                    )}
                </article>
            ))}
        </div>
    );
}

export default ReviewsList