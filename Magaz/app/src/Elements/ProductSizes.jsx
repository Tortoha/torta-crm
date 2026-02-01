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

    const isSizeUnderIndicator = (index) => {
        return index === (hoveredIndex !== null ? hoveredIndex : activeSizeIndex);
    };

    return (
        <div className="product-sizes">
            <div className="sizes-wrapper">
                <div
                    className="size-indicator"
                    style={{
                        transform: `translateX(${(hoveredIndex !== null ? hoveredIndex : activeSizeIndex) * 76}px)`,
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