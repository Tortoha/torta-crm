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
import { client } from "./api.js"

function App() {
  useEffect(() => {
    client.track.visit();
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
        </Routes>
      </Router>
    </>
  )
}

export default App
