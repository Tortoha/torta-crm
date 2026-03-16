import { useEffect } from 'react'
import Card from './Card'
import { useState } from 'react'
import { API_BASE } from "./api.js"

function Grid() {
  const [data, setData] = useState([]);

  useEffect(() => {
    fetch(`${API_BASE}/api-products`)
      .then(res => res.json())
      .then(data => setData(data))
      .catch(err => console.log(err))
  }, [])

  return (
    <>
      <section className="image-grid-section">
        {data.map((d) => (
          <Card key={d.id} id={d.id} imag={d.image} title={d.title} price={d.price} />
        ))}
      </section>
    </>
  )
}

export default Grid