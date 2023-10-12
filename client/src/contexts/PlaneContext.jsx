import React, { createContext, useState } from 'react';

export const PlaneContext = createContext();

export const PlaneProvider = ({ children }) => {
    const [searchLatlng, setSearchLatlng] = useState(null);

    return (
        <PlaneContext.Provider value={{ searchLatlng, setSearchLatlng }}>
            {children}
        </PlaneContext.Provider>
    );
};