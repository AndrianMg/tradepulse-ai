/**
 * Romford Postcode Utility (RM1–RM7)
 * 
 * Coverage District Mapping:
 * RM1 - Romford Town Centre, Rom Valley Way
 * RM2 - Gidea Park, Heath Park
 * RM3 - Harold Wood, Harold Hill, Noak Hill
 * RM4 - Havering-atte-Bower, Stapleford Abbotts, Navestock
 * RM5 - Collier Row
 * RM6 - Chadwell Heath, Marks Gate, Little Heath
 * RM7 - Rush Green, Mawneys
 */

export interface PostcodeValidationResult {
  rawInput: string;
  normalizedPostcode: string;
  outwardCode: string | null;
  isInCoverage: boolean;
  areaDescription: string;
}

// Allowed Romford coverage districts
export const ALLOWED_ROMFORD_DISTRICTS = ['RM1', 'RM2', 'RM3', 'RM4', 'RM5', 'RM6', 'RM7'] as const;
export type RomfordDistrict = (typeof ALLOWED_ROMFORD_DISTRICTS)[number];

const DISTRICT_NAMES: Record<RomfordDistrict, string> = {
  RM1: 'Romford Town Centre',
  RM2: 'Gidea Park / Heath Park',
  RM3: 'Harold Wood / Harold Hill',
  RM4: 'Havering-atte-Bower / Rural Fringe',
  RM5: 'Collier Row',
  RM6: 'Chadwell Heath / Marks Gate',
  RM7: 'Rush Green / Mawneys',
};

// Common locality name fallbacks when speech transcription captures names instead of alphanumeric codes
const LOCALITY_TO_DISTRICT_MAP: Record<string, RomfordDistrict> = {
  'romford': 'RM1',
  'gidea park': 'RM2',
  'heath park': 'RM2',
  'harold wood': 'RM3',
  'harold hill': 'RM3',
  'noak hill': 'RM3',
  'havering-atte-bower': 'RM4',
  'havering atte bower': 'RM4',
  'stapleford abbotts': 'RM4',
  'collier row': 'RM5',
  'chadwell heath': 'RM6',
  'marks gate': 'RM6',
  'little heath': 'RM6',
  'rush green': 'RM7',
  'mawneys': 'RM7',
};

/**
 * Sanitizes and extracts Romford postcode information from conversational text
 */
export function validateRomfordPostcode(input: string | null | undefined): PostcodeValidationResult {
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return {
      rawInput: '',
      normalizedPostcode: 'UNSPECIFIED',
      outwardCode: null,
      isInCoverage: false,
      areaDescription: 'Postcode not captured',
    };
  }

  const rawTrimmed = input.trim();

  // 1. Normalize voice transcription quirks (e.g., "are em one", "R M 1", "rm 1")
  let cleaned = rawTrimmed
    .toUpperCase()
    .replace(/\bARE\s+EM\b/g, 'RM')
    .replace(/\bR\s+M\b/g, 'RM')
    .replace(/\bONE\b/g, '1')
    .replace(/\bTWO\b/g, '2')
    .replace(/\bTHREE\b/g, '3')
    .replace(/\bFOUR\b/g, '4')
    .replace(/\bFIVE\b/g, '5')
    .replace(/\bSIX\b/g, '6')
    .replace(/\bSEVEN\b/g, '7')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bRM\s+([0-9])/g, 'RM$1')
    .trim();

  // 2. Full UK postcode regex match (e.g., "RM1 3BL" or "RM7 0AA")
  const fullPostcodeRegex = /\b(RM\s*[1-7])\s*([0-9][A-Z]{2})\b/i;
  const fullMatch = cleaned.match(fullPostcodeRegex);

  if (fullMatch) {
    const outward = fullMatch[1].replace(/\s+/g, '').toUpperCase() as RomfordDistrict;
    const inward = fullMatch[2].toUpperCase();
    const formatted = `${outward} ${inward}`;

    return {
      rawInput: rawTrimmed,
      normalizedPostcode: formatted,
      outwardCode: outward,
      isInCoverage: true,
      areaDescription: DISTRICT_NAMES[outward] || 'Romford Coverage Area',
    };
  }

  // 3. Outward district code only match (e.g., "RM1", "RM 5", "RM 3")
  const outwardOnlyRegex = /\b(RM\s*[1-7])\b/i;
  const outwardMatch = cleaned.match(outwardOnlyRegex);

  if (outwardMatch) {
    const outward = outwardMatch[1].replace(/\s+/g, '').toUpperCase() as RomfordDistrict;
    return {
      rawInput: rawTrimmed,
      normalizedPostcode: outward,
      outwardCode: outward,
      isInCoverage: true,
      areaDescription: DISTRICT_NAMES[outward] || 'Romford Coverage Area',
    };
  }

  // 4. Locality Name Fallback match
  const lowerInput = rawTrimmed.toLowerCase();
  for (const [locality, district] of Object.entries(LOCALITY_TO_DISTRICT_MAP)) {
    if (lowerInput.includes(locality)) {
      return {
        rawInput: rawTrimmed,
        normalizedPostcode: district,
        outwardCode: district,
        isInCoverage: true,
        areaDescription: `${locality.toUpperCase()} (${DISTRICT_NAMES[district]})`,
      };
    }
  }

  // 5. Out of area postcode match (e.g., RM8, RM11, RM12, IG11, E17, CM14)
  const anyPostcodeRegex = /\b([A-Z]{1,2}[0-9][A-Z0-9]?)\s*([0-9][A-Z]{2})?\b/i;
  const anyMatch = cleaned.match(anyPostcodeRegex);

  if (anyMatch) {
    const outOfAreaCode = anyMatch[0].trim();
    return {
      rawInput: rawTrimmed,
      normalizedPostcode: outOfAreaCode,
      outwardCode: anyMatch[1].toUpperCase(),
      isInCoverage: false,
      areaDescription: 'Out of Coverage Area (Non-RM1-RM7)',
    };
  }

  // 6. Unparseable fallback
  return {
    rawInput: rawTrimmed,
    normalizedPostcode: rawTrimmed.slice(0, 10).toUpperCase(),
    outwardCode: null,
    isInCoverage: false,
    areaDescription: 'Unconfirmed Postcode',
  };
}
