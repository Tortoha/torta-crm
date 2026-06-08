import { Link } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { client } from "./api.js";
import SupportWidget from "./Elements/SupportWidget";

function Header() {
  const [username, setUsername]         = useState(null);
  const [menuOpen, setMenuOpen]         = useState(false);
  const [menuClosing, setMenuClosing]   = useState(false);
  const [supportEnabled, setSupportEnabled] = useState(false);
  const [supportOpen, setSupportOpen]   = useState(false);
  const menuRef = useRef();

  useEffect(() => {
    client.auth.getUser().then(user => {
      if (user) setUsername(user.name);
    });
  }, []);

  // Check whether Web Chat is enabled for this project.
  useEffect(() => {
    client.chat.bootstrap().then(res => {
      setSupportEnabled(!!res.data?.enabled);
    }).catch(() => {});
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
    if (name && name.length > 8) return name.substring(0, 7) + "...";
    return name;
  };

  const handleSupportClick = () => {
    handleCloseMenu();
    setSupportOpen(true);
  };

  return (
    <>
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
                <Link to={"/booking"}>Book a service</Link>
                <Link to={"/cart"}>Cart</Link>
                <Link to={"/favorites"}>Favorites</Link>
                <Link to={"/orders"}>My Orders</Link>
                <Link to={"/digital"}>Digital Goods</Link>
                {supportEnabled && (
                  <button className="support-menu-btn" onClick={handleSupportClick} type="button">
                    Support
                  </button>
                )}
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

      {supportEnabled && (
        <SupportWidget
          isOpen={supportOpen}
          onClose={() => setSupportOpen(false)}
        />
      )}
    </>
  );
}

export default Header;
