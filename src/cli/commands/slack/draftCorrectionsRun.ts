/**
 * `slack draft corrections` — every correction the owner made to a draft sent as them, by kind, with every release as the
 * reviewed baseline. The fold is `src/outbound/slack/draftCorrections.ts`; this is the shell around it.
 */
import type { Result } from "#lib/result.js";

import { logger } from "../../../lib/logger.js";
import {
  draftCorrectionLines,
  draftCorrections,
  draftSteersOf,
  type SteerReceipt,
} from "../../../outbound/slack/draftCorrections.js";
import type { SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import type { ExactVoiceRule } from "../../../outbound/voice/exactRules.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

/** The two local reads the report joins to the draft register. */
export interface DraftCorrectionsDeps {
  /** The owner's exact voice rules, every lane — which cuts reached them breaking one. */
  readonly readVoiceRules: (args: { home: string }) => Result<readonly ExactVoiceRule[], { readonly message: string }>;
  /**
   * Every relay receipt — what the owner said on a draft's card, joined to that draft — and how many ledger lines did not
   * read as one. This report counts what read; `slack draft record`'s re-cut check refuses on any that did not.
   */
  readonly readSteerReceipts: (args: {
    home: string;
  }) => Result<{ readonly rows: readonly SteerReceipt[]; readonly undecoded: number }, { readonly message: string }>;
}

/**
 * Print the report. A rule list or relay ledger that cannot be read prints nothing: a report missing one of its
 * inputs would draw a zero it never measured.
 *
 * @param deps the two reads, and where each line goes
 * @param items the draft register, folded
 * @param json print the report as one JSON document
 * @returns 0 once printed, 1 when an input did not read
 */
export function runDraftCorrections({
  deps,
  home,
  items,
  json,
}: {
  deps: DraftCorrectionsDeps & { readonly out: (line: string) => void };
  home: string;
  items: readonly SlackDraftItem[];
  json: boolean;
}): number {
  const rules = deps.readVoiceRules({ home });
  if (rules.isErr()) {
    logger.error({ msg: `slack draft corrections: your voice rules did not read — ${rules.error.message}` });
    return EXIT_ERROR;
  }
  const receipts = deps.readSteerReceipts({ home });
  if (receipts.isErr()) {
    logger.error({ msg: `slack draft corrections: the relay ledger did not read — ${receipts.error.message}` });
    return EXIT_ERROR;
  }
  const corrections = draftCorrections({
    items,
    rules: rules.value,
    steers: draftSteersOf({ receipts: receipts.value.rows }),
  });
  if (json) {
    deps.out(JSON.stringify(corrections, null, 2));
    return EXIT_OK;
  }
  for (const line of draftCorrectionLines({ corrections })) {
    deps.out(line);
  }
  return EXIT_OK;
}
