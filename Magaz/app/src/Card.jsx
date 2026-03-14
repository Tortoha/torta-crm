import { Link } from "react-router-dom";

function Card(props) {

    const { id, imag, title, price } = props;

    return (
        <>
            <Link to={`/product/${id}`} className="a-card">
                <div className="card-gruop">
                    <div className="card">
                        <img src={imag} alt="" className="card-image" />
                    </div>
                    <h3>{title}</h3>
                    <h2><span className="mini-price-title">From</span> ${price}</h2>
                </div>
            </Link>
        </>
    )
}

export default Card