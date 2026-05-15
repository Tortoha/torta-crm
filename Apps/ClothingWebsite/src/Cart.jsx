import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import Header from "./Header";
import CartItem from "./Elements/CartItem";
import CartSummary from "./Elements/CartSummary";
import "./Style/Cart.css";
import "./Style/Load.css";
import { client, pickError } from "./api.js"

function Cart() {
    // API STATE
    const [cartData, setCartData] = useState(null);
    const [loading, setLoading]   = useState(true);
    const navigate                = useNavigate();

    const loadCart = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const { ok, status, data } = await client.cart.get();
            if (status === 401) { navigate("/login"); return; }
            if (ok) setCartData(data);
        } catch (e) {
            console.error(e);
        } finally {
            if (!silent) setLoading(false);
        }
    };

    useEffect(() => { loadCart(); }, []);

    // API ACTIONS
    const handleUpdateQuantity = async (cartItemId, newQuantity) => {
        if (newQuantity < 1) return;
        const { ok } = await client.cart.update(cartItemId, newQuantity);
        if (ok) { setAppliedPromo(null); setPromoCode(""); loadCart(true); }
    };

    const handleRemoveItem = async (cartItemId) => {
        const { ok } = await client.cart.remove(cartItemId);
        if (ok) { setAppliedPromo(null); setPromoCode(""); loadCart(true); }
    };

    const handleToggleFavorite = async (productId, productHash) => {
        const isFav = cartData.favorites_ids.includes(productId);
        if (isFav) {
            await client.favorites.remove(productHash);
        } else {
            await client.favorites.add(productId);
        }
        loadCart(true);
    };

    const handleApplyPromo = async () => {
        if (!promoCode.trim()) { setPromoError(""); setAppliedPromo(null); return; }
        const { ok, data } = await client.promos.apply(promoCode);
        if (ok) {
            setAppliedPromo(data);
            setPromoError("");
        } else {
            setAppliedPromo(null);
            setPromoError(pickError(data, "Invalid promo code"));
        }
    };

    // VISUAL STATE
    const [promoCode, setPromoCode]       = useState("");
    const [appliedPromo, setAppliedPromo] = useState(null);
    const [promoError, setPromoError]     = useState("");

    // LOADING / EMPTY
    if (loading) return (
        <div id="mask" className="mask">
            <svg><circle cx="50" cy="50" r="40" /></svg>
        </div>
    );

    if (!cartData || cartData.items.length === 0) return (
        <>
            <Header />
            <div className="cart-empty">
                <h1>Your cart is empty</h1>
                <p>Add some items to get started!</p>
                <Link to="/" className="btn-home">To the home page</Link>
            </div>
        </>
    );

    return (
        <>
            <Header />
            <div className="cart-page">
                <div className="cart-left">
                    <h1 className="cart-section-title">Cart</h1>
                    <div className="cart-items-list">
                        {cartData.items.map((item) => (
                            <CartItem
                                key={item.cart_item_id}
                                item={item}
                                isFavorite={item.is_favorite}
                                onUpdateQuantity={handleUpdateQuantity}
                                onRemove={handleRemoveItem}
                                onToggleFavorite={handleToggleFavorite}
                            />
                        ))}
                    </div>
                </div>

                <div className="cart-right">
                    <h1 className="cart-section-title">Summary</h1>
                    <CartSummary
                        cartData={cartData}
                        promoCode={promoCode}
                        setPromoCode={setPromoCode}
                        appliedPromo={appliedPromo}
                        promoError={promoError}
                        onApplyPromo={handleApplyPromo}
                    />
                </div>
            </div>
        </>
    );
}

export default Cart