import { Link } from "react-router-dom"

function Header() {
  return (
    <>
      <header>
        <Link to={"/login"}>
          <div className="head">
            <img src="https://cdn-icons-png.flaticon.com/512/266/266033.png" alt="" />
            <h5>Sign In</h5>
          </div>
        </Link>
      </header>
    </>
  )
}

export default Header