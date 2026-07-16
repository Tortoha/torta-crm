// Static, faithful mock of the CRM Products grid (light theme only).
// Mirrors Pages/Project/Products/ProductsList.jsx card layout.

import { Star, Package } from '@phosphor-icons/react';

const PRODUCTS = [
  { title: 'Oversized Hoodie',    price: '$45',     cat: 'Outerwear',   stock: '128 in stock', rating: '4.6', bg: 'linear-gradient(135deg,#e8ebf2,#d4d9e6)' },
  { title: 'Linen Shirt',         price: '$30–$38', cat: 'Shirts',      stock: '54 in stock',  bg: 'linear-gradient(135deg,#eef1f4,#dfe6ec)' },
  { title: 'Cropped Denim Jacket', price: '$72',    cat: 'Outerwear',   stock: '12 in stock',  bg: 'linear-gradient(135deg,#dce4ef,#c7d4e6)' },
  { title: 'Classic Tee (5-pack)', price: '$24',    cat: 'Basics',      stock: '340 in stock', rating: '4.9', bg: 'linear-gradient(135deg,#f0eef2,#e4dfe8)' },
  { title: 'Wool Beanie',         price: '$18',     cat: 'Accessories', stock: 'Out of stock', bg: 'linear-gradient(135deg,#ece9e6,#ddd7d1)' },
  { title: 'Leather Belt',        price: '$29',     cat: 'Accessories', stock: '63 in stock',  bg: 'linear-gradient(135deg,#eae6e2,#d8cfc6)' },
  { title: 'Canvas Tote',         price: '$22',     cat: 'Bags',        stock: '96 in stock',  rating: '4.7', bg: 'linear-gradient(135deg,#e9ecef,#d6dde3)' },
  { title: 'Pleated Skirt',       price: '$41',     cat: 'Bottoms',     stock: '28 in stock',  bg: 'linear-gradient(135deg,#efe9ee,#e0d5df)' },
];

function Stars({ n }) {
  return (
    <span className="mk-pr-stars">
      <span className="mk-pr-stars-num">{n}</span>
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} weight="fill" className={`mk-pr-star${i < Math.round(Number(n)) ? ' mk-pr-star--on' : ''}`} />
      ))}
    </span>
  );
}

export default function MockProducts() {
  return (
    <div className="mk-pr">
      <div className="mk-pr-group">
        <h3 className="mk-pr-gtitle">Physical <span className="mk-pr-count">8</span></h3>
        <div className="mk-pr-grid">
          {PRODUCTS.map((p) => (
            <div key={p.title} className="mk-pr-card">
              <div className="mk-pr-img" style={{ background: p.bg }}>
                <Package weight="regular" />
              </div>
              <div className="mk-pr-body">
                <div className="mk-pr-title">{p.title}</div>
                <div className="mk-pr-row1">
                  <span className="mk-pr-price">{p.price}</span>
                  <span className="mk-pr-pipe">|</span>
                  <span className="mk-pr-stock">{p.stock}</span>
                </div>
                {p.rating && <Stars n={p.rating} />}
              </div>
              <span className="mk-pr-badge">{p.cat}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
