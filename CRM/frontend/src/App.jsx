import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import './Style/App.css'

import Home from './Home.jsx';

function App() {
  return (
    <>
      <Router>
        <Routes>
          <Route path='/' element={<Home />} />
        </Routes>
      </Router>
    </>
  )
}

export default App
