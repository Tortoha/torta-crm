import { useEffect, useState } from "react";
import Card from "./Card";

const API_URL = "http://localhost:8000";

function FavoritesGrid() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [favRes, prodRes] = await Promise.all([
          fetch(`${API_URL}/api/pages/favorites`, { credentials: "include" }),
          fetch(`${API_URL}/api-products`),
        ]);

        const favoriteIds = favRes.ok ? (await favRes.json()).map(Number) : [];
        const products = prodRes.ok ? await prodRes.json() : [];

        const favSet = new Set(favoriteIds);
        setItems(products.filter((p) => favSet.has(Number(p.id))));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <section className="favorites-grid-section">
        <p className="favorites-loading">Loading your favorites...</p>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="favorites-grid-section">
        <div className="favorites-empty">
          <h2>No favorites yet</h2>
          <p>Start adding items to your favorites!</p>
        </div>
      </section>
    );
  }

  return (
    <section className="favorites-grid-section">
      {items.map((d) => (
        <Card
          key={d.id}
          id={d.id}
          imag={d.variations?.[0]?.image}
          title={d.title}
          price={d.price}
        />
      ))}
    </section>
  );
}

export default FavoritesGrid