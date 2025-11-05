// API configuration
// Use environment variable REACT_APP_API_URL if set, otherwise default to localhost
// For VPN access, set REACT_APP_API_URL=http://192.168.58.15:3005 in your .env file
export const API_URL: string = process.env.REACT_APP_API_URL || 'http://localhost:3005';

