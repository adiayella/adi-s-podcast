import { describe, expect, it } from "vitest";
import { addDays, generatedBeforeWeekEnded, istClock, istWeekStart, reportWeekStart, weekRange } from "./weeks";

describe("IST week boundaries", () => {
  it("07:00 IST on Monday (01:30 UTC) reports the week that just ended", () => {
    const monday7am = new Date("2026-10-12T01:30:00Z");
    expect(istClock(monday7am)).toMatchObject({ weekday: 1, hour: 7, minute: 0 });
    expect(istWeekStart(monday7am)).toBe("2026-10-12");
    expect(reportWeekStart(monday7am)).toBe("2026-10-05");
  });

  it("Sunday 23:59 IST still belongs to the week that is not yet complete", () => {
    const sundayNight = new Date("2026-10-11T18:29:00Z"); // 23:59 IST Sunday
    expect(istWeekStart(sundayNight)).toBe("2026-10-05");
    expect(reportWeekStart(sundayNight)).toBe("2026-09-28");
  });

  it("Sunday 18:30 UTC is already Monday in India", () => {
    const monday = new Date("2026-10-11T18:30:00Z"); // 00:00 IST Monday
    expect(istWeekStart(monday)).toBe("2026-10-12");
    expect(reportWeekStart(monday)).toBe("2026-10-05");
  });

  it("the UTC date and the IST date differ before 05:30 IST", () => {
    const early = new Date("2026-10-12T00:10:00Z"); // 05:40 IST Monday, still Monday in UTC
    expect(istWeekStart(early)).toBe("2026-10-12");
    const late = new Date("2026-10-11T23:30:00Z"); // 05:00 IST Monday, still Sunday in UTC
    expect(istWeekStart(late)).toBe("2026-10-12");
  });

  it("a week range runs Monday 00:00 IST to the next Monday 00:00 IST, exclusive", () => {
    const { from, to } = weekRange("2026-10-05");
    expect(from.toISOString()).toBe("2026-10-04T18:30:00.000Z");
    expect(to.toISOString()).toBe("2026-10-11T18:30:00.000Z");
    expect(new Date("2026-10-11T18:29:59Z") < to).toBe(true); // last second of Sunday IST is inside
    expect(new Date("2026-10-11T18:30:00Z") < to).toBe(false); // first second of Monday IST is outside
  });

  it("crosses month and year ends", () => {
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(reportWeekStart(new Date("2027-01-04T01:30:00Z"))).toBe("2026-12-28");
  });
});

describe("premature briefs", () => {
  it("flags a brief generated before its week ended (the 12 Oct row that would have blocked 19 Oct)", () => {
    expect(generatedBeforeWeekEnded(new Date("2026-10-12T01:57:57Z"), "2026-10-12")).toBe(true);
  });
  it("accepts a brief generated after its week ended", () => {
    // week 5-11 Oct IST ends Monday 12 Oct 00:00 IST = 11 Oct 18:30 UTC
    expect(generatedBeforeWeekEnded(new Date("2026-10-12T15:04:20Z"), "2026-10-05")).toBe(false);
    expect(generatedBeforeWeekEnded(new Date("2026-10-11T18:30:00Z"), "2026-10-05")).toBe(false);
    expect(generatedBeforeWeekEnded(new Date("2026-10-11T18:29:59Z"), "2026-10-05")).toBe(true);
  });
  it("treats a missing generation time as not premature", () => {
    expect(generatedBeforeWeekEnded(null, "2026-10-05")).toBe(false);
  });
});
