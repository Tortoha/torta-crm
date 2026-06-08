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
import { fmtMoney } from "./currency.js"

// Mirror External's _media_type() so the gallery picks <video>/<img> correctly even
// when the backend's typed media[] is absent (older data) — classify by extension.
function guessMediaType(url) {
    const u = (url || '').toLowerCase().split('?')[0];
    if (/\.(mp4|webm|mov|m4v)$/.test(u)) return 'video';
    if (/\.(glb|usdz|gltf)$/.test(u))    return 'model';
    return 'image';
}

function Product() {
    const { id } = useParams();

    // API STATE
    const [page, setPage] = useState(null);
    const [loading, setLoading] = useState(true);
    const [addingToCart, setAddingToCart] = useState(false);
    // Modifier item ids selected by the customer; reset on product load.
    const [selectedModifiers, setSelectedModifiers] = useState([]);
    // Delivery ETA aggregate from all merchant warehouses — drives the
    // "Delivery in 2–4 days" hint shown beside Add to Cart. Loaded once
    // per session; storefront hides the hint when no warehouse has ETA set.
    const [deliveryEta, setDeliveryEta] = useState(null);
    useEffect(() => {
        let mounted = true;
        // Optional-chained: if the storefront's torta-js bundle is older
        // than the page (Vite dep cache mismatch right after SDK upgrade),
        // `client.shipping` may be undefined. A missing delivery-ETA hint
        // should not crash the whole product page — silently skip.
        client.shipping?.deliveryEta?.()
            .then(r => mounted && r.ok && setDeliveryEta(r.data))
            .catch(() => {});
        return () => { mounted = false; };
    }, []);

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
        const cfgs = page.conf_layer_1?.[index]?.conf_layer_2 || [];
        const same = cfgs.find(c => c.id === activeConfiguration?.id);
        const pick = same || cfgs[0];
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
        setAddingToCart(true);
        try {
            // Toggle: remove this configuration's cart line, or add a new one (modifier sibling lines stay).
            if (isInCart && currentConfiguration.cart_item_id) {
                await client.cart.remove(currentConfiguration.cart_item_id);
            } else {
                if (modifierError()) return;
                await client.cart.add(page.id, currentVariation.id, currentConfiguration.id, 1, selectedModifiers);
            }
            notifyCartUpdate();
            await loadPage(true);
        } finally { setAddingToCart(false); }
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

    // Sliding indicator that follows the active/hovered configuration button (inlined; too small for its own component).
    const cfgRefs = useRef([]);
    const [cfgIndicatorStyle, setCfgIndicatorStyle] = useState({ transform: 'translateX(0px)', width: '64px' });

    // Recalculate indicator position on hover/pick/variation change.
    useEffect(() => {
        const cfgs = page?.conf_layer_1?.[activeVariation]?.conf_layer_2 || [];
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

    // Product media gallery — active slot index; -1 means "auto" (show the cover).
    const [activeMedia, setActiveMedia] = useState(-1);
    useEffect(() => { setActiveMedia(-1); }, [activeVariation]);

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
    const currentVariation = page.conf_layer_1?.[activeVariation] || null;
    // Typed media gallery for the active variation — prefer the backend's typed
    // media[]; fall back to raw images[] (typed by extension) or the single cover.
    const galleryMedia = (
        currentVariation?.media?.length ? currentVariation.media
        : currentVariation?.images?.length ? currentVariation.images.map(u => ({ url: u, type: guessMediaType(u) }))
        : currentVariation?.image ? [{ url: currentVariation.image, type: guessMediaType(currentVariation.image) }]
        : []
    );
    // Default view = the cover (first real image), else the first slot. activeMedia < 0 = "auto".
    // Default to the FIRST media in gallery order (respect the merchant's ordering —
    // if a video is first, the gallery opens on the video).
    const activeMediaIdx = activeMedia < 0 ? 0 : Math.min(activeMedia, galleryMedia.length - 1);
    const activeMediaItem = galleryMedia[activeMediaIdx] || null;
    const currentConfiguration = currentVariation?.conf_layer_2?.find(c => c.id === activeConfiguration?.id) || null;
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
    const compareAtPrice = currentConfiguration?.compare_at_price || null;
    const onSale = !!currentConfiguration?.on_sale;
    const currentPrice = basePrice + modifierDelta;
    const activeConfigurationIndex = currentVariation?.conf_layer_2?.findIndex(c => c.id === activeConfiguration?.id) ?? 0;
    const modError = modifierError();
    // Phase 1: Stock indicator messaging.
    const continueOOS = !!page.continue_selling_oos;
    const lowThreshold = page.low_stock_threshold || 0;
    // Show stock indicator only when useful (OOS, backorder, low stock); "in stock" stays implicit.
    let stockMessage = null;
    if (maxStock === 0) {
        stockMessage = continueOOS ? 'Available on backorder' : 'Out of stock';
    } else if (lowThreshold > 0 && maxStock <= lowThreshold) {
        stockMessage = `Only ${maxStock} left in stock`;
    }
    // Phase 1: B2B MOQ feedback for the customer.
    const moq = page.moq || 1;
    const moqHint = moq > 1 ? `Minimum order: ${moq} pcs` : null;
    // Phase 6: pre-order banner.
    const preOrderHint = page.is_pre_order && page.pre_order_release_at
        ? `Ships from ${new Date(page.pre_order_release_at).toLocaleDateString()}`
        : null;

    return (
        <>
            <Header />
            <main className="product-page">
                <div className="product-image-wrapper">
                    {activeMediaItem && (
                        activeMediaItem.type === 'video' ? (
                            <video key={activeMediaItem.url} src={activeMediaItem.url}
                                   className="product-main-image" controls playsInline preload="metadata" />
                        ) : (
                            <img src={activeMediaItem.url} alt={page.title} className="product-main-image" />
                        )
                    )}
                    {galleryMedia.length > 1 && (
                        <>
                            <button type="button" aria-label="Previous"
                                className="product-gallery-arrow product-gallery-arrow--prev"
                                onClick={() => setActiveMedia((activeMediaIdx - 1 + galleryMedia.length) % galleryMedia.length)}>‹</button>
                            <button type="button" aria-label="Next"
                                className="product-gallery-arrow product-gallery-arrow--next"
                                onClick={() => setActiveMedia((activeMediaIdx + 1) % galleryMedia.length)}>›</button>
                        </>
                    )}
                    {galleryMedia.length > 1 && (
                        <div className="product-gallery-thumbs">
                            {galleryMedia.map((m, i) => (
                                <button key={m.url + i} type="button"
                                        className={`product-gallery-thumb${i === activeMediaIdx ? ' is-active' : ''}`}
                                        onClick={() => setActiveMedia(i)}
                                        aria-label={`Media ${i + 1}`}>
                                    {m.type === 'image'
                                        ? <img src={m.url} alt="" loading="lazy" />
                                        : <span className="product-gallery-thumb-icon">{m.type === 'video' ? '▶' : '◰'}</span>}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="product-info">
                    {page.brand && <p className="product-brand">{page.brand}</p>}
                    <h1 className="product-title">{page.title}</h1>
                    <p className="product-subtitle">{page.subtitle}</p>
                    <div className="product-price-row">
                        <h2 className="product-price">${currentPrice}</h2>
                        {compareAtPrice && compareAtPrice > currentPrice && (
                            <span className="product-price-old">${compareAtPrice}</span>
                        )}
                        {onSale && <span className="product-badge product-badge--sale">On Sale</span>}
                        {page.is_pre_order && <span className="product-badge product-badge--preorder">Pre-order</span>}
                    </div>
                    {stockMessage && (
                        <p className={`product-stock product-stock--${
                            maxStock === 0 ? 'oos' :
                            (lowThreshold > 0 && maxStock <= lowThreshold) ? 'low' : 'ok'
                        }`}>{stockMessage}</p>
                    )}
                    {moqHint && <p className="product-moq-hint">{moqHint}</p>}
                    {preOrderHint && <p className="product-preorder-hint">{preOrderHint}</p>}
                    {/* Restock notify-me when out of stock and not continuing-to-sell. */}
                    {maxStock === 0 && !continueOOS && (
                        <RestockButton page={page} skuId={currentConfiguration?.id} />
                    )}

                    {/* Digital products are a single hidden SKU — no variation/size to pick. */}
                    {page.product_type !== 'digital' && (
                        <ProductVariations
                            variations={page.conf_layer_1}
                            activeIndex={activeVariation}
                            hoveredIndex={hoveredVariation}
                            onVariationClick={handleVariationClick}
                            onVariationHover={setHoveredVariation}
                            isVariationInCart={(variationId) =>
                                page.conf_layer_1.some(v => v.id === variationId && v.is_in_cart)
                            }
                        />
                    )}

                    {/* ── Configurations picker (S / M / L · 30cm / 40cm · …) ── */}
                    {page.product_type !== 'digital' && currentVariation?.conf_layer_2?.length > 0 && (
                        <div className="product-sizes">
                            <div className="sizes-wrapper">
                                <div className="size-indicator" style={cfgIndicatorStyle} />
                                {currentVariation.conf_layer_2.map((c, index) => {
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
                                                            {/* Modifier price delta chip — always signed so
                                                                shoppers see `+$2` / `-$1` / `+$0` clearly.
                                                                fmtMoney's `signed` option emits a leading
                                                                `+` only for strictly-positive values, so we
                                                                special-case 0 → "+0 unit" by prefixing the
                                                                bare formatted amount with `+`. */}
                                                            {it.price_delta === 0
                                                              ? `+${fmtMoney(0, { decimals: 0 })}`
                                                              : fmtMoney(it.price_delta, { signed: true })}
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

                    {/* Delivery ETA hint — populated only when the merchant
                        configured ETA on at least one warehouse. Hides itself
                        for digital products (page.product_type === 'digital'). */}
                    {deliveryEta?.min_days != null && deliveryEta?.max_days != null
                     && page.product_type !== 'digital' && (
                        <p className="product-delivery-eta">
                            {deliveryEta.min_days === deliveryEta.max_days
                                ? `Delivery in ${deliveryEta.min_days} day${deliveryEta.min_days === 1 ? "" : "s"}`
                                : `Delivery in ${deliveryEta.min_days}–${deliveryEta.max_days} days`}
                        </p>
                    )}

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

// Notify-me button shown when SKU is OOS — subscribes via /restock/subscribe so the merchant can email on restock.
function RestockButton({ page, skuId }) {
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState(page.is_authenticated ? '' : '');
    const [done, setDone] = useState(false);
    const submit = async () => {
        await client.restock.subscribe(page.id, skuId, email || null);
        setDone(true);
    };
    if (done) return <p className="product-restock-done">We'll email you when it's back.</p>;
    if (!open) return (
        <button type="button" className="product-restock-btn" onClick={() => setOpen(true)}>
            Notify me when it's back
        </button>
    );
    return (
        <div className="product-restock-form">
            {!page.is_authenticated && (
                <input type="email" placeholder="your@email.com" value={email}
                    onChange={e => setEmail(e.target.value)} className="product-restock-input" />
            )}
            <button type="button" className="product-restock-btn" onClick={submit}>
                Subscribe
            </button>
        </div>
    );
}

export default Product
