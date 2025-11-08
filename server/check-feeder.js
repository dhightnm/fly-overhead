const pgp = require('pg-promise')();
const db = pgp(process.env.POSTGRES_URL || 'postgresql://postgres:postgres@192.168.58.15:5433/fly_overhead');

async function checkFeeder() {
  const feederId = 'feeder_775269c27df2f108d156fe14';
  
  try {
    // Check if feeder exists
    const feeder = await db.oneOrNone(
      'SELECT feeder_id, name, status, last_seen_at, created_at FROM feeders WHERE feeder_id = $1',
      [feederId]
    );
    
    if (feeder) {
      console.log('\n✅ Feeder found in database:');
      console.log(JSON.stringify(feeder, null, 2));
    } else {
      console.log('\n❌ Feeder not found in database');
    }
    
    // Check aircraft data
    const stats = await db.one(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN data_source = 'feeder' THEN 1 END) as from_feeder,
        COUNT(CASE WHEN feeder_id = $1 THEN 1 END) as from_this_feeder,
        MAX(last_contact) as max_last_contact,
        MIN(last_contact) as min_last_contact
      FROM aircraft_states
    `, [feederId]);
    
    console.log('\n📊 Aircraft States Summary:');
    console.log(`Total aircraft: ${stats.total}`);
    console.log(`From all feeders: ${stats.from_feeder}`);
    console.log(`From ${feederId}: ${stats.from_this_feeder}`);
    if (stats.max_last_contact) {
      const maxTime = new Date(stats.max_last_contact * 1000);
      const minTime = new Date(stats.min_last_contact * 1000);
      const now = new Date();
      const secondsAgo = Math.floor((now - maxTime) / 1000);
      console.log(`Most recent contact: ${maxTime.toISOString()} (${secondsAgo} seconds ago)`);
      console.log(`Oldest contact: ${minTime.toISOString()}`);
    }
    
    // Get recent aircraft from this feeder
    const recent = await db.any(`
      SELECT icao24, callsign, latitude, longitude, baro_altitude, last_contact, ingestion_timestamp, data_source, source_priority
      FROM aircraft_states
      WHERE feeder_id = $1
      ORDER BY ingestion_timestamp DESC NULLS LAST, last_contact DESC
      LIMIT 10
    `, [feederId]);
    
    // Check ingestion timestamps
    const ingestionStats = await db.one(`
      SELECT 
        MAX(ingestion_timestamp) as max_ingestion,
        MIN(ingestion_timestamp) as min_ingestion,
        COUNT(CASE WHEN ingestion_timestamp > NOW() - INTERVAL '5 minutes' THEN 1 END) as recent_5min
      FROM aircraft_states
      WHERE feeder_id = $1
    `, [feederId]);
    
    console.log('\n⏰ Ingestion Timestamps:');
    if (ingestionStats.max_ingestion) {
      const maxIng = new Date(ingestionStats.max_ingestion);
      const now = new Date();
      const diff = Math.floor((now - maxIng) / 1000);
      console.log(`Latest ingestion: ${maxIng.toISOString()} (${diff} seconds ago)`);
      console.log(`Records ingested in last 5 minutes: ${ingestionStats.recent_5min}`);
    } else {
      console.log('No ingestion timestamps found');
    }
    
    if (recent.length > 0) {
      console.log(`\n✈️  Recent aircraft from this feeder (${recent.length} shown):`);
      recent.forEach((ac, i) => {
        const time = new Date(ac.last_contact * 1000);
        console.log(`  ${i + 1}. ${ac.icao24} (${ac.callsign || 'N/A'}) - ${time.toISOString()}`);
      });
    } else {
      console.log('\n⚠️  No aircraft data found from this feeder yet');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await db.$pool.end();
    process.exit(0);
  }
}

checkFeeder();

