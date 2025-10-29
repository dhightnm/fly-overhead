import './App.css';
import React from 'react';
import {BrowserRouter, Switch, Route} from 'react-router-dom';
import Home from './components/Home';
import NavBar from './components/NavBar';
import { PlaneProvider } from './contexts/PlaneContext';


const App = () => {
  return (
    <BrowserRouter>
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
    </BrowserRouter>
  );
}

export default App;
