import { useEffect, useState } from "react";
import Card from "./Card";
import { Link } from "react-router-dom";

import "./Style/Load.css";

import { client } from "./api.js"

function FavoritesGrid() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [{ ok: favOk, data: favorites }, { ok: prodOk, data: products }] = await Promise.all([
          client.favorites.list(),
          client.products.list(),
        ]);

        const favList = favOk ? favorites : [];
        const prodList = prodOk ? products : [];

        const favSet = new Set(favList.map(f => f.product_id));
        setItems(prodList.filter((p) => favSet.has(p.id)));
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
