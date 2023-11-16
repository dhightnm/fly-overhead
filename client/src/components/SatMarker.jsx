import React from 'react';
import { Marker, Popup } from 'react-leaflet';

const SatMarker = ({ sat }) => {

    return (
        <Marker position={[sat.satlat, sat.satlng, sat.satalt]}>
            <Popup>
            {sat.satname} <br />
            {sat.satid} <br />
            {sat.launchDate} <br />
            {sat.satalt} <br />
            </Popup>
        </Marker>
    );
};

export default SatMarker;