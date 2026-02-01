import { useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import Header from "./Header";
import "./Style/Product.css";
import StarRating from "./Elements/StarRating";
import ProductVariations from "./Elements/ProductVariations";
import ProductSizes from "./Elements/ProductSizes";
import ProductActions from "./Elements/ProductActions";
import ReviewMenu from "./Elements/ReviewMenu";
import ReviewsList from "./Elements/ReviewsList";

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
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [currentUserId, setCurrentUserId] = useState(null);
    const [canReview, setCanReview] = useState(false);

    const { id } = useParams();

    useEffect(() => {
        loadProductData();
    }, [id]);

    const loadProductData = () => {
        setLoading(true);
        Promise.all([
            fetch(`${API_URL}/api-products`).then((res) => res.json()),
            fetch(`${API_URL}/api/favorites`, { credentials: "include" })
                .then((res) => {
                    if (res.ok) {
                        setIsAuthenticated(true);
                        return res.json();
                    }
                    return [];
                })
                .catch(() => []),
            fetch(`${API_URL}/api/cart`, { credentials: "include" })
                .then((res) => res.ok ? res.json() : [])
                .catch(() => []),
            fetch(`${API_URL}/api/me`, { credentials: "include" })
                .then((res) => res.ok ? res.json() : null)
                .catch(() => null),
        ])
            .then(([products, favorites, cart, user]) => {
                setData(products);
                setCartItems(cart);
                const favoriteIds = favorites.map((f) => f.product_id);
                setIsFavorite(favoriteIds.includes(parseInt(id, 10)));

                if (user) {
                    setCurrentUserId(user.id);
                    // Проверяем, может ли пользователь оставить отзыв
                    checkCanReview();
                }

                setLoading(false);
            })
            .catch(() => setLoading(false));
    };

    const checkCanReview = async () => {
        try {
            const response = await fetch(`${API_URL}/api/reviews/can-review/${id}`, {
                credentials: "include",
            });
            if (response.ok) {
                const data = await response.json();
                setCanReview(data.can_review);
            }
        } catch (error) {
            setCanReview(false);
        }
    };

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

    useEffect(() => {
        if (data.length > 0 && activeSize) {
            checkIfInCart();
        }
    }, [data, activeVariation, activeSize, id, cartItems]);

    const checkIfInCart = () => {
        if (!activeSize) return;
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
    };

    const isVariationInCart = (variationId) => {
        return cartItems.some(item =>
            item.product_id === parseInt(id, 10) && item.variation_id === variationId
        );
    };

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

    const handleVariationClick = (index) => {
        setActiveVariation(index);
        const prod = data.find((item) => item.id === parseInt(id, 10));
        const availableVariations = getAvailableVariations(prod);
        const newVariation = availableVariations[index];
        if (activeSize) {
            const sizeExists = newVariation.sizes.some(s => s.size_name === activeSize.name);
            if (!sizeExists && newVariation.sizes.length > 0) {
                const firstSize = newVariation.sizes[0];
                setActiveSize({ id: firstSize.id, name: firstSize.size_name });
            }
        }
    };

    const handleToggleCart = async () => {
        if (!isAuthenticated) {
            window.location.href = "/login";
            return;
        }

        const prod = data.find((item) => item.id === parseInt(id, 10));
        const availableVariations = getAvailableVariations(prod);
        const currentVariation = availableVariations[activeVariation];

        if (!currentVariation || !activeSize) return;

        setAddingToCart(true);

        try {
            if (isInCart && cartItemId) {
                await fetch(`${API_URL}/api/cart/${cartItemId}`, {
                    method: "DELETE",
                    credentials: "include",
                });
            } else {
                await fetch(`${API_URL}/api/cart/add`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({
                        product_id: prod.id,
                        variation_id: currentVariation.id,
                        size_id: activeSize.id,
                        quantity: 1,
                    }),
                });
            }

            const cartResponse = await fetch(`${API_URL}/api/cart`, { credentials: "include" });
            if (cartResponse.ok) {
                const updatedCart = await cartResponse.json();
                setCartItems(updatedCart);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setAddingToCart(false);
        }
    };

    const handleUpdateQuantity = async (newQuantity) => {
        if (newQuantity < 1 || !cartItemId) return;

        try {
            const response = await fetch(`${API_URL}/api/cart/${cartItemId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ quantity: newQuantity }),
            });

            if (response.ok) {
                setCartQuantity(newQuantity);
                const cartResponse = await fetch(`${API_URL}/api/cart`, { credentials: "include" });
                if (cartResponse.ok) {
                    const updatedCart = await cartResponse.json();
                    setCartItems(updatedCart);
                }
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleToggleFavorite = async () => {
        if (!isAuthenticated) {
            window.location.href = "/login";
            return;
        }

        const prod = data.find((item) => item.id === parseInt(id, 10));
        const method = isFavorite ? "DELETE" : "POST";
        const url = isFavorite
            ? `${API_URL}/api/favorites/${prod.id}`
            : `${API_URL}/api/favorites/add`;

        try {
            const response = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: method === "POST" ? JSON.stringify({ product_id: prod.id }) : undefined,
            });

            if (response.ok) {
                setIsFavorite(!isFavorite);
            }
        } catch (error) {
            console.error(error);
        }
    };

    const getActiveSizeIndex = () => {
        const prod = data.find((item) => item.id === parseInt(id, 10));
        if (!prod) return 0;
        const availableVariations = getAvailableVariations(prod);
        const currentVariation = availableVariations[activeVariation];
        if (!currentVariation || !activeSize) return 0;
        return currentVariation.sizes.findIndex(s => s.size_name === activeSize.name);
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
    const sortedReviews = prod.reviews ? [...prod.reviews].sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
    ) : [];
    const averageRating = sortedReviews.length > 0
        ? (sortedReviews.reduce((sum, r) => sum + r.rating, 0) / sortedReviews.length).toFixed(1)
        : "0.0";

    return (
        <>
            <Header />
            <main className="product-page">
                <div className="product-image-wrapper">
                    {currentVariation && (
                        <img src={currentVariation.image} alt={prod.title} className="product-main-image" />
                    )}
                </div>

                <div className="product-info">
                    <h1 className="product-title">{prod.title}</h1>
                    <p className="product-description">{prod.description}</p>
                    <h2 className="product-price">{prod.price}$</h2>

                    <ProductVariations
                        variations={availableVariations}
                        activeIndex={activeVariation}
                        hoveredIndex={hoveredVariation}
                        onVariationClick={handleVariationClick}
                        onVariationHover={setHoveredVariation}
                        isVariationInCart={isVariationInCart}
                    />

                    <ProductSizes
                        sizes={currentVariation?.sizes}
                        activeSize={activeSize}
                        hoveredIndex={hoveredSize}
                        activeSizeIndex={getActiveSizeIndex()}
                        onSizeClick={(id, name) => setActiveSize({ id, name })}
                        onSizeHover={setHoveredSize}
                        isSizeInCart={isSizeInCart}
                    />

                    <ProductActions
                        isInCart={isInCart}
                        isFavorite={isFavorite}
                        cartQuantity={cartQuantity}
                        addingToCart={addingToCart}
                        onToggleCart={handleToggleCart}
                        onUpdateQuantity={handleUpdateQuantity}
                        onToggleFavorite={handleToggleFavorite}
                    />

                    <div className="product-characteristics">
                        <p>{prod.characteristics}</p>
                    </div>

                    <section className="product-reviews">
                        <div className="reviews-header">
                            <h3>Reviews ({sortedReviews.length})</h3>
                            <div className="reviews-header-right">
                                <StarRating rating={parseFloat(averageRating)} />
                                <ReviewMenu
                                    productId={prod.id}
                                    isAuthenticated={isAuthenticated}
                                    canReview={canReview}
                                    onReviewSubmitted={() => window.location.reload()}
                                />
                            </div>
                        </div>
                        <ReviewsList
                            reviews={prod.reviews}
                            currentUserId={currentUserId}
                            onReviewDeleted={() => window.location.reload()}
                        />
                    </section>
                </div>
            </main>
        </>
    );
}

export default Product