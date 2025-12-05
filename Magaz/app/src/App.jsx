import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';

import Home from './Home';
import Product from './Product';
import Login from './Login';
import Regis from './Regis';
import Verification from './Verification';

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
        </Routes>
      </Router>
    </>
  )
}

export default App
