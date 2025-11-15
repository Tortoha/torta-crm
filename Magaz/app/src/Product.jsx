import { useParams } from 'react-router-dom'
import { useState, useEffect } from 'react';

import Header from './Header'
import Card from './Card';

import './Style/Load.css'

function Product() {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        fetch("http://127.0.0.1:8000/api-products")
            .then(res => res.json())
            .then(data => {
                setData(data);
                setLoading(false);
            })
            .catch(err => {
                console.log(err);
                setLoading(false);
            })
    }, [])

    if (loading) {
        return (
            <>
                <div id="mask" class="mask">
                    <svg>
                        <circle cx="50" cy="50" r="40" />
                    </svg>
                </div>
            </>
        );
    }

    const { id } = useParams();
    const prod = data.find(items => {
        return items.id === parseInt(id);
    })

    if (!prod) {
        return (
            <div className="center">
                <section className="text-section">
                    <h1 className="main-title">Error 404</h1>
                    <p className="subtitle">Page not found</p>
                </section>
            </div>
        )
    }

    const { imag, title, price } = prod;

    return (
        <>
            <Header />

            <section className="image-grid-section">
                <Card id={id} imag={prod.image} title={prod.title} price={prod.price} />
            </section>
        </>
    )
}

export default Product