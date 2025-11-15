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
        <h1 className="main-title">Random text then<br />replacement</h1>
        <p className="subtitle">Lorem ipsum dolor sit amet,<br />consectetur adipiscing elit.</p>
      </section>

      <Grid/>
    </>
  )
}

export default Home