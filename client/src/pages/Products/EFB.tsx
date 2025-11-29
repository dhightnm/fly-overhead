import React from 'react';
import './Products.css';

const EFB: React.FC = () => {
  return (
    <div className="product-page">
      <div className="product-hero">
        <div className="product-hero-content">
          <h1 className="product-title">EFB</h1>
          <p className="product-subtitle">
            Electronic Flight Bag with advanced features and AI-powered assistance
          </p>
        </div>
      </div>
      <div className="product-content">
        <div className="product-section">
          <h2>Features</h2>
          <ul className="product-features">
            <li>Flight planning and route optimization</li>
            <li>Weather integration and radar</li>
            <li>IFR/VFR charts</li>
            <li>Terrain and traffic awareness</li>
            <li>Flight logbook</li>
            <li>RightSeat AI Copilot (Beta) - Coming Soon</li>
          </ul>
        </div>
        <div className="product-section">
          <h2>RightSeat AI Copilot</h2>
          <p>
            Our AI-powered RightSeat copilot provides real-time flight assistance, 
            automated checklists, and intelligent flight management. This feature 
            is currently in beta and available in our Professional and Enterprise EFB tiers.
          </p>
        </div>
        <div className="product-section">
          <h2>Pricing</h2>
          <p>View our <a href="/pricing/efb">EFB pricing</a> for detailed plans and features.</p>
        </div>
      </div>
    </div>
  );
};

export default EFB;

