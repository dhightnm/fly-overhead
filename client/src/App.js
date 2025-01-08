import './App.css';
import React from 'react';
import {BrowserRouter, Switch, Route} from 'react-router-dom';
import Home from './components/Home';
import NavBar from './components/NavBar';
import { PlaneProvider } from './contexts/PlaneContext';


const App = () => {
  return (
    <PlaneProvider>
      <div className="App">
        <NavBar />
        <BrowserRouter>
          <Switch>
            <Route exact path="/">
              <Home/>
            </Route>
          </Switch>
        
        </BrowserRouter>
      </div>
    </PlaneProvider>
  );
}

export default App;
