import "./App.css";
import React from "react";
import { BrowserRouter, Switch, Route } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import Home from "./pages/Home/Home";
import Portal from "./pages/Portal/Portal";
import NavBar from "./components/NavBar";
import { PlaneProvider } from "./contexts/PlaneContext";
import { AuthProvider } from "./contexts/AuthContext";

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";

const AppContent = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <PlaneProvider>
          <div className="App">
            <NavBar />
            <Switch>
              <Route exact path="/">
                <Home />
              </Route>
              <Route path="/portal">
                <Portal />
              </Route>
            </Switch>
          </div>
        </PlaneProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

const App = () => {
  // Always provide GoogleOAuthProvider, even with empty string
  // This prevents errors in components that use Google OAuth hooks
  // Components will handle the missing client ID gracefully
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID || "dummy-client-id"}>
      <AppContent />
    </GoogleOAuthProvider>
  );
};

export default App;
