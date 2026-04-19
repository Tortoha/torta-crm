import { useEffect } from 'react'
import Card from './Card'
import { useState } from 'react'
import { client } from "./api.js"

function Grid() {
  const [data, setData] = useState([]);

  useEffect(() => {
    client.products.list().then(({ ok, data }) => {
      if (ok) setData(data);
    }).catch(err => console.log(err));
  }, [])

  return (
    <>
      <section className="image-grid-section">
        {data.map((d) => (
          <Card key={d.id} id={d.hash} imag={d.image} title={d.title} price={d.price} />
        ))}
      </section>
    </>
  )
}

export default Grid
