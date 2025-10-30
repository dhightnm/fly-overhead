/**
 * Maps aircraft type codes (ICAO type codes) to OpenSky category codes
 * Uses pattern matching on aircraft type/model strings to infer category
 * 
 * OpenSky Categories:
 * 0: Unknown
 * 1: Light (small GA)
 * 2: Small (small jets, turboprops)
 * 3: Large (most commercial jets)
 * 4: High vortex large (B757)
 * 5: Heavy (widebody jets)
 * 7: Rotorcraft (helicopters)
 * 8: Glider/sailplane
 * 9: Lighter-than-air (balloons, blimps)
 * 11: Ultralight/paraglider
 * 13: UAV/drone
 * 18: Military
 * 19: Military/Unknown
 */

const CATEGORY_PATTERNS = {
  // Category 1: Light aircraft (small GA) - Check BEFORE small jets
  light: [
    /^C1[0-9]{2}$/, // Cessna 150, 172, 182, etc.
    /^C172/i, // Cessna 172 (any case)
    /^C152/i, // Cessna 152
    /^C182/i, // Cessna 182
    /^C206/i, // Cessna 206
    /CESSNA/i, // Any Cessna aircraft
    /^PA2[0-9]$/, // Piper PA28
    /^PA1[68]$/, // Piper PA18, PA16
    /^BE[1-9][0-9]$/, // Beechcraft light aircraft (BE10-BE99, not BE00 series which are jets)
    /^MO20$/, // Mooney M20
    /^G[A-Z][0-9]{2}$/, // Various GA
    /^SR2[0-9]$/, // Cirrus SR20, SR22
  ],

  // Category 2: Small aircraft (small jets, large turboprops)
  small: [
    /^LJ[0-9]{2}$/, // Learjet
    /^CJ[0-9]$/, // Citation jets
    /^CL[0-9]{2}$/, // Challenger
    /^BE[0-9]{2}JET/i, // Beechcraft jets (if specified as jet)
    /^BE3[0-9]$/, // Beechcraft jet series (BE30, BE40, etc.)
    /^BE9[0-9]$/, // Beechcraft jet series (BE90, BE99)
    /^PC12$/, // Pilatus PC12
    /^TBM[0-9]{3}$/, // TBM turboprops
  ],

  // Category 3: Large aircraft (most commercial narrowbody)
  large: [
    /^B73[0-9]$/, // Boeing 737 (B737-B739, includes 737-900)
    /^B73[0-9]ER$/, // 737 variants with ER suffix
    /^B73[0-9]NG$/, // 737 Next Gen variants
    /^B73[0-9]MAX$/, // 737 MAX variants
    /^A319$/, // Airbus A319
    /^A320$/, // Airbus A320
    /^A321$/, // Airbus A321
    /^E190$/, // Embraer E190
    /^E195$/, // Embraer E195
    /^CRJ[0-9]$/, // CRJ regional jets
    /^MD8[0-9]$/, // MD80 series
    /^MD90$/, // MD90
    /^DC9$/, // DC9
  ],

  // Category 4: High vortex large (B757 only - very specific)
  highVortex: [
    /^B757$/, // Boeing 757 only (not B75X which could be other aircraft)
    /^B75[27]$/, // B757, B752 (757-200) variants only
  ],

  // Category 5: Heavy (widebody)
  heavy: [
    /^B777$/, // Boeing 777
    /^B787$/, // Boeing 787
    /^B747$/, // Boeing 747
    /^B767$/, // Boeing 767
    /^A330$/, // Airbus A330
    /^A340$/, // Airbus A340
    /^A350$/, // Airbus A350
    /^A380$/, // Airbus A380
    /^A30[0-9]$/, // A300, A310
    /^MD11$/, // MD11
    /^DC10$/, // DC10
  ],

  // Category 7: Rotorcraft
  helicopter: [
    /^H[0-9]{2}$/, // H60, H47, etc.
    /helicopter/i,
    /rotorcraft/i,
    /^AS[0-9]{3}$/, // Airbus helicopters
    /^EC[0-9]{3}$/, // Eurocopter
    /^BK[0-9]{3}$/, // Bell
    /^R44$/, // Robinson R44
    /^R66$/, // Robinson R66
  ],

  // Category 8: Glider
  glider: [
    /glider/i,
    /sailplane/i,
  ],

  // Category 9: Lighter-than-air
  lighterThanAir: [
    /balloon/i,
    /blimp/i,
    /airship/i,
  ],

  // Category 11: Ultralight
  ultralight: [
    /ultralight/i,
    /paraglider/i,
    /hang.?glider/i,
  ],

  // Category 13: UAV/Drone - Only match if explicitly drone/UAV, not if string contains it
  uav: [
    /^DRONE/i, // Starts with "drone"
    /^UAV/i, // Starts with "uav"
    /^RPA/i, // Starts with "rpa"
    /\bDRONE\b/i, // Word boundary for "drone"
    /\bUAV\b/i, // Word boundary for "uav"
    /\bRPA\b/i, // Word boundary for "rpa"
  ],

  // Category 18/19: Military
  military: [
    /^F[0-9]{2}$/, // F16, F18, F22, F35
    /^A10$/, // A10
    /^C130$/, // C130
    /^KC[0-9]{3}$/, // KC135, KC10
    /^E[A-Z][0-9]$/, // E2C, E3A
    /^P3[A-Z]$/, // P3C
    /military/i,
  ],
};

const CATEGORY_MAP = {
  light: 1,
  small: 2,
  large: 3,
  highVortex: 4,
  heavy: 5,
  helicopter: 7,
  glider: 8,
  lighterThanAir: 9,
  ultralight: 11,
  uav: 13,
  military: 18, // Use 18 for military, fallback to 19 if uncertain
};

/**
 * Maps aircraft type/model string to OpenSky category
 * @param {string|null|undefined} aircraftType - ICAO type code (e.g., "B738", "A320")
 * @param {string|null|undefined} aircraftModel - Model name (e.g., "Boeing 737-800")
 * @returns {number|null} - OpenSky category code (0-19) or null if cannot determine
 */
function mapAircraftTypeToCategory(aircraftType, aircraftModel) {
  if (!aircraftType && !aircraftModel) {
    return null;
  }

  // Normalize inputs
  const type = (aircraftType || '').toUpperCase().trim();
  const model = (aircraftModel || '').toUpperCase().trim();
  const combined = `${type} ${model}`.trim();

  // Check each category pattern in order of specificity
  // More specific patterns first, then general ones
  // Check for light GA aircraft BEFORE UAV patterns (to avoid misclassifying Cessnas)
  const checkOrder = ['heavy', 'highVortex', 'large', 'light', 'small', 'helicopter', 'glider', 'lighterThanAir', 'ultralight', 'military', 'uav'];

  for (const categoryKey of checkOrder) {
    const patterns = CATEGORY_PATTERNS[categoryKey];
    if (!patterns) continue;

    for (const pattern of patterns) {
      if (pattern.test(type) || pattern.test(model) || pattern.test(combined)) {
        return CATEGORY_MAP[categoryKey];
      }
    }
  }

  // If no match found, return null (unknown)
  return null;
}

module.exports = {
  mapAircraftTypeToCategory,
};

