/**
 * Test script to verify route data format matches navaids table
 * Run with: node server/scripts/testRouteDataMatch.js
 */

require('dotenv').config();
const postgresRepository = require('../repositories/PostgresRepository');
const flightPlanRouteService = require('../services/FlightPlanRouteService');

async function testRouteDataMatching() {
  try {
    console.log('Testing route data matching with navaids table...\n');

    const sampleRoutesQuery = `
      SELECT route, callsign, icao24, departure_icao, arrival_icao
      FROM flight_routes_history
      WHERE route IS NOT NULL
        AND route != ''
        AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 10
    `;

    const samples = await postgresRepository.getDb().any(sampleRoutesQuery);

    if (samples.length === 0) {
      console.log('❌ No route data found in last 7 days');
      return;
    }

    console.log(`Found ${samples.length} sample routes\n`);

    let totalCodes = 0;
    let foundCodes = 0;
    const testResults = [];

    for (const sample of samples) {
      const waypointCodes = flightPlanRouteService.parseRouteString(sample.route);
      totalCodes += waypointCodes.length;

      console.log(`Testing: ${sample.callsign || sample.icao24}`);
      console.log(`  Route: ${sample.route}`);
      console.log(`  Parsed codes: ${waypointCodes.join(', ')}`);

      let found = 0;
      const lookupResults = [];

      for (const code of waypointCodes.slice(0, 10)) {
        const waypoint = await flightPlanRouteService.lookupWaypoint(code);
        if (waypoint) {
          found++;
          foundCodes++;
          lookupResults.push({ code, status: '✅', source: waypoint.source, name: waypoint.name });
        } else {
          lookupResults.push({ code, status: '❌', source: 'not found' });
        }
      }

      const successRate = waypointCodes.length > 0 
        ? ((found / Math.min(waypointCodes.length, 10)) * 100).toFixed(1)
        : '0';

      testResults.push({
        callsign: sample.callsign,
        route: sample.route,
        codes: waypointCodes.length,
        found,
        successRate: `${successRate}%`,
        lookups: lookupResults,
      });

      console.log(`  ✅ Found ${found}/${Math.min(waypointCodes.length, 10)} waypoints (${successRate}%)\n`);
    }

    const overallSuccess = totalCodes > 0 
      ? ((foundCodes / Math.min(totalCodes, samples.length * 10)) * 100).toFixed(1)
      : '0';

    console.log('\n=== SUMMARY ===');
    console.log(`Total waypoint codes tested: ${Math.min(totalCodes, samples.length * 10)}`);
    console.log(`Successfully matched: ${foundCodes}`);
    console.log(`Overall success rate: ${overallSuccess}%`);
    console.log(`\n✅ Route data format appears to be ${overallSuccess >= 50 ? 'COMPATIBLE' : 'PARTIALLY COMPATIBLE'} with navaids table`);

    const navaidsCount = await postgresRepository.getDb().one(
      'SELECT COUNT(*) as count FROM navaids WHERE latitude_deg IS NOT NULL'
    );
    console.log(`\nNavaids table has ${parseInt(navaidsCount.count, 10)} entries with coordinates`);

  } catch (error) {
    console.error('Error testing route data:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

testRouteDataMatching();

