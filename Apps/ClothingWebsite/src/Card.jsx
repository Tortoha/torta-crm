import { Link } from "react-router-dom";

function Card(props) {
    const { id, imag, title, price, compareAtPrice, onSale, discountPercent } = props;

    const showSale = !!onSale && compareAtPrice != null && compareAtPrice > price;

    return (
        <Link to={`/product/${id}`} className="a-card">
            <div className="card-gruop">
                <div className="card">
                    <img src={imag} alt="" className="card-image" />
                    {showSale && discountPercent != null && (
                        <span className="card-sale-badge">−{discountPercent}%</span>
                    )}
                </div>
                <h3>{title}</h3>
                {showSale ? (
                    <h2 className="card-price card-price--sale">
                        <span className="card-price-old">${compareAtPrice}</span>
                        <span className="card-price-now">
                            <span className="mini-price-title">From</span> ${price}
                        </span>
                    </h2>
                ) : (
                    <h2 className="card-price">
                        <span className="mini-price-title">From</span> ${price}
                    </h2>
                )}
            </div>
        </Link>
    );
}

export default Card;
