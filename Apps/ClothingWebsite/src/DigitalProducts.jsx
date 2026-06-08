import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "./Style/App.css";
import "./Style/Header.css";
import "./Style/Digital.css";
import Header from "./Header";
import CartButton from "./CartButton";
import { client } from "./api.js";
import { fmtMoney } from "./currency.js";

// Human filename from a download URL (last path segment, decoded). The ZIP bundle
// lands as "_bundle.zip" — relabel it so the button reads nicely.
function fileLabel(url) {
  try {
    const name = decodeURIComponent(new URL(url).pathname).split("/").pop() || "download";
    return name === "_bundle.zip" ? "Download ZIP" : name;
  } catch {
    return "download";
  }
}

function DigitalProducts() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading]   = useState(true);
  // hash -> "loading" | [{ label, url }]
  const [downloads, setDownloads] = useState({});

  useEffect(() => {
    let alive = true;
    client.products.list()
      .then(({ ok, data }) => {
        if (!alive) return;
        setProducts(ok ? (data || []).filter(p => (p.product_type || "physical") === "digital") : []);
        setLoading(false);
      })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // Pull the real download links for one product (one ZIP when the merchant turned on
  // single-archive delivery, otherwise a link per file).
  const loadDownloads = async (hash) => {
    setDownloads(d => ({ ...d, [hash]: "loading" }));
    const { ok, data } = await client.products.get(hash);
    setDownloads(d => ({ ...d, [hash]: (ok && Array.isArray(data?.downloads)) ? data.downloads : [] }));
  };

  return (
    <>
      <Header />

      <section className="text-section">
        <h1 className="main-title">Digital Goods</h1>
        <p className="subtitle">
          Instant downloads — files are emailed after purchase.<br />
          Use “Get files” to test the download right here.
        </p>
      </section>

      {loading ? (
        <p className="dg-state">Loading…</p>
      ) : products.length === 0 ? (
        <p className="dg-state">No digital products yet.</p>
      ) : (
        <section className="image-grid-section">
          {products.map(p => {
            const dl = downloads[p.hash];
            return (
              <div key={p.id} className="card-gruop dg-card">
                <Link to={`/product/${p.hash}`} className="card dg-cover">
                  <img src={p.image} alt="" className="card-image" />
                </Link>
                <h3>{p.title}</h3>
                <h2 className="card-price">{fmtMoney(p.price, { decimals: 0 })}</h2>

                {dl === "loading" ? (
                  <p className="dg-hint">Loading…</p>
                ) : Array.isArray(dl) ? (
                  dl.length ? (
                    <div className="dg-links">
                      {dl.map((f, i) => (
                        <a key={i} className="dg-dl-link" href={f.url}
                          target="_blank" rel="noopener noreferrer" download>
                          ⬇ {fileLabel(f.url)}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="dg-hint">No files attached to this product.</p>
                  )
                ) : (
                  <button className="dg-dl-btn" type="button" onClick={() => loadDownloads(p.hash)}>
                    Get files
                  </button>
                )}
              </div>
            );
          })}
        </section>
      )}

      <CartButton />
    </>
  );
}

export default DigitalProducts;
