function ProductVariations({ 
    variations, 
    activeIndex, 
    hoveredIndex, 
    onVariationClick, 
    onVariationHover, 
    isVariationInCart 
}) {
    if (variations.length <= 1) return null;

    return (
        <div className="product-variations">
            <div className="variation-list">
                {variations.map((v, index) => (
                    <button
                        key={v.id}
                        className={`variation-item ${index === activeIndex ? "variation-item--active" : ""}`}
                        onClick={() => onVariationClick(index)}
                        onMouseEnter={() => onVariationHover(index)}
                        onMouseLeave={() => onVariationHover(null)}
                    >
                        <img src={v.image} alt={v.variation_name} />
                        {isVariationInCart(v.id) && (
                            <div className="cart-indicator-dot"></div>
                        )}
                    </button>
                ))}
                <div
                    className="variation-underline"
                    style={{
                        transform: `translateX(${(hoveredIndex !== null ? hoveredIndex : activeIndex) * 92}px)`,
                    }}
                />
            </div>
        </div>
    );
}

export default ProductVariations