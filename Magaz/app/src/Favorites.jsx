import "./Style/Favorites.css";
import './Style/App.css'
import './Style/Header.css'
import Header from './Header'
import FavoritesGrid from './FavoritesGrid'

function Favorites() {
  return (
    <>
      <Header />

      <section className="favorites-text-section">
        <h1 className="favorites-main-title">Your Favorites</h1>
      </section>

      <FavoritesGrid/>
    </>
  )
}

export default Favorites