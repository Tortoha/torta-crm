import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';

import Home from './Home';
import Product from './Product';
import Login from './Login';
import Regis from './Regis';

function App() {
  return (
    <>
      <Router>
        <Routes>
          <Route path='/' element={<Home />} />
          <Route path='/product/:id' element={<Product />} />
          <Route path='/login' element={<Login />} />
          <Route path='/registration' element={<Regis />} />
        </Routes>
      </Router>
    </>
  )
}

export default App
