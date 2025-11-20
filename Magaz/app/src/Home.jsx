import "./Style/Login.css";
import './Style/App.css'
import './Style/Header.css'
import Header from './Header'
import Grid from './Grid'

function Home() {
  return (
    <>
      <Header />

      <section className="text-section">
        <h1 className="main-title">Invest in Pieces That Stand<br />the Test of Time</h1>
        <p className="subtitle">Premium Materials, Honest Prices — Luxury<br />You Can Actually Afford</p>
      </section>

      <Grid/>
    </>
  )
}

export default Home