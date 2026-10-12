import { describe, expect, it } from "vitest";
import { decideBrand, decideGuest, nameKey } from "./match";

describe("guest resolution", () => {
  const known = [
    { id: 1, aliases: ["Saurabh Mukherjea"], company: "Marcellus Investment Managers" },
    { id: 2, aliases: ["Abhijit Iyer-Mitra"], company: "" },
  ];

  it("ignores honorifics and punctuation for exact matches", () => {
    expect(nameKey("Dr. Saurabh  Mukherjea")).toBe("saurabh mukherjea");
    expect(decideGuest("Dr Saurabh Mukherjea", "", known)).toEqual({ kind: "exact", id: 1 });
  });

  it("merges a clear partial match when the company does not conflict", () => {
    expect(decideGuest("Abhijit Mitra", "", known)).toEqual({ kind: "merge", id: 2 });
  });

  it("does not merge when the companies conflict", () => {
    const people = [{ id: 7, aliases: ["Rahul Sharma"], company: "Zomato" }];
    expect(decideGuest("Rahul K Sharma", "Swiggy", people)).toEqual({ kind: "new" });
  });

  it("flags ambiguity instead of guessing", () => {
    const people = [
      { id: 1, aliases: ["Rahul Sharma"], company: "" },
      { id: 2, aliases: ["Rahul Kumar Sharma"], company: "" },
    ];
    expect(decideGuest("Rahul K Sharma", "", people)).toEqual({ kind: "ambiguous", ids: [1, 2] });
  });

  it("never merges on a single first name", () => {
    expect(decideGuest("Saurabh", "", known)).toEqual({ kind: "new" });
  });

  it("keeps different people with a shared surname apart", () => {
    expect(decideGuest("Anil Mukherjea", "", known)).toEqual({ kind: "new" });
  });
});

describe("brand resolution", () => {
  const known = [{ id: 1, aliases: ["ASUS"] }];

  it("merges a product line into its brand", () => {
    expect(decideBrand("ASUS ExpertBook P Series", known)).toEqual({ kind: "merge", id: 1 });
  });

  it("matches case-insensitively", () => {
    expect(decideBrand("asus", known)).toEqual({ kind: "exact", id: 1 });
  });

  it("does not merge unrelated brands", () => {
    expect(decideBrand("Porter", known)).toEqual({ kind: "new" });
  });

  it("flags a prefix that fits several brands", () => {
    const brands = [{ id: 1, aliases: ["Apple Music"] }, { id: 2, aliases: ["Apple Pay"] }];
    expect(decideBrand("Apple", brands)).toEqual({ kind: "ambiguous", ids: [1, 2] });
  });
});

describe("regressions", () => {
  it("a stray initial from a job title never merges into a real person", () => {
    const known = [{ id: 1, aliases: ["Satinder Sartaaj"], company: "" }];
    expect(decideGuest("India's IT Secretary", "", known)).toEqual({ kind: "new" });
  });

  it("an initial must match a different token than a full name", () => {
    const known = [{ id: 1, aliases: ["Sam Smith"], company: "" }];
    expect(decideGuest("S S", "", known)).toEqual({ kind: "new" });
  });
});
