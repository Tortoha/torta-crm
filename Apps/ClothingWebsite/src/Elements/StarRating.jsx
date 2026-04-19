import Star from "./Star";

const StarRating = ({ rating, maxStars = 5 }) => {
    const roundedRating = Math.round(rating * 2) / 2;
    const fullStars = Math.floor(roundedRating);
    const hasHalfStar = roundedRating % 1 !== 0;
    const emptyStars = maxStars - fullStars - (hasHalfStar ? 1 : 0);
    
    return (
        <div className="star-rating">
            <span className="rating-number">{rating.toFixed(1)}</span>
            <div className="stars-container">
                {[...Array(fullStars)].map((_, index) => (
                    <Star key={`full-${index}`} fillType="full" />
                ))}
                {hasHalfStar && <Star key="half" fillType="half" />}
                {[...Array(emptyStars)].map((_, index) => (
                    <Star key={`empty-${index}`} fillType="empty" />
                ))}
            </div>
        </div>
    );
};

export default StarRating