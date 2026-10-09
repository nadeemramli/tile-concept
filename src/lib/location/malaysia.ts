import postcodeData from "./malaysia-postcodes.json";

// MCMC / data.gov.my, CC BY 4.0. Snapshot and normalization details are
// recorded in malaysia-postcodes.source.json alongside the bundled data.
const postcodes: Record<string, Record<string, string[]>> = postcodeData;
export const MALAYSIA_STATES = Object.keys(postcodes);

export function malaysiaCities(state: string): string[] {
  return Object.hasOwn(postcodes, state) ? Object.keys(postcodes[state]) : [];
}

export function malaysiaPostcodes(state: string, city: string): readonly string[] {
  if (!Object.hasOwn(postcodes, state) || !Object.hasOwn(postcodes[state], city)) return [];
  return postcodes[state][city];
}

export type MalaysiaArea = {
  state: string;
  city: string;
  postcode: string;
  locality: string;
  manual: boolean;
  manualArea: string;
};

export const EMPTY_MALAYSIA_AREA: MalaysiaArea = {
  state: "", city: "", postcode: "", locality: "", manual: false, manualArea: "",
};

/** The existing walk-in field stores a readable area, not a full street address. */
export function formatMalaysiaArea(area: MalaysiaArea): string {
  if (area.manual) return area.manualArea.trim();
  if (!MALAYSIA_STATES.includes(area.state)) return "";
  const city = malaysiaCities(area.state).includes(area.city) ? area.city : "";
  const postcode = malaysiaPostcodes(area.state, city).includes(area.postcode) ? area.postcode : "";
  return [city ? area.locality.trim() : "", [postcode, city].filter(Boolean).join(" "), area.state]
    .filter(Boolean).join(", ");
}
