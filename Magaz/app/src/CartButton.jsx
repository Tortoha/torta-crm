import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import "./Style/CartButton.css";

const API_URL = "http://localhost:8000";

function CartButton() {
  const [subtotal, setSubtotal] = useState(0);

  useEffect(() => {
    const fetchCart = async () => {
      try {
        const response = await fetch(`${API_URL}/api/pages/cart`, { credentials: "include" });
        if (response.ok) {
          const data = await response.json();
          setSubtotal(data.subtotal || 0);
        }
      } catch (error) {
        console.error("Error fetching cart:", error);
      }
    };

    fetchCart();
    const interval = setInterval(fetchCart, 2000);
    return () => clearInterval(interval);
  }, []);

  if (subtotal === 0) return null;

  return (
    <div className="cart-button">
      <Link to="/cart">${Math.round(subtotal)}</Link>
    </div>
  );
}

export default CartButton