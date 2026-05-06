import heartIcon from "../../icons/Like.png";

function ProductActions({
    isInCart,
    isFavorite,
    cartQuantity,
    addingToCart,
    maxStock,
    addDisabled = false,
    onToggleCart,
    onUpdateQuantity,
    onToggleFavorite
}) {
    return (
        <div className="product-actions">
            <div className={`cart-button-container ${isInCart ? "cart-button-container--expanded" : ""}`}>
                <button
                    className={`btn-primary ${isInCart ? "btn-primary--active" : ""}`}
                    onClick={onToggleCart}
                    disabled={addingToCart || addDisabled}
                >
                    {addingToCart ? "Loading..." : isInCart ? "Remove From Cart" : "Add To Cart"}
                </button>

                {isInCart && (
                    <div className="quantity-counter">
                        <button
                            className="quantity-btn"
                            onClick={() => onUpdateQuantity(cartQuantity - 1)}
                        >
                            -
                        </button>
                        <span className="quantity-value">{cartQuantity}</span>
                        <button
                            className="quantity-btn"
                            onClick={() => {
                                if (cartQuantity < maxStock) {
                                    onUpdateQuantity(cartQuantity + 1);
                                }
                            }}
                        >
                            +
                        </button>
                    </div>
                )}
            </div>

            <button
                className={`btn-icon ${isFavorite ? "btn-icon--active" : ""}`}
                onClick={onToggleFavorite}
            >
                <img src={heartIcon} alt="Favorite" className="heart-icon" />
            </button>
        </div>
    );
}

export default ProductActions