import React, { useState, useContext } from 'react';
import { PlaneContext } from '../contexts/PlaneContext';
import axios from 'axios';
import './navbar.css';

const NavBar = () => {
    const [search, setSearch] = useState('');
    const { setSearchLatlng } = useContext(PlaneContext);

    const handleSearch = async () => {
      try {
        console.log("SEARCH", search);
        const res = await axios.get(`http://localhost:3001/api/planes/${search}`);
        console.log("API RESPONSE", res.data);
    
        const planeDetails = res.data;
        
        if (planeDetails && (planeDetails.icao24 === search || planeDetails.callsign === search)) {
          setSearchLatlng([planeDetails.latitude, planeDetails.longitude]);
          console.log("SEARCHLATLNG", [planeDetails.latitude, planeDetails.longitude]);
        }
      } catch (err) {
        console.log("Error in searching for planes", err);
      }
    };
    

    return <nav className='navbar'>
        <a href="/" className="site-title">Fly Overhead</a>
        <input type="text" placeholder="Search by ICAO address" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button onClick={handleSearch}>Search</button>
        <ul className="nav-links">
                <li><a href="/">Home</a></li>
                <li><a href="/about">About</a></li>
        </ul>
    </nav>  
}

export default NavBar;