import React from 'react';
import './Products.css';

const FlightTracking: React.FC = () => {
  return (
    <div className="product-page">
      <div className="product-hero">
        <div className="product-hero-content">
          <h1 className="product-title">Flight Tracking</h1>
          <p className="product-subtitle">
            Real-time aircraft tracking and comprehensive flight data
          </p>
        </div>
      </div>
      <div className="product-content">
        <div className="product-section">
          <h2>Features</h2>
          <ul className="product-features">
            <li>Real-time aircraft position tracking</li>
            <li>Historical flight data</li>
            <li>Advanced search and filtering</li>
            <li>Interactive map visualization</li>
            <li>Flight route analysis</li>
          </ul>
        </div>
        <div className="product-section">
          <h2>Pricing</h2>
          <p>View our <a href="/pricing/flight-tracking">flight tracking pricing</a> for detailed plans and features.</p>
        </div>
      </div>
    </div>
  );
};

export default FlightTracking;

