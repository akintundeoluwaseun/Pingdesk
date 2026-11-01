export const CATEGORIES = [
  "buyer_message",
  "new_order",
  "order_update",
  "payment",
  "policy",
  "account_security",
  "general",
  "unclassified",
] as const;
export type AlertCategory = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<AlertCategory, string> = {
  buyer_message: "Buyer message",
  new_order: "New order",
  order_update: "Order update",
  payment: "Payment",
  policy: "Policy",
  account_security: "Account security",
  general: "General",
  unclassified: "Unclassified",
};
