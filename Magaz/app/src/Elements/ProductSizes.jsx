import { useRef, useEffect, useState } from 'react';

function ProductSizes({ 
    sizes, 
    activeSize, 
    hoveredIndex, 
    activeSizeIndex, 
    onSizeClick, 
    onSizeHover, 
    isSizeInCart 
}) {
    const sizeRefs = useRef([]);
    const [indicatorStyle, setIndicatorStyle] = useState({ transform: 'translateX(0px)', width: '64px' });

    useEffect(() => {
        const currentIndex = hoveredIndex !== null ? hoveredIndex : activeSizeIndex;
        const currentButton = sizeRefs.current[currentIndex];
        
        if (currentButton) {
            const offset = currentButton.offsetLeft;
            const width = currentButton.offsetWidth;
            setIndicatorStyle({
                transform: `translateX(${offset}px)`,
                width: `${width}px`
            });
        }
    }, [hoveredIndex, activeSizeIndex, sizes]);

    if (!sizes || sizes.length === 0) return null;

    const isSizeUnderIndicator = (index) => {
        return index === (hoveredIndex !== null ? hoveredIndex : activeSizeIndex);
    };

    return (
        <div className="product-sizes">
            <div className="sizes-wrapper">
                <div
                    className="size-indicator"
                    style={indicatorStyle}
                />
                {sizes.map((s, index) => (
                    <button
                        key={s.id}
                        ref={(el) => (sizeRefs.current[index] = el)}
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