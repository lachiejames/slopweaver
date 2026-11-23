/**
 * Loading a Codex rate card off disk — the effectful half of `./pricing.ts`.
 *
 * Kept separate for the ordinary reason and one specific one: the card's VALIDATION is where the interesting
 * rules live (a mapping nobody verified, a period that does not cover the pass, a model with no rate), and
 * those belong in a pure function a fixture can exercise. This file only turns a path into bytes.
 *
 * There is no default path and no bundled card, deliberately. A rate card is installation configuration —
 * "tools in the codebase, state outside it" — so it is named on the command line with `--rates <path>`, and
 * a `codex usage` run without one reports token counts and says, in as many words, that it was given no
 * card to price them with.
 */

import { readFileSync } from "node:fs";
import { err, type Result } from "#lib/result.js";
import { safeFs } from "#lib/safeBoundary.js";
import { type CodexRateCard, parseCodexRateCard } from "./pricing.js";
import { type CodexPricingError, CodexPricingErrors } from "./pricingErrors.js";

/**
 * Read and validate a rate card.
 *
 * The two failures are separate variants of {@link CodexPricingError} — `RATE_CARD_UNREADABLE` names the
 * path, `RATE_CARD_INVALID` names the fields — and both carry a `problems` list, so a caller that only
 * prints them and carries on unpriced writes one loop while one that wants to point at the path can.
 *
 * @param path the card to read, as supplied by `--rates`
 * @returns the validated card, or every reason it could not be used
 */
export function readCodexRateCard({ path }: { path: string }): Result<CodexRateCard, CodexPricingError> {
  const text = safeFs({
    execute: (): unknown => JSON.parse(readFileSync(path, "utf8")),
    operation: "codex.readCodexRateCard",
    path,
  });
  if (text.isErr()) {
    return err(CodexPricingErrors.unreadable({ cause: text.error.message, path }));
  }
  return parseCodexRateCard({ value: text.value });
}
