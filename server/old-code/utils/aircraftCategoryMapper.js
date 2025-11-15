/**
 * Maps aircraft type codes (ICAO type codes) to OpenSky category codes, model names, and display types
 * Uses lookup table for common codes + pattern matching fallback
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

// Lookup table for common ICAO codes -> model names (fast O(1) lookup)
const ICAO_MODEL_LOOKUP = {
  // Boeing
  B738: '737-800',
  B737: '737-700',
  B739: '737-900',
  B736: '737-600',
  B735: '737-500',
  B734: '737-400',
  B733: '737-300',
  B732: '737-200',
  B77W: '777-300ER',
  B77L: '777-200LR',
  B772: '777-200',
  B773: '777-300',
  B788: '787-8',
  B789: '787-9',
  B78X: '787-10',
  B748: '747-8',
  B744: '747-400',
  B763: '767-300',
  B762: '767-200',
  B764: '767-400',
  B752: '757-200',
  B753: '757-300',
  B757: '757',
  // Airbus
  A319: 'A319',
  A320: 'A320',
  A321: 'A321',
  A332: 'A330-200',
  A333: 'A330-300',
  A339: 'A330-900',
  A343: 'A340-300',
  A346: 'A340-600',
  A350: 'A350',
  A359: 'A350-900',
  A35K: 'A350-1000',
  A380: 'A380',
  A388: 'A380-800',
  // Regional jets
  E190: 'E190',
  E195: 'E195',
  E170: 'E170',
  E175: 'E175',
  CRJ9: 'CRJ-900',
  CRJ7: 'CRJ-700',
  CRJ2: 'CRJ-200',
  // Cessna
  C172: 'C172',
  C152: 'C152',
  C182: 'C182',
  C206: 'C206',
  C208: 'C208',
  // Military
  F16: 'F-16',
  F18: 'F-18',
  F22: 'F-22',
  F35: 'F-35',
  A10: 'A-10',
  C130: 'C-130',
  // Helicopters
  R44: 'R44',
  R66: 'R66',
  H60: 'UH-60',
  H47: 'CH-47',
};

// Display type mapping (category -> user-friendly type name)
const DISPLAY_TYPE_MAP = {
  1: 'Plane', // Light
  2: 'Plane', // Small
  3: 'Plane', // Large
  4: 'Plane', // High vortex (B757)
  5: 'Heavy', // Heavy
  7: 'Helicopter', // Rotorcraft
  8: 'Glider', // Glider
  9: 'Balloon', // Lighter-than-air
  11: 'Ultralight', // Ultralight
  13: 'Drone', // UAV
  18: 'Military', // Military
  19: 'Military', // Military/Unknown
};

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
    /^B77[0-9LWX]$/, // Boeing 777 variants (B772, B773, B77W, B77L)
    /^B787$/, // Boeing 787
    /^B78[0-9X]$/, // Boeing 787 variants (B788, B789, B78X)
    /^B747$/, // Boeing 747
    /^B74[0-9]$/, // Boeing 747 variants (B744, B748)
    /^B767$/, // Boeing 767
    /^B76[0-9]$/, // Boeing 767 variants (B762, B763, B764) - MUST come before helicopter B[0-9]{2} pattern
    /^A330$/, // Airbus A330
    /^A33[0-9]$/, // Airbus A330 variants (A332, A333, A339)
    /^A340$/, // Airbus A340
    /^A34[0-9]$/, // Airbus A340 variants (A343, A346)
    /^A350$/, // Airbus A350
    /^A35[0-9K]$/, // Airbus A350 variants (A359, A35K)
    /^A380$/, // Airbus A380
    /^A38[0-9]$/, // Airbus A380 variants (A388)
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
    /^BK[0-9]{3}$/, // Bell (BK designation)
    // Bell helicopter patterns - must be more specific to avoid matching Boeing codes
    // Only match B0X, B1X (not B7X which is Boeing 767)
    /^B0[0-9]$/, // Bell (B06, B07, etc.) - but NOT B76, B77, B78 (Boeing)
    /^B1[0-9]$/, // Bell (B12, B13, etc.) - but NOT B73, B74, B75 (Boeing)
    /^B2[0-9]{2}$/, // Bell (B206, B212, etc.) - 3 digits
    /^B3[0-9]{2}$/, // Bell (B307, etc.) - 3 digits
    /^B4[0-9]{2}$/, // Bell (B407, B412, etc.) - 3 digits
    /^B5[0-9]{2}$/, // Bell (B505, etc.) - 3 digits
    /^R44$/, // Robinson R44
    /^R66$/, // Robinson R66
    /jetranger/i, // Bell JetRanger
    /longranger/i, // Bell LongRanger
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
 * Extract model name from ICAO code using lookup table or pattern matching
 * @param {string} icaoCode - ICAO type code (e.g., "B738", "A320")
 * @returns {string|null} - Model name (e.g., "737-800", "A320") or null
 */
function extractModelFromICAO(icaoCode) {
  if (!icaoCode) return null;

  const code = icaoCode.toUpperCase().trim();

  // Fast lookup for common codes
  if (ICAO_MODEL_LOOKUP[code]) {
    return ICAO_MODEL_LOOKUP[code];
  }

  // Pattern-based extraction for unknown codes
  // Boeing: B738 -> 737-800, B77W -> 777-300ER
  if (code.startsWith('B')) {
    if (code.startsWith('B73')) {
      const variant = code.slice(3);
      if (variant === '8') return '737-800';
      if (variant === '7') return '737-700';
      if (variant === '9') return '737-900';
      if (variant === '6') return '737-600';
      if (variant === '5') return '737-500';
      if (variant === '4') return '737-400';
      if (variant === '3') return '737-300';
      if (variant === '2') return '737-200';
      return '737';
    }
    if (code.startsWith('B77')) {
      const variant = code.slice(3);
      if (variant === 'W') return '777-300ER';
      if (variant === 'L') return '777-200LR';
      if (variant === '2') return '777-200';
      if (variant === '3') return '777-300';
      return '777';
    }
    if (code.startsWith('B78')) {
      const variant = code.slice(3);
      if (variant === '8') return '787-8';
      if (variant === '9') return '787-9';
      if (variant === 'X') return '787-10';
      return '787';
    }
    if (code.startsWith('B74')) {
      const variant = code.slice(3);
      if (variant === '8') return '747-8';
      if (variant === '4') return '747-400';
      return '747';
    }
    if (code.startsWith('B76')) {
      const variant = code.slice(3);
      if (variant === '3') return '767-300';
      if (variant === '2') return '767-200';
      if (variant === '4') return '767-400';
      return '767';
    }
    if (code.startsWith('B75')) {
      const variant = code.slice(3);
      if (variant === '2') return '757-200';
      if (variant === '3') return '757-300';
      if (variant === '7') return '757';
      return '757';
    }
  }

  // Airbus: A320 -> A320, A332 -> A330-200
  if (code.startsWith('A')) {
    if (code.startsWith('A3')) {
      if (code === 'A319') return 'A319';
      if (code === 'A320') return 'A320';
      if (code === 'A321') return 'A321';
      if (code.startsWith('A33')) {
        const variant = code.slice(3);
        if (variant === '2') return 'A330-200';
        if (variant === '3') return 'A330-300';
        if (variant === '9') return 'A330-900';
        return 'A330';
      }
      if (code.startsWith('A34')) {
        const variant = code.slice(3);
        if (variant === '3') return 'A340-300';
        if (variant === '6') return 'A340-600';
        return 'A340';
      }
      if (code.startsWith('A35')) {
        const variant = code.slice(3);
        if (variant === '0') return 'A350';
        if (variant === '9') return 'A350-900';
        if (variant === 'K') return 'A350-1000';
        return 'A350';
      }
      if (code.startsWith('A38')) {
        const variant = code.slice(3);
        if (variant === '0') return 'A380';
        if (variant === '8') return 'A380-800';
        return 'A380';
      }
    }
  }

  // Cessna: C172 -> C172
  if (code.startsWith('C1')) {
    if (code === 'C172') return 'C172';
    if (code === 'C152') return 'C152';
    if (code === 'C182') return 'C182';
    if (code === 'C206') return 'C206';
    if (code === 'C208') return 'C208';
  }

  // Return original code if we can't extract a better model name
  return code;
}

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

/**
 * Enhanced mapper that returns model, type, and category
 * @param {string|null|undefined} aircraftType - ICAO type code (e.g., "B738", "A320")
 * @param {string|null|undefined} aircraftModel - Model name (e.g., "Boeing 737-800")
 * @returns {{model: string|null, type: string|null, category: number|null}} - Aircraft info
 */
function mapAircraftType(aircraftType, aircraftModel) {
  // Determine category first
  const category = mapAircraftTypeToCategory(aircraftType, aircraftModel);

  // Extract model name
  let model = null;
  if (aircraftType) {
    model = extractModelFromICAO(aircraftType);
  } else if (aircraftModel) {
    // Use provided model if available, otherwise try to extract from it
    model = extractModelFromICAO(aircraftModel) || aircraftModel;
  }

  // Determine display type from category
  let type = null;
  if (category !== null && category !== undefined) {
    type = DISPLAY_TYPE_MAP[category] || 'Plane';
  }

  return {
    model: model || aircraftType || aircraftModel || null,
    type: type || null,
    category,
  };
}

module.exports = {
  mapAircraftTypeToCategory,
  mapAircraftType, // New enhanced function
};
