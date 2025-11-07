import './App.css';
import React from 'react';
import {BrowserRouter, Switch, Route} from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import Home from './pages/Home/Home';
import NavBar from './components/NavBar';
import { PlaneProvider } from './contexts/PlaneContext';
import { AuthProvider } from './contexts/AuthContext';

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || '';

const App = () => {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
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
    </GoogleOAuthProvider>
  );
}

export default App;
