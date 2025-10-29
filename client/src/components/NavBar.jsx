import React, { useState, useContext } from 'react';
import { PlaneContext } from '../contexts/PlaneContext';
import axios from 'axios';
import './navbar.css';

const NavBar = () => {
  const API_URL = "http://localhost:3005";

    const [search, setSearch] = useState('');
    const [searchStatus, setSearchStatus] = useState(null); // 'found', 'not-found', 'searching'
    const { setSearchLatlng } = useContext(PlaneContext);

    const handleSearch = async () => {
      if (!search.trim()) {
        setSearchStatus(null);
        return;
      }

      setSearchStatus('searching');
      
      try {
        const res = await axios.get(`${API_URL}/api/planes/${encodeURIComponent(search.trim())}`);
    
        const planeDetails = res.data;
        
        if (planeDetails && planeDetails.latitude && planeDetails.longitude) {
          setSearchLatlng([planeDetails.latitude, planeDetails.longitude]);
          setSearchStatus('found');
          
          // Clear status after 3 seconds
          setTimeout(() => setSearchStatus(null), 3000);
        } else {
          setSearchStatus('not-found');
          setTimeout(() => setSearchStatus(null), 3000);
        }
      } catch (err) {
        console.error("Error searching for aircraft:", err);
        setSearchStatus('not-found');
        setTimeout(() => setSearchStatus(null), 3000);
      }
    };

    const handleKeyPress = (e) => {
      if (e.key === 'Enter') {
        handleSearch();
      }
    };

    const getStatusIcon = () => {
      switch (searchStatus) {
        case 'searching':
          return '🔍';
        case 'found':
          return '✅';
        case 'not-found':
          return '❌';
        default:
          return '';
      }
    };
    

    return <nav className='navbar'>
        <a href="/" className="site-title">Fly Overhead</a>
        <div className="search-container">
          <input 
            type="text" 
            placeholder="Search by ICAO24 or Callsign" 
            value={search} 
            onChange={(e) => setSearch(e.target.value)}
            onKeyPress={handleKeyPress}
          />
          <button onClick={handleSearch}>
            {getStatusIcon()} Search
          </button>
          {searchStatus === 'not-found' && (
            <span className="search-error">Aircraft not found</span>
          )}
        </div>
        <ul className="nav-links">
                <li><a href="/">Home</a></li>
                <li><a href="/about">About</a></li>
        </ul>
    </nav>  
}

export default NavBar;
