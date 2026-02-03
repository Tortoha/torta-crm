import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';

import './Style/App.css'

import Home from './Home';
import Product from './Product';
import Login from './Login';
import Regis from './Regis';
import Verification from './Verification';
import Favorites from './Favorites';

function App() {
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
          <Route path='/favorites' element={<Favorites />} />
        </Routes>
      </Router>
    </>
  )
}

export default App
