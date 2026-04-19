import { Link } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { client } from "./api.js"

function Header() {
  const [username, setUsername] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const menuRef = useRef();

  useEffect(() => {
    client.auth.getUser().then(user => {
      if (user) setUsername(user.name);
    });
  }, []);

  const handleCloseMenu = () => {
    setMenuClosing(true);
    setTimeout(() => {
      setMenuOpen(false);
      setMenuClosing(false);
    }, 300);
  };

  useEffect(() => {
    function handleClick(e) {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target)) {
        handleCloseMenu();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const handleLogout = async () => {
    await client.auth.logout();
    setUsername(null);
    window.location.reload();
  };

  const truncateName = (name) => {
    if (name && name.length > 8) {
      return name.substring(0, 7) + "...";
    }
    return name;
  };

  return (
    <header>
      {username ? (
        <div className="header-container" ref={menuRef}>
          <div className="a" onClick={() => menuOpen ? handleCloseMenu() : setMenuOpen(true)}>
            <div className="head">
              <img src="https://cdn-icons-png.flaticon.com/512/266/266033.png" alt="" />
              <h5>{truncateName(username)}</h5>
            </div>
          </div>

          {menuOpen && (
            <div className={`menu ${menuClosing ? 'menu-closing' : ''}`}>
              <div className="menu-header" onClick={handleCloseMenu}>
                <div className="menu-head">
                  <img src="https://cdn-icons-png.flaticon.com/512/266/266033.png" alt="" />
                  <h5>{truncateName(username)}</h5>
                </div>
              </div>
              <Link to={"/"}>Home</Link>
              <Link to={"/cart"}>Cart</Link>
              <Link to={"/favorites"}>Favorites</Link>
              <Link to={"/history"}>History</Link>
              <button className="logout" onClick={handleLogout}>Sign Out</button>
            </div>
          )}
        </div>
      ) : (
        <Link to={"/login"}>
          <div className="head">
            <img src="https://cdn-icons-png.flaticon.com/512/266/266033.png" alt="" />
            <h5>Sign In</h5>
          </div>
        </Link>
      )}
    </header>
  )
}

export default Header
