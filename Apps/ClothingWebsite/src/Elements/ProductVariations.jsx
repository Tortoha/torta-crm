function ProductVariations({ 
    variations, 
    activeIndex, 
    hoveredIndex, 
    onVariationClick, 
    onVariationHover, 
    isVariationInCart 
}) {
    if (variations.length <= 1) return null;
    const getOffset = (index) => {
        const width = window.innerWidth;
        let itemWidth, gap;
        
        if (width <= 480) {
            itemWidth = 60;
            gap = 8;
        } else if (width <= 768) {
            itemWidth = 70;
            gap = 8;
        } else {
            itemWidth = 80;
            gap = 12;
        }
        
        return index * (itemWidth + gap);
    };

    const currentIndex = hoveredIndex !== null ? hoveredIndex : activeIndex;

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
                        transform: `translateX(${getOffset(currentIndex)}px)`,
                    }}
                />
            </div>
        </div>
    );
}

export default ProductVariations