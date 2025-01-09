import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import customSatIcon from '../assets/sat.png';
import L from 'leaflet';


const CUSTOM_ICON = L.icon({
    iconUrl: customSatIcon,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, 0],
});


const SatMarker = ({ sat }) => {

    return (
        <Marker position={[sat.satlat, sat.satlng, sat.satalt]} icon={CUSTOM_ICON}>
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