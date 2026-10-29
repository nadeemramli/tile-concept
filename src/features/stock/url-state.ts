// nuqs/server: the parsers without the "use client" hooks, importable from both sides.
import { parseAsString, parseAsStringLiteral } from "nuqs/server";

/**
 * The Stock page is server-driven: page.tsx reads the tab, search and filters
 * from the URL and fetches the matching rows. Kept out of the "use client"
 * components so the server page can import the same list.
 */
export const STOCK_TABS = ["overview", "suppliers", "sql", "reconciliation"] as const;
export type StockTab = (typeof STOCK_TABS)[number];

export const parseStockTab = (value: string | undefined): StockTab => (STOCK_TABS as readonly string[]).includes(value ?? "") ? (value as StockTab) : "overview";

/** Overview filters the server applies in listAvailability(). */
export const stockFilterParsers = {
  q: parseAsString,
  category: parseAsString,
  brand: parseAsString,
  supplier: parseAsString,
  sourceKind: parseAsString,
  freshness: parseAsString,
  availability: parseAsString,
};
export type StockFilterKey = keyof typeof stockFilterParsers;

export const stockTabParser = parseAsStringLiteral(STOCK_TABS).withDefault("overview");
