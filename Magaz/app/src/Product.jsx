import { useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import Header from "./Header";
import "./Style/Product.css";
import "./Style/Load.css";
import StarRating from "./Elements/StarRating";
import ProductVariations from "./Elements/ProductVariations";
import ProductSizes from "./Elements/ProductSizes";
import ProductActions from "./Elements/ProductActions";
import ReviewMenu from "./Elements/ReviewMenu";
import ReviewsList from "./Elements/ReviewsList";
import CartButton from "./CartButton";

const API_URL = "http://localhost:8000";

function Product() {
    const { id } = useParams();

    // API STATE
    const [page, setPage]               = useState(null);
    const [loading, setLoading]         = useState(true);
    const [addingToCart, setAddingToCart] = useState(false);

    // Начальная загрузка
    const loadPage = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/product/${id}`, { credentials: "include" });
            if (!res.ok) { setPage(null); return; }
            const data = await res.json();
            setPage(data);
            setActiveVariation(data.initial_variation_index || 0);
            setActiveSize(data.initial_size_id ? { id: data.initial_size_id } : null);
            fetch(`${API_URL}/api/track/product-view`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ product_id: parseInt(id, 10) }),
            }).catch(() => {});
        } catch (e) {
            console.error(e);
            setPage(null);
        } finally {
            setLoading(false);
        }
    };

    // Тихое обновление страницы после действий (добавление в корзину, изменение количества, добавление в избранное)
    const refreshPage = async () => {
        try {
            const res = await fetch(`${API_URL}/api/product/${id}`, { credentials: "include" });
            if (res.ok) setPage(await res.json());
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => { loadPage(); }, [id]);

    // API ACTIONS
    const notifyCartUpdate = () => window.dispatchEvent(new Event("cartUpdated"));

    const handleVariationClick = (index) => {
        setActiveVariation(index);
        const sizes = page.variations?.[index]?.sizes || [];
        const same  = sizes.find(s => s.id === activeSize?.id);
        const pick  = same || sizes[0];
        setActiveSize(pick ? { id: pick.id, name: pick.size_name } : null);
    };

    const handleToggleCart = async () => {
        if (!page.is_authenticated) { window.location.href = "/login"; return; }
        if (!currentVariation || !currentSize) return;
        setAddingToCart(true);
        try {
            if (currentSize.cart_item_id) {
                await fetch(`${API_URL}/api/cart/${currentSize.cart_item_id}`, {
                    method: "DELETE", credentials: "include",
                });
            } else {
                await fetch(`${API_URL}/api/cart/add`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({
                        product_id: page.id,
                        variation_id: currentVariation.id,
                        size_id: currentSize.id,
                        quantity: 1,
                    }),
                });
            }
            notifyCartUpdate();
            await refreshPage();
        } catch (e) {
            console.error(e);
        } finally {
            setAddingToCart(false);
        }
    };

    const handleUpdateQuantity = async (newQuantity) => {
        if (!currentSize?.cart_item_id || newQuantity < 1 || newQuantity > maxStock) return;
        try {
            await fetch(`${API_URL}/api/cart/${currentSize.cart_item_id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ quantity: newQuantity }),
            });
            notifyCartUpdate();
            await refreshPage();
        } catch (e) {
            console.error(e);
        }
    };

    const handleToggleFavorite = async () => {
        if (!page.is_authenticated) { window.location.href = "/login"; return; }
        try {
            await fetch(
                page.is_favorite ? `${API_URL}/api/favorites/${page.id}` : `${API_URL}/api/favorites/add`,
                {
                    method: page.is_favorite ? "DELETE" : "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: !page.is_favorite ? JSON.stringify({ product_id: page.id }) : undefined,
                }
            );
            await refreshPage();
        } catch (e) {
            console.error(e);
        }
    };
    
    // VISUAL STATE
    const [activeVariation, setActiveVariation] = useState(0);
    const [activeSize, setActiveSize]           = useState(null);
    const [hoveredVariation, setHoveredVariation] = useState(null);
    const [hoveredSize, setHoveredSize]           = useState(null);

    // LOADING / NOT FOUND
    if (loading) return (
        <div id="mask" className="mask">
            <svg><circle cx="50" cy="50" r="40" /></svg>
        </div>
    );

    if (!page) return (
        <div className="center">
            <section className="text-section">
                <h1 className="main-title">Error 404</h1>
                <p className="subtitle">Page not found</p>
            </section>
        </div>
    );

    // VISUAL DERIVED DATA
    const currentVariation = page.variations?.[activeVariation] || null;
    const currentSize      = currentVariation?.sizes?.find(s => s.id === activeSize?.id) || null;
    const isInCart         = !!currentSize?.cart_item_id;
    const cartQuantity     = currentSize?.cart_quantity || 1;
    const maxStock         = currentSize?.stock_quantity || 0;
    const currentPrice     = currentSize?.price || 0;
    const activeSizeIndex  = currentVariation?.sizes?.findIndex(s => s.id === activeSize?.id) ?? 0;

    return (
        <>
            <Header />
            <main className="product-page">
                <div className="product-image-wrapper">
                    {currentVariation && (
                        <img src={currentVariation.image} alt={page.title} className="product-main-image" />
                    )}
                </div>

                <div className="product-info">
                    <h1 className="product-title">{page.title}</h1>
                    <p className="product-description">{page.description}</p>
                    <h2 className="product-price">${currentPrice}</h2>

                    <ProductVariations
                        variations={page.variations}
                        activeIndex={activeVariation}
                        hoveredIndex={hoveredVariation}
                        onVariationClick={handleVariationClick}
                        onVariationHover={setHoveredVariation}
                        isVariationInCart={(variationId) =>
                            page.variations.some(v => v.id === variationId && v.is_in_cart)
                        }
                    />

                    <ProductSizes
                        sizes={currentVariation?.sizes}
                        activeSize={activeSize}
                        hoveredIndex={hoveredSize}
                        activeSizeIndex={activeSizeIndex}
                        onSizeClick={(sizeId, sizeName) => setActiveSize({ id: sizeId, name: sizeName })}
                        onSizeHover={setHoveredSize}
                        isSizeInCart={(sizeId) =>
                            currentVariation?.sizes?.some(s => s.id === sizeId && s.is_in_cart) || false
                        }
                    />

                    <ProductActions
                        isInCart={isInCart}
                        isFavorite={page.is_favorite}
                        cartQuantity={cartQuantity}
                        addingToCart={addingToCart}
                        maxStock={maxStock}
                        onToggleCart={handleToggleCart}
                        onUpdateQuantity={handleUpdateQuantity}
                        onToggleFavorite={handleToggleFavorite}
                    />

                    <div className="product-characteristics">
                        <p>{page.characteristics}</p>
                    </div>

                    <section className="product-reviews">
                        <div className="reviews-header">
                            <h3>Reviews ({page.reviews_count})</h3>
                            <div className="reviews-header-right">
                                <StarRating rating={page.average_rating} />
                                <ReviewMenu
                                    productId={page.id}
                                    isAuthenticated={page.is_authenticated}
                                    canReview={page.can_review}
                                    onReviewSubmitted={refreshPage}
                                />
                            </div>
                        </div>
                        <ReviewsList
                            reviews={page.reviews}
                            currentUserId={page.current_user_id}
                            onReviewDeleted={refreshPage}
                        />
                    </section>
                </div>
            </main>

            <CartButton />
        </>
    );
}

export default Product