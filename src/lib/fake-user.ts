// Fake user generator for QA form-fill.
// Produces a random name, birthday, phone, email, plus a real street address
// (real building, real house number, real postcode) pulled from OpenStreetMap
// via the Overpass API. No financial data.

export interface FakeAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
}

export interface FakeUser {
  firstName: string;
  lastName: string;
  fullName: string;
  birthday: string; // YYYY-MM-DD
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
}

interface CitySeed {
  lat: number;
  lon: number;
  city: string;
  country: string;
  countryCode: string; // ISO 3166-1 alpha-2
}

// Seed city centers around the world, tagged with country.
const CITY_SEEDS: ReadonlyArray<CitySeed> = [
  { lat: 52.520, lon: 13.405, city: 'Berlin', country: 'Germany', countryCode: 'DE' },
  { lat: 48.137, lon: 11.576, city: 'Munich', country: 'Germany', countryCode: 'DE' },
  { lat: 48.856, lon: 2.352, city: 'Paris', country: 'France', countryCode: 'FR' },
  { lat: 43.296, lon: 5.370, city: 'Marseille', country: 'France', countryCode: 'FR' },
  { lat: 51.507, lon: -0.128, city: 'London', country: 'United Kingdom', countryCode: 'GB' },
  { lat: 53.480, lon: -2.243, city: 'Manchester', country: 'United Kingdom', countryCode: 'GB' },
  { lat: 41.902, lon: 12.496, city: 'Rome', country: 'Italy', countryCode: 'IT' },
  { lat: 45.464, lon: 9.190, city: 'Milan', country: 'Italy', countryCode: 'IT' },
  { lat: 40.417, lon: -3.704, city: 'Madrid', country: 'Spain', countryCode: 'ES' },
  { lat: 41.385, lon: 2.173, city: 'Barcelona', country: 'Spain', countryCode: 'ES' },
  { lat: 52.370, lon: 4.895, city: 'Amsterdam', country: 'Netherlands', countryCode: 'NL' },
  { lat: 59.329, lon: 18.068, city: 'Stockholm', country: 'Sweden', countryCode: 'SE' },
  { lat: 57.708, lon: 11.974, city: 'Gothenburg', country: 'Sweden', countryCode: 'SE' },
  { lat: 60.170, lon: 24.938, city: 'Helsinki', country: 'Finland', countryCode: 'FI' },
  { lat: 55.676, lon: 12.568, city: 'Copenhagen', country: 'Denmark', countryCode: 'DK' },
  { lat: 48.208, lon: 16.372, city: 'Vienna', country: 'Austria', countryCode: 'AT' },
  { lat: 47.376, lon: 8.541, city: 'Zurich', country: 'Switzerland', countryCode: 'CH' },
  { lat: 50.075, lon: 14.437, city: 'Prague', country: 'Czechia', countryCode: 'CZ' },
  { lat: 52.229, lon: 21.012, city: 'Warsaw', country: 'Poland', countryCode: 'PL' },
  { lat: 44.426, lon: 26.102, city: 'Bucharest', country: 'Romania', countryCode: 'RO' },
  { lat: 53.349, lon: -6.260, city: 'Dublin', country: 'Ireland', countryCode: 'IE' },
  { lat: 38.722, lon: -9.139, city: 'Lisbon', country: 'Portugal', countryCode: 'PT' },
  { lat: 37.983, lon: 23.727, city: 'Athens', country: 'Greece', countryCode: 'GR' },
  { lat: 40.712, lon: -74.006, city: 'New York', country: 'United States', countryCode: 'US' },
  { lat: 34.052, lon: -118.243, city: 'Los Angeles', country: 'United States', countryCode: 'US' },
  { lat: 41.878, lon: -87.629, city: 'Chicago', country: 'United States', countryCode: 'US' },
  { lat: 37.774, lon: -122.419, city: 'San Francisco', country: 'United States', countryCode: 'US' },
  { lat: 29.760, lon: -95.369, city: 'Houston', country: 'United States', countryCode: 'US' },
  { lat: 43.651, lon: -79.347, city: 'Toronto', country: 'Canada', countryCode: 'CA' },
  { lat: 49.282, lon: -123.120, city: 'Vancouver', country: 'Canada', countryCode: 'CA' },
  { lat: 45.501, lon: -73.567, city: 'Montreal', country: 'Canada', countryCode: 'CA' },
  { lat: -23.550, lon: -46.633, city: 'São Paulo', country: 'Brazil', countryCode: 'BR' },
  { lat: -34.603, lon: -58.381, city: 'Buenos Aires', country: 'Argentina', countryCode: 'AR' },
  { lat: 19.432, lon: -99.133, city: 'Mexico City', country: 'Mexico', countryCode: 'MX' },
  { lat: 35.676, lon: 139.650, city: 'Tokyo', country: 'Japan', countryCode: 'JP' },
  { lat: 34.693, lon: 135.502, city: 'Osaka', country: 'Japan', countryCode: 'JP' },
  { lat: 37.566, lon: 126.977, city: 'Seoul', country: 'Korea', countryCode: 'KR' },
  { lat: 1.352, lon: 103.819, city: 'Singapore', country: 'Singapore', countryCode: 'SG' },
  { lat: 22.319, lon: 114.169, city: 'Hong Kong', country: 'Hong Kong', countryCode: 'HK' },
  { lat: -33.868, lon: 151.208, city: 'Sydney', country: 'Australia', countryCode: 'AU' },
  { lat: -37.813, lon: 144.963, city: 'Melbourne', country: 'Australia', countryCode: 'AU' },
  { lat: 25.204, lon: 55.270, city: 'Dubai', country: 'United Arab Emirates', countryCode: 'AE' },
  { lat: 13.756, lon: 100.501, city: 'Bangkok', country: 'Thailand', countryCode: 'TH' },
];

export interface CountryOption {
  country: string;
  countryCode: string;
}

// Countries exposed in the UI picker. "Any country" is represented by an
// empty value in the dropdown rather than appearing here.
export const SUPPORTED_COUNTRIES: ReadonlyArray<CountryOption> = [
  { country: 'Germany', countryCode: 'DE' },
  { country: 'Sweden', countryCode: 'SE' },
];

// ITU-T country calling codes for every country represented in CITY_SEEDS.
const DIALING_CODES: Record<string, string> = {
  DE: '49', FR: '33', GB: '44', IT: '39', ES: '34', NL: '31',
  SE: '46', FI: '358', DK: '45', AT: '43', CH: '41', CZ: '420',
  PL: '48', RO: '40', IE: '353', PT: '351', GR: '30',
  US: '1', CA: '1', BR: '55', AR: '54', MX: '52',
  JP: '81', KR: '82', SG: '65', HK: '852',
  AU: '61', AE: '971', TH: '66',
};

const FIRST_NAMES = [
  'Alex', 'Maria', 'John', 'Sofia', 'Lukas', 'Elena', 'Diego', 'Yuki',
  'Noah', 'Emma', 'Liam', 'Olivia', 'Aiden', 'Mia', 'Oliver', 'Chloe',
  'Hiroshi', 'Aya', 'Nina', 'Pablo', 'Ingrid', 'Omar', 'Fatima', 'Chen',
  'Wei', 'Priya', 'Arjun', 'Ananya', 'Kai', 'Leah', 'Ethan', 'Zoe',
  'Luca', 'Clara', 'Finn', 'Isla', 'Marco', 'Lena', 'Theo', 'Ava',
];

const LAST_NAMES = [
  'Smith', 'Garcia', 'Müller', 'Kowalski', 'Rossi', 'Nguyen', 'Tanaka',
  'Kim', 'Singh', 'Silva', 'Dubois', 'Jensen', 'Andersson', 'Novak',
  'Popescu', 'Cohen', 'Ali', 'Khan', 'Chen', 'Wang', 'Johnson', 'Brown',
  'Jones', 'Lopez', 'Hernandez', 'Martin', 'Schmidt', 'Bauer', 'Fischer',
  'Ivanov', 'Petrov', 'OConnor', 'Murphy', 'Lindqvist', 'Nakamura',
];

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function pick<T>(arr: ReadonlyArray<T>): T {
  return arr[rand(0, arr.length - 1)];
}

// Build a plausible-looking phone number whose country-calling-code matches
// the address's country. Local portion is just random digits — plausible
// enough to pass a "+CC …" regex but not asserting real national formats.
function phoneForCountry(countryCode: string): string {
  const cc = DIALING_CODES[countryCode] ?? String(rand(1, 99));
  return `+${cc} ${rand(100, 999)} ${rand(100, 999)} ${rand(1000, 9999)}`;
}

// A single OSM node with full street-address tags — i.e. a real mapped
// building we can quote verbatim: street, house number, postcode all present.
interface OverpassAddressNode {
  lat: number;
  lon: number;
  tags: {
    'addr:housenumber': string;
    'addr:street': string;
    'addr:postcode': string;
    'addr:city'?: string;
    'addr:suburb'?: string;
    'addr:state'?: string;
  };
}

// Public Overpass mirrors. The primary (.de) is often overloaded and returns
// an HTML "Dispatcher timeout" page even with HTTP 200, so we cycle through
// community mirrors when it fails.
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

// Cache of address nodes per seed city for the life of the module. Keeps
// repeated "Generate" clicks fast and easy on the public Overpass servers.
const addressCache = new Map<string, OverpassAddressNode[]>();

async function fetchOverpass(endpoint: string, body: string, signal: AbortSignal): Promise<OverpassAddressNode[]> {
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal,
  });
  const contentType = resp.headers.get('content-type') ?? '';
  const text = await resp.text();
  // Overpass commonly returns an HTML "Dispatcher timeout" page with HTTP 200
  // when the server is saturated; treat anything non-JSON as a failure so the
  // mirror race falls through to a healthier mirror.
  if (!resp.ok || !contentType.includes('json') || text.trimStart().startsWith('<')) {
    throw new Error(`${new URL(endpoint).host}: ${resp.status} non-JSON`);
  }
  const data = JSON.parse(text);
  return (data.elements ?? [])
    .filter((e: any) =>
      e?.type === 'node' &&
      typeof e.lat === 'number' &&
      typeof e.lon === 'number' &&
      e.tags?.['addr:housenumber'] &&
      e.tags?.['addr:street'] &&
      e.tags?.['addr:postcode']
    )
    .map((e: any) => ({ lat: e.lat, lon: e.lon, tags: e.tags }));
}

async function fetchAddressesForSeed(seed: CitySeed, radiusMeters: number): Promise<OverpassAddressNode[]> {
  const cacheKey = `${seed.countryCode}:${seed.city}:${radiusMeters}`;
  const cached = addressCache.get(cacheKey);
  if (cached) return cached;

  const query =
    `[out:json][timeout:10];` +
    `node["addr:housenumber"]["addr:street"]["addr:postcode"]` +
    `(around:${radiusMeters},${seed.lat},${seed.lon});` +
    `out tags 150;`;
  const body = `data=${encodeURIComponent(query)}`;

  // Race every mirror in parallel with a hard wall-clock timeout — first one
  // to return valid JSON wins, the rest are aborted. Prevents the extension
  // from hanging forever on a dead mirror.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const nodes = await Promise.any(
      OVERPASS_ENDPOINTS.map((ep) => fetchOverpass(ep, body, controller.signal))
    );
    addressCache.set(cacheKey, nodes);
    return nodes;
  } catch (e) {
    const msg = e instanceof AggregateError
      ? e.errors.map((x) => (x instanceof Error ? x.message : String(x))).join('; ')
      : String(e);
    throw new Error(`OpenStreetMap mirrors unavailable (${msg})`);
  } finally {
    controller.abort(); // cancel stragglers from the race
    clearTimeout(timer);
  }
}

async function pickRealAddress(seeds: ReadonlyArray<CitySeed>): Promise<FakeAddress> {
  // Shuffle so repeated calls hit different seeds. Network errors bubble up
  // immediately (no point retrying with another seed when the mirrors are
  // dead); only empty-result cases fall through to the next seed.
  const shuffled = [...seeds].sort(() => Math.random() - 0.5);
  for (let i = 0; i < Math.min(3, shuffled.length); i++) {
    const seed = shuffled[i];
    let nodes = await fetchAddressesForSeed(seed, 1500);
    if (nodes.length === 0) nodes = await fetchAddressesForSeed(seed, 3500);
    if (nodes.length === 0) continue;
    const node = pick(nodes);
    const t = node.tags;
    return {
      street: `${t['addr:street']} ${t['addr:housenumber']}`,
      city: t['addr:city'] || t['addr:suburb'] || seed.city,
      state: t['addr:state'] || '',
      zip: t['addr:postcode'],
      country: seed.country,
      countryCode: seed.countryCode,
      lat: node.lat,
      lon: node.lon,
    };
  }
  throw new Error('No real addresses found in the selected area');
}

export interface GenerateOptions {
  countryCode?: string; // ISO 3166-1 alpha-2; omit for "any"
}

export async function generateFakeUser(opts: GenerateOptions = {}): Promise<FakeUser> {
  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);

  const filteredSeeds = opts.countryCode
    ? CITY_SEEDS.filter((s) => s.countryCode === opts.countryCode)
    : CITY_SEEDS;
  if (filteredSeeds.length === 0) {
    throw new Error(`No seed cities for country ${opts.countryCode}`);
  }

  const address = await pickRealAddress(filteredSeeds);

  const bYear = rand(1960, 2004);
  const bMonth = rand(1, 12);
  const bDay = rand(1, 28);
  const birthday = `${bYear}-${pad(bMonth)}-${pad(bDay)}`;

  const phone = phoneForCountry(address.countryCode);

  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    birthday,
    phone,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${rand(1, 999)}@mailinator.com`,
    ...address,
  };
}
