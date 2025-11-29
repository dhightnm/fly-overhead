import React from 'react';
import './Products.css';

const API: React.FC = () => {
  return (
    <div className="product-page">
      <div className="product-hero">
        <div className="product-hero-content">
          <h1 className="product-title">API</h1>
          <p className="product-subtitle">
            Developer API for accessing real-time and historical flight data
          </p>
        </div>
      </div>
      <div className="product-content">
        <div className="product-section">
          <h2>Features</h2>
          <ul className="product-features">
            <li>RESTful API with comprehensive documentation</li>
            <li>Real-time aircraft data</li>
            <li>Historical flight records</li>
            <li>Webhook subscriptions</li>
            <li>Rate limit monitoring</li>
            <li>Priority access options</li>
          </ul>
        </div>
        <div className="product-section">
          <h2>Documentation</h2>
          <p>API documentation and examples coming soon.</p>
        </div>
        <div className="product-section">
          <h2>Pricing</h2>
          <p>View our <a href="/pricing/api">API pricing</a> for detailed plans, rate limits, and access levels.</p>
        </div>
      </div>
    </div>
  );
};

export default API;

