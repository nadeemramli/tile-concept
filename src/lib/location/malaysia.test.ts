import { describe, expect, it } from "vitest";
import { EMPTY_MALAYSIA_AREA, MALAYSIA_STATES, formatMalaysiaArea, malaysiaCities, malaysiaPostcodes } from "./malaysia";

describe("Malaysia postcode reference", () => {
  it("covers all states and federal territories, including East Malaysia", () => {
    expect(MALAYSIA_STATES).toHaveLength(16);
    expect(MALAYSIA_STATES).toEqual(expect.arrayContaining(["Sabah", "Sarawak", "W.P. Kuala Lumpur", "W.P. Labuan", "W.P. Putrajaya"]));
    expect(malaysiaCities("Sabah")).toContain("Kota Kinabalu");
    expect(malaysiaCities("Sarawak")).toContain("Kuching");
    expect(malaysiaCities("Selangor")).not.toContain("Kuching");
  });
  it("retains leading zeros and postcode-to-town ambiguity", () => {
    expect(malaysiaPostcodes("Perlis", "Kangar")).toContain("01000");
    expect(malaysiaPostcodes("Selangor", "Shah Alam")).toContain("40160");
    expect(malaysiaPostcodes("Selangor", "Sungai Buloh")).toContain("40160");
    expect(malaysiaPostcodes("Sarawak", "Batu Caves")).toEqual([]);
  });
  it("normalizes whitespace and duplicates without guessing locations", () => {
    for (const state of MALAYSIA_STATES) {
      expect(state).toBe(state.trim());
      for (const city of malaysiaCities(state)) {
        expect(city).toBe(city.trim());
        const codes = malaysiaPostcodes(state, city);
        expect(new Set(codes).size).toBe(codes.length);
        for (const code of codes) expect(code).toMatch(/^\d{5}$/);
      }
    }
    expect(malaysiaCities("__proto__")).toEqual([]);
    expect(malaysiaPostcodes("Selangor", "toString")).toEqual([]);
  });
  it("formats known details for the existing saved walk-in area field", () => {
    expect(formatMalaysiaArea(EMPTY_MALAYSIA_AREA)).toBe("");
    expect(formatMalaysiaArea({ ...EMPTY_MALAYSIA_AREA, state: "Selangor" })).toBe("Selangor");
    expect(formatMalaysiaArea({ ...EMPTY_MALAYSIA_AREA, state: "Selangor", city: "Batu Caves", postcode: "68100", locality: " Taman Sri Gombak " }))
      .toBe("Taman Sri Gombak, 68100 Batu Caves, Selangor");
  });
  it("does not serialize invalid state-town-postcode combinations", () => {
    expect(formatMalaysiaArea({ ...EMPTY_MALAYSIA_AREA, state: "Sarawak", city: "Batu Caves", postcode: "68100", locality: "Old locality" })).toBe("Sarawak");
    expect(formatMalaysiaArea({ ...EMPTY_MALAYSIA_AREA, state: "Selangor", city: "Batu Caves", postcode: "01000" })).toBe("Batu Caves, Selangor");
  });
  it("preserves manual areas without appending hidden preset values", () => {
    expect(formatMalaysiaArea({ ...EMPTY_MALAYSIA_AREA, manual: true, manualArea: " Customer supplied location ", state: "Selangor" }))
      .toBe("Customer supplied location");
  });
});
