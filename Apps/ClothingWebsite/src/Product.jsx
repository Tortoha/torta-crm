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
    // Modifier item ids selected by the customer. Reset on product load + when
    // the radio defaults change (e.g. switching variation never affects this,
    // but loading a different product does).
    const [selectedModifiers, setSelectedModifiers] = useState([]);

    const initModifiersFromDefaults = (data) => {
        // Pre-select default_item_id for each radio group that has one.
        const ids = [];
        for (const g of (data?.modifier_groups || [])) {
            if (g.control_type === 'radio' && g.default_item_id != null) {
                ids.push(g.default_item_id);
            }
        }
        setSelectedModifiers(ids);
    };

    const loadPage = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const { ok, data } = await client.products.get(id);
            if (!ok) { setPage(null); return; }
            setPage(data);
            if (!silent) {
                setActiveVariation(data.initial_variation_index || 0);
                setActiveConfiguration(data.initial_configuration_id ? { id: data.initial_configuration_id } : null);
                initModifiersFromDefaults(data);
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

    // Modifier picker handlers — radio replaces, checkbox toggles within group.
    const handleModifierToggle = (group, item) => {
        setSelectedModifiers(prev => {
            const inGroup = (group.items || []).map(i => i.id);
            const others = prev.filter(id => !inGroup.includes(id));
            if (group.control_type === 'radio') {
                // Already selected? Allow clearing (only if !is_required).
                const currentInGroup = prev.find(id => inGroup.includes(id));
                if (currentInGroup === item.id) {
                    return group.is_required ? prev : others;
                }
                return [...others, item.id];
            }
            // Checkbox: toggle. Respect max_select.
            const ownInGroup = prev.filter(id => inGroup.includes(id));
            const isSelected = ownInGroup.includes(item.id);
            if (isSelected) {
                return [...others, ...ownInGroup.filter(id => id !== item.id)];
            }
            const max = group.max_select;
            if (max != null && ownInGroup.length >= max) return prev;
            return [...others, ...ownInGroup, item.id];
        });
    };

    // Group-level validation — used to disable "Add to Cart" when constraints fail.
    const modifierError = () => {
        for (const g of (page?.modifier_groups || [])) {
            const inGroup = (g.items || []).map(i => i.id);
            const picked = selectedModifiers.filter(id => inGroup.includes(id));
            if (g.is_required && picked.length < (g.min_select || 0)) {
                return `${g.name || 'Group'} requires at least ${g.min_select} selection${g.min_select === 1 ? '' : 's'}`;
            }
            if (!g.is_required && picked.length > 0 && picked.length < (g.min_select || 0)) {
                return `${g.name || 'Group'} requires at least ${g.min_select} selection${g.min_select === 1 ? '' : 's'} when picked`;
            }
        }
        return null;
    };

    const handleToggleCart = async () => {
        if (!page.is_authenticated) { window.location.href = "/login"; return; }
        if (!currentVariation || !currentConfiguration) return;
        if (modifierError()) return;
        setAddingToCart(true);
        // Always ADD — backend merges identical (SKU + modifier set) lines.
        // The "remove if already in cart" toggle behaviour only worked for products
        // without modifiers; with modifiers the same SKU can have many distinct lines.
        await client.cart.add(page.id, currentVariation.id, currentConfiguration.id, 1, selectedModifiers);
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
    // Sum modifier deltas for the currently selected items (across all groups).
    const modifierDelta = (page.modifier_groups || []).reduce((acc, g) => {
        for (const it of (g.items || [])) {
            if (selectedModifiers.includes(it.id)) acc += Number(it.price_delta) || 0;
        }
        return acc;
    }, 0);
    const basePrice = currentConfiguration?.price || 0;
    const currentPrice = basePrice + modifierDelta;
    const activeConfigurationIndex = currentVariation?.conf_2?.findIndex(c => c.id === activeConfiguration?.id) ?? 0;
    const modError = modifierError();

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

                    {/* ── Modifier groups (food add-ons / sauces / remove-ingredient) ── */}
                    {(page.modifier_groups || []).length > 0 && (
                        <div className="product-modifiers">
                            {page.modifier_groups.map(g => {
                                const inGroup = (g.items || []).map(i => i.id);
                                const picked = selectedModifiers.filter(id => inGroup.includes(id));
                                const hint = g.control_type === 'radio'
                                    ? (g.is_required ? 'Choose one' : 'Choose one (optional)')
                                    : (g.max_select != null
                                        ? `Choose up to ${g.max_select}`
                                        : (g.min_select > 0 ? `Choose at least ${g.min_select}` : 'Choose any'));
                                return (
                                    <section key={g.id} className="pmod-group">
                                        <header className="pmod-group-head">
                                            <h3 className="pmod-group-title">
                                                {g.name || 'Options'}
                                                {g.is_required && <span className="pmod-required">*</span>}
                                            </h3>
                                            <span className="pmod-group-hint">{hint}</span>
                                        </header>
                                        <div className="pmod-items">
                                            {(g.items || []).map(it => {
                                                const checked = picked.includes(it.id);
                                                return (
                                                    <label key={it.id}
                                                        className={`pmod-item ${checked ? 'pmod-item--on' : ''}`}>
                                                        <input
                                                            type={g.control_type === 'radio' ? 'radio' : 'checkbox'}
                                                            name={`mod-group-${g.id}`}
                                                            checked={checked}
                                                            onChange={() => handleModifierToggle(g, it)}
                                                        />
                                                        <span className="pmod-item-name">{it.name || '—'}</span>
                                                        <span className="pmod-item-price">
                                                            {it.price_delta > 0 ? `+$${it.price_delta}`
                                                                : it.price_delta < 0 ? `-$${Math.abs(it.price_delta)}`
                                                                : '+$0'}
                                                        </span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </section>
                                );
                            })}
                            {modError && <p className="pmod-error">{modError}</p>}
                        </div>
                    )}

                    <ProductActions
                        isInCart={isInCart}
                        isFavorite={page.is_favorite}
                        cartQuantity={cartQuantity}
                        addingToCart={addingToCart}
                        maxStock={maxStock}
                        addDisabled={!!modError}
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
