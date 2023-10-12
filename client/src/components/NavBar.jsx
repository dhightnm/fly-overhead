import React, { useState, useContext } from 'react';
import { PlaneContext } from '../contexts/PlaneContext';
import axios from 'axios';
import './navbar.css';

const NavBar = () => {
    const [search, setSearch] = useState('');
    const { setSearchLatlng } = useContext(PlaneContext);

    const handleSearch = async (search) => {
        const res = await axios.get(`http://localhost:3001/api/planes/${search}`);
        const allPlanes = res.data.states;
    
        const foundPlane = allPlanes.find(plane => {
          return plane[0] === search;
        });
    
        if (foundPlane) {
          setSearchLatlng([foundPlane[6], foundPlane[5]]);
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