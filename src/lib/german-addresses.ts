// German address source: a static bundle of ~440 real, verified addresses
// extracted from OpenStreetMap (via Overpass) across Berlin and München.
//
// Why a bundle and not a live query: public Overpass mirrors are unreliable
// for a synchronous user click — mixed 406s, timeouts, and rate-limits make
// the UX worse than the problem justifies. The underlying address data is
// effectively static (streets and house numbers don't change), so we do
// the network I/O once at build-time and serve from bundled JSON at runtime.
//
// Intended for staging form-fill only: each entry is a real building.

import type { FakeAddress } from './fake-user.js';
import bundledAddresses from '../data/german-addresses.json';

interface BundledAddress {
  street: string;
  housenumber: string;
  postcode: string;
  city: string;
  state: string;
}

const ADDRESSES: ReadonlyArray<BundledAddress> = bundledAddresses as BundledAddress[];

export function pickGermanAddress(): FakeAddress {
  const a = ADDRESSES[Math.floor(Math.random() * ADDRESSES.length)];
  return {
    street: `${a.street} ${a.housenumber}`,
    city: a.city,
    state: a.state,
    zip: a.postcode,
    country: 'Germany',
    countryCode: 'DE',
    // The bundle doesn't carry coordinates (autofill payloads don't use
    // them) — emit zeros to satisfy the FakeAddress shape.
    lat: 0,
    lon: 0,
  };
}
