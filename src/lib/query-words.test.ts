import { describe, expect, it } from "vitest";
import { queryWords } from "@/lib/query-words";

describe("search query words", () => {
  it("drops filler words and stems plurals", () => {
    expect(queryWords("sports startups in India")).toEqual(["sport", "startup"]);
    expect(queryWords("What is quick commerce?")).toEqual(["quick", "commerce"]);
  });

  it("keeps words like 'business' intact", () => {
    expect(queryWords("business")).toEqual(["business"]);
  });

  it("ignores very short words and caps the count", () => {
    expect(queryWords("ai")).toEqual([]);
    expect(queryWords("one two three four five six seven eight").length).toBe(6);
  });
});
