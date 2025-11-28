import { Link } from "react-router-dom";
import { useState, useEffect, useRef } from "react";

function Header() {
  const [username, setUsername] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const menuRef = useRef();

  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setUsername(data.name); })
      .catch(() => {});
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
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    setUsername(null);
    window.location.reload();
  };

  return (
    <header>
      {username ? (
        <div className="user-header-container" ref={menuRef}>
          <div className="a" onClick={() => menuOpen ? handleCloseMenu() : setMenuOpen(true)}>
            <div className="head">
              <img src="https://cdn-icons-png.flaticon.com/512/266/266033.png" alt="" />
              <h5>{username}</h5>
            </div>
          </div>

          {menuOpen && (
            <div className={`menu ${menuClosing ? 'menu-closing' : ''}`}>
              <div className="menu-header" onClick={handleCloseMenu}>
                <div className="menu-head">
                  <img src="https://cdn-icons-png.flaticon.com/512/266/266033.png" alt="" />
                  <h5>{username}</h5>
                </div>
              </div>
              <Link to={"/"}>Settings</Link>
              <button className="logout" onClick={handleLogout}>Sing Out</button>
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