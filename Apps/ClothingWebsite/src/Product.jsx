import { useParams } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import Header from "./Header";
import "./Style/Product.css";
import "./Style/Load.css";
import StarRating from "./Elements/StarRating";
import ProductVariations from "./Elements/ProductVariations";
import ProductActions from "./Elements/ProductActions";
import ReviewMenu from "./Elements/ReviewMenu";
import ReviewsList from "./Elements/ReviewsList";
import CartButton from "./CartButton";
import { client } from "./api.js"

function Product() {
    const { id } = useParams();

    // API STATE
    const [page, setPage] = useState(null);
    const [loading, setLoading] = useState(true);
    const [addingToCart, setAddingToCart] = useState(false);

    const loadPage = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const { ok, data } = await client.products.get(id);
            if (!ok) { setPage(null); return; }
            setPage(data);
            if (!silent) {
                setActiveVariation(data.initial_variation_index || 0);
                setActiveConfiguration(data.initial_configuration_id ? { id: data.initial_configuration_id } : null);
                client.track.productView(data.id);
            }
        } catch (e) {
            console.error(e);
            setPage(null);
        } finally {
            if (!silent) setLoading(false);
        }
    };

    useEffect(() => { loadPage(); }, [id]);

    // API ACTIONS
    const notifyCartUpdate = () => window.dispatchEvent(new Event("cartUpdated"));

    const handleVariationClick = (index) => {
        setActiveVariation(index);
        const conf_2 = page.conf_1?.[index]?.conf_2 || [];
        const same = conf_2.find(c => c.id === activeConfiguration?.id);
        const pick = same || conf_2[0];
        setActiveConfiguration(pick ? { id: pick.id, name: pick.name } : null);
    };

    const handleToggleCart = async () => {
        if (!page.is_authenticated) { window.location.href = "/login"; return; }
        if (!currentVariation || !currentConfiguration) return;
        setAddingToCart(true);
        if (currentConfiguration.cart_item_id) {
            await client.cart.remove(currentConfiguration.cart_item_id);
        } else {
            await client.cart.add(page.id, currentVariation.id, currentConfiguration.id, 1);
        }
        notifyCartUpdate();
        await loadPage(true);
        setAddingToCart(false);
    };

    const handleUpdateQuantity = async (newQuantity) => {
        if (!currentConfiguration?.cart_item_id || newQuantity < 1 || newQuantity > maxStock) return;
        await client.cart.update(currentConfiguration.cart_item_id, newQuantity);
        notifyCartUpdate();
        loadPage(true);
    };

    const handleToggleFavorite = async () => {
        if (!page.is_authenticated) { window.location.href = "/login"; return; }
        if (page.is_favorite) {
            await client.favorites.remove(page.product_hash);
        } else {
            await client.favorites.add(page.id);
        }
        loadPage(true);
    };

    // VISUAL STATE
    const [activeVariation, setActiveVariation] = useState(0);
    const [activeConfiguration, setActiveConfiguration] = useState(null);
    const [hoveredVariation, setHoveredVariation] = useState(null);
    const [hoveredConfiguration, setHoveredConfiguration] = useState(null);

    // Sliding indicator that follows the active/hovered configuration button.
    // (Inlined here instead of a separate <ProductConfigurations> component —
    //  one tiny picker doesn't deserve its own file.)
    const cfgRefs = useRef([]);
    const [cfgIndicatorStyle, setCfgIndicatorStyle] = useState({ transform: 'translateX(0px)', width: '64px' });

    // Recalculate the indicator position whenever the user hovers a different
    // button, picks a different configuration, or switches variation (which
    // swaps the whole list of buttons).
    useEffect(() => {
        const cfgs = page?.conf_1?.[activeVariation]?.conf_2 || [];
        const activeIdx = cfgs.findIndex(c => c.id === activeConfiguration?.id);
        const idx = hoveredConfiguration !== null ? hoveredConfiguration : (activeIdx >= 0 ? activeIdx : 0);
        const btn = cfgRefs.current[idx];
        if (btn) {
            setCfgIndicatorStyle({
                transform: `translateX(${btn.offsetLeft}px)`,
                width: `${btn.offsetWidth}px`,
            });
        }
    }, [hoveredConfiguration, activeConfiguration?.id, activeVariation, page]);

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
    const currentVariation = page.conf_1?.[activeVariation] || null;
    const currentConfiguration = currentVariation?.conf_2?.find(c => c.id === activeConfiguration?.id) || null;
    const isInCart = !!currentConfiguration?.cart_item_id;
    const cartQuantity = currentConfiguration?.cart_quantity || 1;
    const maxStock = currentConfiguration?.stock_quantity || 0;
    const currentPrice = currentConfiguration?.price || 0;
    const activeConfigurationIndex = currentVariation?.conf_2?.findIndex(c => c.id === activeConfiguration?.id) ?? 0;

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
                    <p className="product-subtitle">{page.subtitle}</p>
                    <h2 className="product-price">${currentPrice}</h2>

                    <ProductVariations
                        variations={page.conf_1}
                        activeIndex={activeVariation}
                        hoveredIndex={hoveredVariation}
                        onVariationClick={handleVariationClick}
                        onVariationHover={setHoveredVariation}
                        isVariationInCart={(variationId) =>
                            page.conf_1.some(v => v.id === variationId && v.is_in_cart)
                        }
                    />

                    {/* ── Configurations picker (S / M / L · 30cm / 40cm · …) ── */}
                    {currentVariation?.conf_2?.length > 0 && (
                        <div className="product-sizes">
                            <div className="sizes-wrapper">
                                <div className="size-indicator" style={cfgIndicatorStyle} />
                                {currentVariation.conf_2.map((c, index) => {
                                    const underIndicator = index === (
                                        hoveredConfiguration !== null ? hoveredConfiguration : activeConfigurationIndex
                                    );
                                    return (
                                        <button
                                            key={c.id}
                                            ref={el => (cfgRefs.current[index] = el)}
                                            className={`size-item ${underIndicator ? 'size-item--white' : ''}`}
                                            onClick={() => setActiveConfiguration({ id: c.id, name: c.name })}
                                            onMouseEnter={() => setHoveredConfiguration(index)}
                                            onMouseLeave={() => setHoveredConfiguration(null)}
                                        >
                                            {c.name}
                                            {c.is_in_cart && <div className="cart-indicator-dot" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

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

                    <div className="product-description">
                        <p>{page.description}</p>
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
                                    onReviewSubmitted={() => loadPage(true)}
                                />
                            </div>
                        </div>
                        <ReviewsList
                            reviews={page.reviews}
                            currentUserId={page.current_user_id}
                            onReviewDeleted={() => loadPage(true)}
                        />
                    </section>
                </div>
            </main>

            <CartButton />
        </>
    );
}

export default Product
