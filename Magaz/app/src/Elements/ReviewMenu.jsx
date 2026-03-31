import { useState, useRef, useEffect } from "react";
import Star from "./Star";
import { client } from "../api.js"

function ReviewMenu({ productId, isAuthenticated, canReview, onReviewSubmitted }) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuClosing, setMenuClosing] = useState(false);
    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState("");
    const [hoveredStar, setHoveredStar] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const menuRef = useRef();

    const handleCloseMenu = () => {
        setMenuClosing(true);
        setTimeout(() => {
            setMenuOpen(false);
            setMenuClosing(false);
            setRating(0);
            setComment("");
            setHoveredStar(0);
        }, 300);
    };

    useEffect(() => {
        function handleClick(e) {
            if (menuOpen && menuRef.current && !menuRef.current.contains(e.target)) {
                handleCloseMenu();
            }
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [menuOpen]);

    const handleSubmit = async () => {
        if (rating === 0) return;
        if (!isAuthenticated) {
            window.location.href = "/login";
            return;
        }

        setSubmitting(true);

        try {
            const { ok } = await client.reviews.add(productId, rating, comment.trim());
            if (ok) onReviewSubmitted();
        } catch (error) {
            console.error("Error submitting review");
        } finally {
            setSubmitting(false);
        }
    };

    if (!canReview) {
        return null;
    }

    return (
        <div className="review-menu-container" ref={menuRef}>
            <button
                className="btn-write-review"
                onClick={() => {
                    if (!isAuthenticated) {
                        window.location.href = "/login";
                        return;
                    }
                    menuOpen ? handleCloseMenu() : setMenuOpen(true);
                }}
            >
                Write a Review
            </button>

            {menuOpen && (
                <div className={`review-menu ${menuClosing ? 'review-menu-closing' : ''}`}>
                    <div className="review-menu-top">
                        <div className="review-stars-input">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                    key={star}
                                    className="star-input-btn"
                                    onClick={() => setRating(star)}
                                    onMouseEnter={() => setHoveredStar(star)}
                                    onMouseLeave={() => setHoveredStar(0)}
                                >
                                    <Star fillType={star <= (hoveredStar || rating) ? "full" : "empty"} />
                                </button>
                            ))}
                        </div>

                        <button
                            className={`btn-send-review ${rating > 0 ? 'active' : ''}`}
                            onClick={handleSubmit}
                            disabled={rating === 0 || submitting}
                        >
                            {submitting ? "Sending..." : "Send a Review"}
                        </button>
                    </div>

                    <textarea
                        className="review-textarea"
                        placeholder="Write your review of the product here..."
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        maxLength={500}
                    />
                </div>
            )}
        </div>
    );
}

export default ReviewMenu
