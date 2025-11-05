import './App.css';
import React from 'react';
import {BrowserRouter, Switch, Route} from 'react-router-dom';
import Home from './pages/Home/Home';
import NavBar from './components/NavBar';
import { PlaneProvider } from './contexts/PlaneContext';
import { AuthProvider } from './contexts/AuthContext';

const App = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <PlaneProvider>
          <div className="App">
            <NavBar />
            <Switch>
              <Route exact path="/">
                <Home/>
              </Route>
            </Switch>
          </div>
        </PlaneProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
