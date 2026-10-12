import { describe, expect, it } from "vitest";
import { initials, isSamePerson } from "./photo-match";

const page = { title: "Nikhil Kamath", description: "Indian businessman and investor", extract: "Nikhil Kamath is an Indian businessman, co-founder of Zerodha and True Beacon.", thumbnail: "https://upload.wikimedia.org/x.jpg" };

describe("photo matching refuses to guess", () => {
  it("accepts the same name when the company agrees", () => {
    expect(isSamePerson({ name: "Nikhil Kamath", company: "Zerodha" }, page).ok).toBe(true);
  });
  it("accepts when the role agrees and no company is stored", () => {
    expect(isSamePerson({ name: "Nikhil Kamath", role: "Investor" }, page).ok).toBe(true);
  });
  it("rejects a namesake whose company is not on the page", () => {
    const r = isSamePerson({ name: "Nikhil Kamath", company: "Acme Plumbing" }, page);
    expect(r.ok).toBe(false);
    expect(r.why).toContain("not confirmed");
  });
  it("rejects when there is nothing to confirm against", () => {
    expect(isSamePerson({ name: "Nikhil Kamath" }, page).ok).toBe(false);
  });
  it("rejects a different person with a similar title", () => {
    expect(isSamePerson({ name: "Nikhil Gupta", company: "Zerodha" }, page).ok).toBe(false);
  });
  it("rejects disambiguation pages, missing images, and non-person pages", () => {
    expect(isSamePerson({ name: "Nikhil Kamath", company: "Zerodha" }, { ...page, disambiguation: true }).ok).toBe(false);
    expect(isSamePerson({ name: "Nikhil Kamath", company: "Zerodha" }, { ...page, thumbnail: undefined }).ok).toBe(false);
    expect(isSamePerson({ name: "Nikhil Kamath", company: "Zerodha" }, { ...page, description: "A village", extract: "Zerodha village in India" }).ok).toBe(false);
  });
  it("makes initials", () => {
    expect(initials("Rajeev Mantri")).toBe("RM");
    expect(initials("Cher")).toBe("C");
  });
});
