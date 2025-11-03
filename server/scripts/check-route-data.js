const postgresRepository = require('../repositories/PostgresRepository');

async function checkRouteData() {
  const icao24 = 'a1f595';
  const callsign = 'SWA9004';

  console.log(`\n=== Checking routes for ${icao24} / ${callsign} ===\n`);

  try {
    const db = postgresRepository.getDb();

    // Get all recent routes
    const query = `
      SELECT 
        id,
        icao24,
        callsign,
        departure_icao,
        arrival_icao,
        route,
        created_at,
        actual_flight_start,
        actual_flight_end,
        first_seen,
        last_seen
      FROM flight_routes_history
      WHERE icao24 = $1
         OR callsign = $2
      ORDER BY created_at DESC, actual_flight_start DESC
      LIMIT 20
    `;

    const rows = await db.any(query, [icao24, callsign]);

    console.log(`Found ${rows.length} recent routes:\n`);

    rows.forEach((row, idx) => {
      console.log(`${idx + 1}. Route ID: ${row.id}`);
      console.log(`   Callsign: ${row.callsign}`);
      console.log(`   ICAO24: ${row.icao24}`);
      console.log(`   Departure: ${row.departure_icao}`);
      console.log(`   Arrival: ${row.arrival_icao}`);
      console.log(`   Route: ${row.route ? (row.route.length > 80 ? row.route.substring(0, 80) + '...' : row.route) : 'NULL'}`);
      console.log(`   Created: ${row.created_at}`);
      console.log(`   Flight Start: ${row.actual_flight_start}`);
      console.log(`   Flight End: ${row.actual_flight_end}`);
      console.log(`   First Seen: ${row.first_seen}`);
      console.log(`   Last Seen: ${row.last_seen}`);
      console.log('');
    });

    // Check what the current query would return
    console.log('\n=== What current query would return ===\n');
    const currentQuery = `
      SELECT route, callsign, icao24, 
             departure_icao, arrival_icao,
             created_at, actual_flight_start
      FROM flight_routes_history
      WHERE ($1::text IS NULL OR icao24 = $1)
        AND ($2::text IS NULL OR callsign = $2)
        AND route IS NOT NULL
        AND route != ''
      ORDER BY created_at DESC, actual_flight_start DESC
      LIMIT 1
    `;

    const currentRow = await db.oneOrNone(currentQuery, [icao24, callsign]);
    
    if (currentRow) {
      console.log('Currently selected route:');
      console.log(`  Departure: ${currentRow.departure_icao}`);
      console.log(`  Arrival: ${currentRow.arrival_icao}`);
      console.log(`  Route: ${currentRow.route}`);
      console.log(`  Created: ${currentRow.created_at}`);
      console.log(`  Flight Start: ${currentRow.actual_flight_start}`);
    } else {
      console.log('No route found with current query');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkRouteData();

