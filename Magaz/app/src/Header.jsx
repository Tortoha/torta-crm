import { Link } from "react-router-dom"
import { useState, useEffect } from "react"

function Header() {
  const [username, setUsername] = useState(null)

  useEffect(() => {
    fetch("/api/me", {
      credentials: "include"
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) setUsername(data.name)
      })
      .catch(() => {})
  }, [])

  return (
    <header>
      {username ? (
        <div className="head">
          <img src="https://cdn-icons-png.flaticon.com/512/266/266033.png" alt="" />
          <h5>{username}</h5>
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