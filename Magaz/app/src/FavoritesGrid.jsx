import { useEffect, useState } from "react";
import Card from "./Card";
import { Link } from "react-router-dom";

import "./Style/Load.css";

import { API_BASE } from "./api.js"

function FavoritesGrid() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [favRes, prodRes] = await Promise.all([
          fetch(`${API_BASE}/api/favorites`, { credentials: "include" }),
          fetch(`${API_BASE}/api-products`),
        ]);

        const favorites = favRes.ok ? await favRes.json() : [];
        const products = prodRes.ok ? await prodRes.json() : [];

        const favSet = new Set(favorites.map(f => f.product_id));
        setItems(products.filter((p) => favSet.has(p.id)));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div id="mask" className="mask">
        <svg>
          <circle cx="50" cy="50" r="40" />
        </svg>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <section className="favorites-grid-section">
        <div className="favorites-empty">
          <h2>No favorites yet</h2>
          <p>Start adding items to your favorites!</p>
          <Link to={"/"} className="btn-home">To the home page</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="favorites-grid-section">
      {items.map((d) => (
        <Card
          key={d.id}
          id={d.hash}
          imag={d.image}
          title={d.title}
          price={d.price}
        />
      ))}
    </section>
  );
}

export default FavoritesGrid