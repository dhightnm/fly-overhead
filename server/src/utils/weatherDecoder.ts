import type { METARData, TAFData } from '../repositories/WeatherRepository';

export interface DecodedMETAR {
  temperature: string;
  dewpoint: string;
  wind: string;
  visibility: string;
  altimeter: string;
  clouds: string[];
  flightCategoryLabel: string | null;
  summary: string;
}

export interface DecodedTAF {
  validPeriod: string;
  summary: string;
}

function formatSignedTemperature(value?: number | null): string {
  if (value === null || value === undefined) {
    return 'N/A';
  }
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value}°C`;
}

function formatWind(dir?: number | null, speed?: number | null, gust?: number | null): string {
  if (!dir && !speed) {
    return 'Calm';
  }
  const direction = dir !== null && dir !== undefined ? `${dir.toString().padStart(3, '0')}°` : 'VRB';
  const baseSpeed = speed ?? 0;
  const gustPart = gust ? ` G${gust}` : '';
  return `${direction} ${baseSpeed}${gustPart} kt`;
}

function formatVisibility(mi?: number | null): string {
  if (mi === null || mi === undefined) {
    return 'N/A';
  }
  const rounded = Number.isFinite(mi) ? mi.toFixed(1) : `${mi}`;
  return `${rounded} mi`;
}

function formatAltimeter(inHg?: number | null): string {
  if (inHg === null || inHg === undefined) {
    return 'N/A';
  }
  const rounded = Number.isFinite(inHg) ? inHg.toFixed(2) : `${inHg}`;
  return `${rounded} inHg`;
}

function describeCloudCover(cover?: string | null): string | null {
  if (!cover) return null;
  const upper = cover.toUpperCase();
  switch (upper) {
    case 'FEW':
      return 'Few';
    case 'SCT':
      return 'Scattered';
    case 'BKN':
      return 'Broken';
    case 'OVC':
      return 'Overcast';
    case 'VV':
      return 'Vertical visibility';
    default:
      return upper;
  }
}

function formatCloudLayers(skyCondition?: any[] | null): string[] {
  if (!Array.isArray(skyCondition) || skyCondition.length === 0) {
    return [];
  }

  return skyCondition
    .map((layer) => {
      const coverLabel = describeCloudCover(layer?.cover);
      if (!coverLabel) {
        return null;
      }
      const baseHundreds = typeof layer?.base === 'number' ? layer.base : null;
      const baseFeet = baseHundreds !== null && Number.isFinite(baseHundreds) ? baseHundreds * 100 : null;

      if (baseFeet !== null) {
        return `${coverLabel} at ${baseFeet.toLocaleString()} ft`;
      }
      return coverLabel;
    })
    .filter((s): s is string => !!s);
}

function describeFlightCategory(category?: string | null): string | null {
  if (!category) return null;
  const upper = category.toUpperCase();
  switch (upper) {
    case 'VFR':
      return 'VFR – Visual Flight Rules';
    case 'MVFR':
      return 'MVFR – Marginal VFR';
    case 'IFR':
      return 'IFR – Instrument Flight Rules';
    case 'LIFR':
      return 'LIFR – Low IFR';
    default:
      return upper;
  }
}

function parseNumericFromRawMetar(raw: string) {
  const text = raw || '';

  // Wind: 20015G21KT or VRB03KT
  let windDir: number | null = null;
  let windSpeed: number | null = null;
  let windGust: number | null = null;
  const windMatch = text.match(/(^|\s)(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?KT/);
  if (windMatch) {
    const dirToken = windMatch[2];
    windDir = dirToken === 'VRB' ? null : Number.parseInt(dirToken, 10);
    windSpeed = Number.parseInt(windMatch[3], 10);
    if (windMatch[5]) {
      windGust = Number.parseInt(windMatch[5], 10);
    }
  }

  // Visibility: 10SM, 5SM, P6SM
  let visibilityMi: number | null = null;
  const visMatch = text.match(/(^|\s)(P)?(\d+)\s?SM/);
  if (visMatch) {
    const numeric = Number.parseInt(visMatch[3], 10);
    visibilityMi = Number.isFinite(numeric) ? numeric : null;
  }

  // Temperature/dewpoint: 05/M02, M05/M10, 10/08 etc.
  let tempC: number | null = null;
  let dewC: number | null = null;
  const tempMatch = text.match(/(^|\s)(M?\d{2})\/(M?\d{2})(\s|$)/);
  if (tempMatch) {
    const tempToken = tempMatch[2];
    const dewToken = tempMatch[3];
    const parseSigned = (token: string): number => {
      const negative = token.startsWith('M');
      const magnitude = Number.parseInt(negative ? token.slice(1) : token, 10);
      return negative ? -magnitude : magnitude;
    };
    tempC = parseSigned(tempToken);
    dewC = parseSigned(dewToken);
  }

  // Altimeter: A2996 -> 29.96 inHg
  let altimInHg: number | null = null;
  const altimMatch = text.match(/(^|\s)A(\d{4})(\s|$)/);
  if (altimMatch) {
    const val = Number.parseInt(altimMatch[2], 10);
    if (Number.isFinite(val)) {
      altimInHg = val / 100;
    }
  }

  // Cloud layers: SCT110 BKN180, FEW020, OVC008 etc.
  const cloudLayers: { cover: string; base: number | null }[] = [];
  const tokens = text.split(/\s+/);
  const cloudPrefixes = new Set(['FEW', 'SCT', 'BKN', 'OVC', 'VV']);
  tokens.forEach((token) => {
    if (token.length < 6) return;
    const cover = token.slice(0, 3).toUpperCase();
    if (!cloudPrefixes.has(cover)) return;
    const baseStr = token.slice(3, 6);
    const base = Number.parseInt(baseStr, 10);
    cloudLayers.push({
      cover,
      base: Number.isFinite(base) ? base : null,
    });
  });

  return {
    windDir,
    windSpeed,
    windGust,
    visibilityMi,
    tempC,
    dewC,
    altimInHg,
    cloudLayers,
  };
}

export function decodeMETAR(metar: METARData | null): DecodedMETAR | null {
  if (!metar) {
    return null;
  }

  const rawText = metar.raw_text || '';
  const fallback = parseNumericFromRawMetar(rawText);

  const effectiveTempC = metar.temperature_c !== null && metar.temperature_c !== undefined
    ? metar.temperature_c
    : fallback.tempC;
  const effectiveDewC = metar.dewpoint_c !== null && metar.dewpoint_c !== undefined
    ? metar.dewpoint_c
    : fallback.dewC;
  const effectiveWindDir = metar.wind_dir_deg !== null && metar.wind_dir_deg !== undefined
    ? metar.wind_dir_deg
    : fallback.windDir;
  const effectiveWindSpeed = metar.wind_speed_kt !== null && metar.wind_speed_kt !== undefined
    ? metar.wind_speed_kt
    : fallback.windSpeed;
  const effectiveWindGust = metar.wind_gust_kt !== null && metar.wind_gust_kt !== undefined
    ? metar.wind_gust_kt
    : fallback.windGust;
  const effectiveVisibility = metar.visibility_statute_mi !== null && metar.visibility_statute_mi !== undefined
    ? metar.visibility_statute_mi
    : fallback.visibilityMi;
  const effectiveAltim = metar.altim_in_hg !== null && metar.altim_in_hg !== undefined
    ? metar.altim_in_hg
    : fallback.altimInHg;

  let effectiveSkyCondition = null as any[] | null;
  if (metar.sky_condition && Array.isArray(metar.sky_condition) && metar.sky_condition.length > 0) {
    effectiveSkyCondition = metar.sky_condition;
  } else if (fallback.cloudLayers.length) {
    effectiveSkyCondition = fallback.cloudLayers;
  }

  const temperature = formatSignedTemperature(effectiveTempC);
  const dewpoint = formatSignedTemperature(effectiveDewC);
  const wind = formatWind(effectiveWindDir, effectiveWindSpeed, effectiveWindGust);
  const visibility = formatVisibility(effectiveVisibility);
  const altimeter = formatAltimeter(effectiveAltim);
  const clouds = formatCloudLayers(effectiveSkyCondition ?? null);
  const flightCategoryLabel = describeFlightCategory(metar.flight_category ?? null);

  const summaryParts: string[] = [];
  if (temperature !== 'N/A') summaryParts.push(`Temp ${temperature}`);
  if (dewpoint !== 'N/A') summaryParts.push(`Dew ${dewpoint}`);
  if (wind !== 'Calm') summaryParts.push(`Wind ${wind}`);
  if (visibility !== 'N/A') summaryParts.push(`Vis ${visibility}`);
  if (altimeter !== 'N/A') summaryParts.push(`Alt ${altimeter}`);
  if (flightCategoryLabel) summaryParts.push(flightCategoryLabel);

  const summary = summaryParts.join(' • ');

  return {
    temperature,
    dewpoint,
    wind,
    visibility,
    altimeter,
    clouds,
    flightCategoryLabel,
    summary,
  };
}

export function decodeTAF(taf: TAFData | null): DecodedTAF | null {
  if (!taf) {
    return null;
  }

  const validFrom = taf.valid_time_from ? new Date(taf.valid_time_from) : null;
  const validTo = taf.valid_time_to ? new Date(taf.valid_time_to) : null;
  const validPeriod = validFrom && validTo
    ? `${validFrom.toISOString()} to ${validTo.toISOString()}`
    : 'Unknown validity period';

  // For now, use raw_text as the main descriptive summary.
  // This keeps the structure ready for more detailed decoding later.
  const summary = taf.raw_text || 'No TAF text available';

  return {
    validPeriod,
    summary,
  };
}
