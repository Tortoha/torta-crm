import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ShoppingBagIcon } from "@heroicons/react/24/solid";
import "./Style/CartButton.css";
import { API_BASE } from "./api.js"

function CartButton() {
  const [subtotal, setSubtotal] = useState(0);

  const fetchCart = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/cart`, {credentials: "include"});
      if (response.ok) {
        const data = await response.json();
        setSubtotal(data.subtotal || 0);
      }
    } catch (error) {
      console.error("Error fetching cart:", error);
    }
  };

  useEffect(() => {
    fetchCart();
    window.addEventListener('cartUpdated', fetchCart);
    return () => {
      window.removeEventListener('cartUpdated', fetchCart);
    };
  }, []);

  if (subtotal === 0) return null;

  return (
    <div className="cart-button">
      <Link to="/cart">
        <ShoppingBagIcon style={{ width: '1em', height: '1em' }} />
        ${(+subtotal % 1 === 0) ? +subtotal : (+subtotal).toFixed(2)}
      </Link>
    </div>
  );
}

export default CartButton