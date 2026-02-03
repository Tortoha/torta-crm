function ProductSizes({ 
    sizes, 
    activeSize, 
    hoveredIndex, 
    activeSizeIndex, 
    onSizeClick, 
    onSizeHover, 
    isSizeInCart 
}) {
    if (!sizes || sizes.length === 0) return null;
    const getOffset = (index) => {
        const width = window.innerWidth;
        let itemWidth, gap;
        
        if (width <= 480) {
            itemWidth = 48;
            gap = 8;
        } else if (width <= 768) {
            itemWidth = 56;
            gap = 8;
        } else {
            itemWidth = 64;
            gap = 12;
        }
        
        return index * (itemWidth + gap);
    };

    const isSizeUnderIndicator = (index) => {
        return index === (hoveredIndex !== null ? hoveredIndex : activeSizeIndex);
    };

    const currentIndex = hoveredIndex !== null ? hoveredIndex : activeSizeIndex;

    return (
        <div className="product-sizes">
            <div className="sizes-wrapper">
                <div
                    className="size-indicator"
                    style={{
                        transform: `translateX(${getOffset(currentIndex)}px)`,
                    }}
                />
                {sizes.map((s, index) => (
                    <button
                        key={s.id}
                        className={`size-item ${isSizeUnderIndicator(index) ? "size-item--white" : ""}`}
                        onClick={() => onSizeClick(s.id, s.size_name)}
                        onMouseEnter={() => onSizeHover(index)}
                        onMouseLeave={() => onSizeHover(null)}
                    >
                        {s.size_name}
                        {isSizeInCart(s.id) && (
                            <div className="cart-indicator-dot"></div>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
}

export default ProductSizes