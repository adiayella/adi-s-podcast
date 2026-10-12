// What the email provider (Resend) says happened to a message, kept apart from "we handed it over".
export type DeliveryStatus = "unknown" | "delivered" | "delayed" | "bounced" | "complained" | "failed";

/**
 * Maps Resend's `last_event` to our delivery status. "sent" and "queued" only mean the provider has the message,
 * so they stay `unknown`: we never call a message delivered until the provider says so.
 */
export function deliveryFromEvent(event: string | null | undefined): DeliveryStatus {
  switch (event) {
    case "delivered":
    case "opened": // can only follow a delivery
    case "clicked":
      return "delivered";
    case "delivery_delayed":
      return "delayed";
    case "bounced":
    case "suppressed": // the provider refused to send to this address
      return "bounced";
    case "complained":
      return "complained";
    case "failed":
    case "canceled":
      return "failed";
    default:
      return "unknown";
  }
}

/** Final states never change; "delayed" and "unknown" should be checked again. */
export const isFinalDelivery = (s: DeliveryStatus) => s === "delivered" || s === "bounced" || s === "complained" || s === "failed";

export function deliverySummary(s: DeliveryStatus, event: string | null): string {
  switch (s) {
    case "delivered":
      return "Delivered: the provider confirms the recipient's mail server accepted it";
    case "delayed":
      return "Delayed: the provider is retrying (check again later)";
    case "bounced":
      return `Not delivered: ${event === "suppressed" ? "the address is on the provider's suppression list" : "the recipient's server rejected it"}`;
    case "complained":
      return "Delivered, then marked as spam by the recipient";
    case "failed":
      return "Failed at the provider";
    default:
      return event ? `Accepted by the provider (${event}); delivery not confirmed yet` : "Delivery not confirmed yet";
  }
}
