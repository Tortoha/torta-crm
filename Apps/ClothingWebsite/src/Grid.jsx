import { useEffect } from 'react'
import Card from './Card'
import { useState } from 'react'
import { client } from "./api.js"

function Grid() {
  const [data, setData] = useState([]);

  useEffect(() => {
    client.products.list().then(({ ok, data }) => {
      // Storefront shows only physical products; other types live on dedicated pages.
      if (ok) setData((data || []).filter(p => (p.product_type || 'physical') === 'physical'));
    }).catch(err => console.log(err));
  }, [])

  return (
    <>
      <section className="image-grid-section">
        {data.map((d) => (
          <Card key={d.id}
            id={d.hash}
            imag={d.image}
            title={d.title}
            price={d.price}
            compareAtPrice={d.compare_at_price}
            onSale={d.on_sale}
            discountPercent={d.discount_percent} />
        ))}
      </section>
    </>
  )
}

export default Grid
