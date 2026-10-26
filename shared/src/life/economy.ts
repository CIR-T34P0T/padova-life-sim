// Money helpers (D-023). Amounts are whole euro cents everywhere.

import { CAFE_MENU, type MenuItem } from "./config.ts";

export type TransactionDirection = "income" | "expense";
export type TransactionCategory = "allowance" | "purchase" | "refund" | "wage";

/** One ledger entry as shown to its owner. */
export interface TransactionView {
  id: string;
  direction: TransactionDirection;
  category: TransactionCategory;
  amountCents: number;
  balanceAfterCents: number;
  description: string;
  itemId: string | null;
  gameMinute: number;
  createdAt: string;
}

export function findMenuItem(id: string): MenuItem | null {
  return CAFE_MENU.find((item) => item.id === id) ?? null;
}

/** "€4.50"; negative amounts as "−€4.50". */
export function formatEuros(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}€${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export const canAfford = (balanceCents: number, priceCents: number): boolean =>
  Number.isInteger(balanceCents) && Number.isInteger(priceCents) && priceCents >= 0 && balanceCents >= priceCents;

/** Idempotency keys sent by clients: short, URL-safe, no spaces. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
export const isValidRequestId = (value: unknown): value is string => typeof value === "string" && REQUEST_ID_PATTERN.test(value);
