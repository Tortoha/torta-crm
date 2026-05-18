import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Bag } from '@phosphor-icons/react';
import "./Style/CartButton.css";
import { client } from "./api.js"
import { fmtMoney } from "./currency.js"

function CartButton() {
  const [subtotal, setSubtotal] = useState(0);

  const fetchCart = async () => {
    try {
      const { ok, data } = await client.cart.get();
      if (ok) setSubtotal(data.subtotal || 0);
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
        <Bag style={{ width: '1em', height: '1em' }} />
        {fmtMoney(subtotal, { decimals: (+subtotal % 1 === 0) ? 0 : undefined })}
      </Link>
    </div>
  );
}

export default CartButton
