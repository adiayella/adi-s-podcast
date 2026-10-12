import { describe, expect, it } from "vitest";
import { deliveryFromEvent, deliverySummary, isFinalDelivery } from "./delivery";

describe("delivery status from the provider event", () => {
  it("never calls a message delivered because it was merely sent or queued", () => {
    for (const e of ["sent", "queued", "scheduled", null, undefined, "something_new"]) expect(deliveryFromEvent(e)).toBe("unknown");
  });
  it("maps confirmed outcomes", () => {
    expect(deliveryFromEvent("delivered")).toBe("delivered");
    expect(deliveryFromEvent("opened")).toBe("delivered");
    expect(deliveryFromEvent("bounced")).toBe("bounced");
    expect(deliveryFromEvent("suppressed")).toBe("bounced");
    expect(deliveryFromEvent("delivery_delayed")).toBe("delayed");
    expect(deliveryFromEvent("complained")).toBe("complained");
    expect(deliveryFromEvent("failed")).toBe("failed");
  });
  it("keeps checking delayed and unknown, stops at final states", () => {
    expect(isFinalDelivery("delayed")).toBe(false);
    expect(isFinalDelivery("unknown")).toBe(false);
    expect(isFinalDelivery("delivered")).toBe(true);
    expect(isFinalDelivery("bounced")).toBe(true);
  });
  it("says plainly when delivery is unconfirmed", () => {
    expect(deliverySummary("unknown", "sent")).toContain("not confirmed");
  });
});
