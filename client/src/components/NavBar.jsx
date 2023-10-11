import React, { useState } from 'react';
import './navbar.css';

const NavBar = () => {
    const [search, setSearch] = useState('');
    const handleSearch = (search) => {
        console.log(search);
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