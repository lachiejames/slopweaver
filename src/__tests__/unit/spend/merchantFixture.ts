/**
 * A card-merchant register for the spend tests: the two merchants the export and reminder fixtures charge, as an
 * install would register them with `spend merchants set`. A test's register, never a list the code ships.
 */
import type { SpendMerchant } from "../../../spend/merchants/core.js";

/** The register every spend test that groups the fixtures' charges reads them against. */
export const FIXTURE_MERCHANTS: readonly SpendMerchant[] = [
  { prefixes: ["anthropic"], receiptDomains: ["anthropic.com"], slug: "anthropic" },
  { prefixes: ["chatgpt", "open ai", "openai"], receiptDomains: ["openai.com"], slug: "openai" },
];
