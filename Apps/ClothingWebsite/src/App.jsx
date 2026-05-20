import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { useEffect } from 'react';
import './Style/App.css'

import Home from './Home';
import Product from './Product';
import Login from './Login';
import Regis from './Regis';
import Verification from './Verification';
import ForgotPassword from './ForgotPassword';
import ResetPassword from './ResetPassword';
import Favorites from './Favorites';
import Cart from './Cart';
import Checkout from './Checkout';
import OrderSuccess from './OrderSuccess';
import Orders from './Orders';
import Booking from './Booking';
import BookingSuccess from './BookingSuccess';
import { client } from "./api.js"
import { setShopCurrency } from "./currency.js"

function App() {
  useEffect(() => {
    // Track a site visit *per identity*, not per App mount. SPA
    // navigation keeps <App> mounted across login/logout, so a single
    // mount would only ever produce one `site_visits` row even though
    // `product_page_views` records each identity separately. That
    // mismatch made the Sales-funnel analytics show "1 visitor / 2
    // viewers" and clamp every step to 100%. Polling the SDK's cached
    // user (invalidated by `verifyCode`/`logout`) lets us fire a fresh
    // visit when the identity actually changes.
    let lastIdentity;
    const fire = async () => {
      await client.auth.getUser();
      const id = client.auth.user?.id ?? 'anon';
      if (id !== lastIdentity) {
        lastIdentity = id;
        client.track.visit();
      }
    };
    fire();
    const handle = setInterval(fire, 2000);
    // Bootstrap the storefront's currency from project config BEFORE
    // any price renders. The result is cached at module level by
    // `setShopCurrency`, so subsequent `fmtMoney()` calls anywhere in
    // the app pick up the merchant's chosen symbol immediately. Fails
    // open to USD if the request errors — better to ship the page
    // than block on a config fetch.
    client.config.get()
      .then(r => setShopCurrency(r?.data?.currency))
      .catch(() => {});
    return () => clearInterval(handle);
  }, []);

  return (
    <>
      <Router>
        <Routes>
          <Route path='/' element={<Home />} />
          <Route path='/product/:id' element={<Product />} />
          <Route path='/login' element={<Login />} />
          <Route path='/login/verification' element={<Verification />} />
          <Route path='/registration' element={<Regis />} />
          <Route path='/registration/verification' element={<Verification />} />
          <Route path='/forgot-password' element={<ForgotPassword />} />
          <Route path='/reset-password/:token' element={<ResetPassword />} />
          <Route path='/favorites' element={<Favorites />} />
          <Route path='/cart' element={<Cart />} />
          <Route path='/checkout' element={<Checkout />} />
          <Route path='/order-success' element={<OrderSuccess />} />
          <Route path='/orders' element={<Orders />} />
          <Route path='/booking' element={<Booking />} />
          <Route path='/booking/success' element={<BookingSuccess />} />
        </Routes>
      </Router>
    </>
  )
}

export default App
