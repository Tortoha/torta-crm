import { useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import Header from "./Header";
import "./Style/Product.css";
import heartIcon from "../icons/Like.png";

const API_URL = "http://localhost:8000";

function Product() {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeVariation, setActiveVariation] = useState(0);
    const [activeSize, setActiveSize] = useState(null);
    const [hoveredVariation, setHoveredVariation] = useState(null);
    const [hoveredSize, setHoveredSize] = useState(null);
    const [isFavorite, setIsFavorite] = useState(false);
    const [isInCart, setIsInCart] = useState(false);
    const [cartItemId, setCartItemId] = useState(null);
    const [cartQuantity, setCartQuantity] = useState(1);
    const [addingToCart, setAddingToCart] = useState(false);
    const [cartItems, setCartItems] = useState([]);

    const { id } = useParams();

    useEffect(() => {
        setLoading(true);
        Promise.all([
            fetch(`${API_URL}/api-products`).then((res) => res.json()),
            fetch(`${API_URL}/api/favorites`, { credentials: "include" })
                .then((res) => res.json())
                .catch(() => []),
            fetch(`${API_URL}/api/cart`, { credentials: "include" })
                .then((res) => res.json())
                .catch(() => []),
        ])
            .then(([products, favorites, cart]) => {
                setData(products);
                setCartItems(cart);
                const favoriteIds = favorites.map((f) => f.product_id);
                setIsFavorite(favoriteIds.includes(parseInt(id, 10)));
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, [id]);

    // Фильтрация вариаций и размеров по наличию на складе
    const getAvailableVariations = (product) => {
        if (!product || !product.variations) return [];

        return product.variations.filter(variation => {
            const availableSizes = variation.sizes.filter(size => size.stock_quantity > 0);
            return availableSizes.length > 0;
        }).map(variation => ({
            ...variation,
            sizes: variation.sizes.filter(size => size.stock_quantity > 0)
        }));
    };

    // Автоматически выбираем первый размер
    useEffect(() => {
        if (data.length > 0) {
            const prod = data.find((item) => item.id === parseInt(id, 10));
            if (prod) {
                const availableVariations = getAvailableVariations(prod);
                if (availableVariations[activeVariation]?.sizes?.length > 0) {
                    const firstSize = availableVariations[activeVariation].sizes[0];
                    setActiveSize({ id: firstSize.id, name: firstSize.size_name });
                }
            }
        }
    }, [data, activeVariation, id]);

    // Проверяем, есть ли товар в корзине
    useEffect(() => {
        const checkIfInCart = async () => {
            if (!activeSize) return;

            try {
                const prod = data.find((item) => item.id === parseInt(id, 10));
                if (!prod) return;

                const availableVariations = getAvailableVariations(prod);
                const currentVariation = availableVariations[activeVariation];

                const foundItem = cartItems.find(
                    (item) =>
                        item.product_id === prod.id &&
                        item.variation_id === currentVariation.id &&
                        item.size_id === activeSize.id
                );

                if (foundItem) {
                    setIsInCart(true);
                    setCartItemId(foundItem.cart_item_id);
                    setCartQuantity(foundItem.quantity);
                } else {
                    setIsInCart(false);
                    setCartItemId(null);
                    setCartQuantity(1);
                }
            } catch (error) {
                setIsInCart(false);
                setCartItemId(null);
                setCartQuantity(1);
            }
        };

        if (data.length > 0 && activeSize) {
            checkIfInCart();
        }
    }, [data, activeVariation, activeSize, id, cartItems]);

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

    // Проверка, есть ли вариация в корзине
    const isVariationInCart = (variationId) => {
        return cartItems.some(item =>
            item.product_id === parseInt(id, 10) &&
            item.variation_id === variationId
        );
    };

    // Проверка, есть ли размер в корзине
    const isSizeInCart = (sizeId) => {
        const prod = data.find((item) => item.id === parseInt(id, 10));
        if (!prod) return false;

        const availableVariations = getAvailableVariations(prod);
        const currentVariation = availableVariations[activeVariation];

        return cartItems.some(item =>
            item.product_id === prod.id &&
            item.variation_id === currentVariation.id &&
            item.size_id === sizeId
        );
    };

    if (loading) {
        return (
            <div id="mask" className="mask">
                <svg>
                    <circle cx="50" cy="50" r="40" />
                </svg>
            </div>
        );
    }

    const prod = data.find((item) => item.id === parseInt(id, 10));
    if (!prod) {
        return (
            <div className="center">
                <section className="text-section">
                    <h1 className="main-title">Error 404</h1>
                    <p className="subtitle">Page not found</p>
                </section>
            </div>
        );
    }

    const availableVariations = getAvailableVariations(prod);
    const currentVariation = availableVariations[activeVariation];
    const showVariationsList = availableVariations.length > 1;

    const averageRating =
        prod.reviews?.length > 0
            ? (
                prod.reviews.reduce((sum, r) => sum + r.rating, 0) /
                prod.reviews.length
            ).toFixed(1)
            : "0.0";

    const handleSizeClick = (sizeId, sizeName) => {
        setActiveSize({ id: sizeId, name: sizeName });
    };

    const handleVariationClick = (index) => {
        setActiveVariation(index);
        const newVariation = availableVariations[index];
        if (activeSize) {
            const sizeExists = newVariation.sizes.some(
                (s) => s.size_name === activeSize.name
            );
            if (!sizeExists && newVariation.sizes.length > 0) {
                const firstSize = newVariation.sizes[0];
                setActiveSize({ id: firstSize.id, name: firstSize.size_name });
            }
        }
    };

    const handleToggleCart = async () => {
        if (!currentVariation || !currentVariation.id) {
            return;
        }

        if (!activeSize || !activeSize.id) {
            return;
        }

        setAddingToCart(true);

        try {
            if (isInCart && cartItemId) {
                // Удаляем из корзины
                const response = await fetch(`${API_URL}/api/cart/${cartItemId}`, {
                    method: "DELETE",
                    credentials: "include",
                });

                if (response.ok) {
                    setIsInCart(false);
                    setCartItemId(null);
                    setCartQuantity(1);

                    // Обновляем список корзины
                    const cartResponse = await fetch(`${API_URL}/api/cart`, {
                        credentials: "include",
                    });
                    if (cartResponse.ok) {
                        const updatedCart = await cartResponse.json();
                        setCartItems(updatedCart);
                    }
                }
            } else {
                // Добавляем в корзину
                const requestBody = {
                    product_id: prod.id,
                    variation_id: currentVariation.id,
                    size_id: activeSize.id,
                    quantity: 1,
                };

                const response = await fetch(`${API_URL}/api/cart/add`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    credentials: "include",
                    body: JSON.stringify(requestBody),
                });

                if (response.ok) {
                    // Перезагружаем корзину
                    const cartResponse = await fetch(`${API_URL}/api/cart`, {
                        credentials: "include",
                    });

                    if (cartResponse.ok) {
                        const updatedCart = await cartResponse.json();
                        setCartItems(updatedCart);

                        const foundItem = updatedCart.find(
                            (item) =>
                                item.product_id === prod.id &&
                                item.variation_id === currentVariation.id &&
                                item.size_id === activeSize.id
                        );

                        if (foundItem) {
                            setIsInCart(true);
                            setCartItemId(foundItem.cart_item_id);
                            setCartQuantity(foundItem.quantity);
                        }
                    }
                }
            }
        } catch (error) {
        } finally {
            setAddingToCart(false);
        }
    };

    const handleUpdateQuantity = async (newQuantity) => {
        if (newQuantity < 1 || !cartItemId) return;

        try {
            const response = await fetch(`${API_URL}/api/cart/${cartItemId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                credentials: "include",
                body: JSON.stringify({ quantity: newQuantity }),
            });

            if (response.ok) {
                setCartQuantity(newQuantity);

                // Обновляем список корзины
                const cartResponse = await fetch(`${API_URL}/api/cart`, {
                    credentials: "include",
                });
                if (cartResponse.ok) {
                    const updatedCart = await cartResponse.json();
                    setCartItems(updatedCart);
                }
            }
        } catch (error) {
            // Ошибка без alert
        }
    };

    const handleToggleFavorite = async () => {
        try {
            const method = isFavorite ? "DELETE" : "POST";
            const url = isFavorite
                ? `${API_URL}/api/favorites/${prod.id}`
                : `${API_URL}/api/favorites/add`;

            const response = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body:
                    method === "POST"
                        ? JSON.stringify({ product_id: prod.id })
                        : undefined,
            });

            if (response.ok) {
                setIsFavorite(!isFavorite);
            }
        } catch (error) {
            // Ошибка без alert
        }
    };

    const getActiveSizeIndex = () => {
        if (!currentVariation || !activeSize) return 0;
        return currentVariation.sizes.findIndex(
            (s) => s.size_name === activeSize.name
        );
    };

    const isSizeUnderIndicator = (index) => {
        const indicatorIndex =
            hoveredSize !== null ? hoveredSize : getActiveSizeIndex();
        return index === indicatorIndex;
    };

    return (
        <>
            <Header />

            <main className="product-page">
                <div className="product-image-wrapper">
                    {currentVariation && (
                        <img
                            src={currentVariation.image}
                            alt={prod.title}
                            className="product-main-image"
                        />
                    )}
                </div>

                <div className="product-info">
                    <h1 className="product-title">{prod.title}</h1>
                    <p className="product-description">{prod.description}</p>
                    <h2 className="product-price">{prod.price}$</h2>

                    {showVariationsList && (
                        <div className="product-variations">
                            <div className="variation-list">
                                {availableVariations.map((v, index) => (
                                    <button
                                        key={v.id}
                                        className={`variation-item ${index === activeVariation ? "variation-item--active" : ""
                                            }`}
                                        onClick={() => handleVariationClick(index)}
                                        onMouseEnter={() => setHoveredVariation(index)}
                                        onMouseLeave={() => setHoveredVariation(null)}
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
                                        transform: `translateX(${(hoveredVariation !== null
                                            ? hoveredVariation
                                            : activeVariation) * 92
                                            }px)`,
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    {currentVariation && currentVariation.sizes.length > 0 && (
                        <div className="product-sizes">
                            <div className="sizes-wrapper">
                                <div
                                    className="size-indicator"
                                    style={{
                                        transform: `translateX(${(hoveredSize !== null ? hoveredSize : getActiveSizeIndex()) *
                                            76
                                            }px)`,
                                    }}
                                />
                                {currentVariation.sizes.map((s, index) => (
                                    <button
                                        key={s.id}
                                        className={`size-item ${isSizeUnderIndicator(index) ? "size-item--white" : ""
                                            }`}
                                        onClick={() => handleSizeClick(s.id, s.size_name)}
                                        onMouseEnter={() => setHoveredSize(index)}
                                        onMouseLeave={() => setHoveredSize(null)}
                                    >
                                        {s.size_name}
                                        {isSizeInCart(s.id) && (
                                            <div className="cart-indicator-dot"></div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="product-actions">
                        <div className={`cart-button-container ${isInCart ? "cart-button-container--expanded" : ""}`}>
                            <button
                                className={`btn-primary ${isInCart ? "btn-primary--active" : ""}`}
                                onClick={handleToggleCart}
                                disabled={addingToCart}
                            >
                                {addingToCart ? "Loading..." : isInCart ? "Remove From Cart" : "Add To Cart"}
                            </button>

                            {isInCart && (
                                <div className="quantity-counter">
                                    <button
                                        className="quantity-btn"
                                        onClick={() => handleUpdateQuantity(cartQuantity - 1)}
                                    >
                                        -
                                    </button>
                                    <span className="quantity-value">{cartQuantity}</span>
                                    <button
                                        className="quantity-btn"
                                        onClick={() => handleUpdateQuantity(cartQuantity + 1)}
                                    >
                                        +
                                    </button>
                                </div>
                            )}
                        </div>

                        <button
                            className={`btn-icon ${isFavorite ? "btn-icon--active" : ""}`}
                            onClick={handleToggleFavorite}
                        >
                            <img src={heartIcon} alt="Favorite" className="heart-icon" />
                        </button>
                    </div>

                    <div className="product-characteristics">
                        <p>{prod.characteristics}</p>
                    </div>

                    {prod.reviews && prod.reviews.length > 0 && (
                        <section className="product-reviews">
                            <div className="reviews-header">
                                <h3>Reviews ({prod.reviews.length})</h3>
                                <div className="reviews-header-right">
                                    <div className="reviews-rating">
                                        <span className="rating-value">{averageRating}</span>
                                        <span className="rating-stars">★★★★★</span>
                                    </div>
                                    <button className="btn-write-review">Write a Review</button>
                                </div>
                            </div>
                            <div className="reviews-list">
                                {prod.reviews.map((r, i) => (
                                    <article key={i} className="review-card">
                                        <div className="review-header">
                                            <div className="review-author">
                                                <span className="review-user-time">
                                                    {r.user_name} · {formatTimeAgo(r.created_at)}
                                                </span>
                                            </div>
                                            <span className="review-rating">
                                                {"★".repeat(r.rating)}
                                            </span>
                                        </div>
                                        <p className="review-text">{r.comment}</p>
                                    </article>
                                ))}
                            </div>
                        </section>
                    )}
                </div>
            </main>
        </>
    );
}

export default Product