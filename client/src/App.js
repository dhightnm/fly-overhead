import './App.css';
import React from 'react';
import {BrowserRouter, Switch, Route} from 'react-router-dom';
import Home from './components/Home';

const App = () => {
  return (
    <div className="App">
      <BrowserRouter>
        <Switch>
          <Route exact path="">
            <Home />
          </Route>
        </Switch>
      
      </BrowserRouter>
    </div>
  );
}

export default App;
