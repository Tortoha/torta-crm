import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Header from "./Header";
import CartItem from "./Elements/CartItem";
import CartSummary from "./Elements/CartSummary";
import "./Style/Cart.css";
import "./Style/Load.css";

const API_URL = "http://localhost:8000";

function Cart() {
  const [cartData, setCartData] = useState({ items: [], shipping_settings: {} });
  const [loading, setLoading] = useState(true);
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [favoritesIds, setFavoritesIds] = useState([]);
  const [promoError, setPromoError] = useState("");
  const navigate = useNavigate();

  const loadCart = async () => {
    try {
      const [cartRes, favRes] = await Promise.all([
        fetch(`${API_URL}/api/pages/cart`, { credentials: "include" }),
        fetch(`${API_URL}/api/pages/favorites`, { credentials: "include" })
          .then(r => r.ok ? r.json() : [])
          .catch(() => [])
      ]);

      if (cartRes.status === 401) {
        navigate("/login");
        return;
      }

      if (cartRes.ok) {
        const data = await cartRes.json();
        setCartData(data);
        setFavoritesIds(favRes);
      }
    } catch (error) {
      console.error("Error loading cart:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCart();
  }, []);

  const handleUpdateQuantity = async (cartItemId, newQuantity) => {
    if (newQuantity < 1) return;

    try {
      const response = await fetch(`${API_URL}/api/cart/${cartItemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ quantity: newQuantity }),
      });

      if (response.ok) {
        await loadCart();
        setAppliedPromo(null);
      }
    } catch (error) {
      console.error("Error updating quantity:", error);
    }
  };

  const handleRemoveItem = async (cartItemId) => {
    try {
      const response = await fetch(`${API_URL}/api/cart/${cartItemId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (response.ok) {
        await loadCart();
        setAppliedPromo(null);
      }
    } catch (error) {
      console.error("Error removing item:", error);
    }
  };

  const handleToggleFavorite = async (productId) => {
    const isFavorite = favoritesIds.includes(productId);
    const url = isFavorite
      ? `${API_URL}/api/favorites/${productId}`
      : `${API_URL}/api/favorites/add`;
    const method = isFavorite ? "DELETE" : "POST";

    try {
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: method === "POST" ? JSON.stringify({ product_id: productId }) : undefined,
      });

      if (isFavorite) {
        setFavoritesIds(favoritesIds.filter(id => id !== productId));
      } else {
        setFavoritesIds([...favoritesIds, productId]);
      }
    } catch (error) {
      console.error("Error toggling favorite:", error);
    }
  };

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) {
      setPromoError("");
      setAppliedPromo(null);
      return;
    }

    const subtotal = cartData.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    try {
      const response = await fetch(`${API_URL}/api/promo-code/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: promoCode.toUpperCase(), subtotal }),
      });

      if (response.ok) {
        const data = await response.json();
        setAppliedPromo(data);
        setPromoError("");
      } else {
        const error = await response.json();
        setAppliedPromo(null);
        setPromoError(error.detail || "Invalid promo code");
      }
    } catch (error) {
      console.error("Error applying promo:", error);
      setAppliedPromo(null);
      setPromoError("Error applying promo code");
    }
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

  if (cartData.items.length === 0) {
    return (
      <>
        <Header />
        <div className="cart-empty">
          <h1>Your cart is empty</h1>
          <p>Add some items to get started!</p>
        </div>
      </>
    );
  }

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
                isFavorite={favoritesIds.includes(item.product_id)}
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
            items={cartData.items}
            shippingSettings={cartData.shipping_settings}
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