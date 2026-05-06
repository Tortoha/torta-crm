import { Link } from "react-router-dom";
import heartIcon from "../../icons/Like.png";

function CartItem({ item, isFavorite, onUpdateQuantity, onRemove, onToggleFavorite }) {
  const isQuantityOne = item.quantity === 1;

  return (
    <div className="cart-item">
      <Link to={`/product/${item.product_hash}`}>
        <img src={item.image_url} alt={item.title} className="cart-item-image cart-item-image--link" />
      </Link>

      <div className="cart-item-content">
        <div className="cart-item-header">
          <div className="cart-item-info">
            <Link to={`/product/${item.product_hash}`} className="cart-item-title-link">
              <h2 className="cart-item-title">{item.title}</h2>
            </Link>
            <p className="cart-item-subtitle">{item.subtitle}</p>
            <p className="cart-item-size">{item.configuration_name}</p>
            {/* Selected modifier add-ons (sauces, removals, etc.) — grouped by group_name. */}
            {Array.isArray(item.modifiers) && item.modifiers.length > 0 && (
              <ul className="cart-item-mods">
                {item.modifiers.map(m => (
                  <li key={m.id} className="cart-item-mod">
                    <span className="cart-item-mod-name">
                      {m.group_name ? `${m.group_name}: ` : ''}{m.name}
                    </span>
                    {m.price_delta !== 0 && (
                      <span className="cart-item-mod-delta">
                        {m.price_delta > 0 ? `+$${m.price_delta}` : `-$${Math.abs(m.price_delta)}`}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="cart-item-price">${item.price}</div>
        </div>

        <div className="cart-item-actions">
          <div className="cart-qty-control">
            <button
              className={`cart-qty-btn ${isQuantityOne ? "cart-qty-btn--remove" : ""}`}
              onClick={() => isQuantityOne
                ? onRemove(item.cart_item_id)
                : onUpdateQuantity(item.cart_item_id, item.quantity - 1)
              }
            >
              {isQuantityOne ? "+" : "−"}
            </button>

            <span className="cart-qty-value">{item.quantity}</span>

            <button
              className="cart-qty-btn"
              onClick={() => onUpdateQuantity(item.cart_item_id, item.quantity + 1)}
            >
              +
            </button>
          </div>

          <button
            className={`cart-fav-btn ${isFavorite ? "cart-fav-btn--active" : ""}`}
            onClick={() => onToggleFavorite(item.product_id, item.product_hash)}
          >
            <img src={heartIcon} alt="Favorite" className="heart-icon" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default CartItem