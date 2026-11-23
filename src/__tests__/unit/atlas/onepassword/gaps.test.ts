/**
 * Which 1Password gap conditions carry a printable remedy — `src/atlas/onepassword/gaps.ts`.
 *
 * The table is typed as a full record over the vocabulary, so a condition added to it without a decision
 * here fails to compile rather than silently printing no remedy.
 */
import { describe, expect, it } from "vitest";

import { ONEPASSWORD_SIGNIN_STEP } from "../../../../atlas/onepassword/credentials.js";
import {
  ONEPASSWORD_GAP_CONDITIONS,
  type OnepasswordGapCondition,
  onepasswordUnblockFor,
} from "../../../../atlas/onepassword/gaps.js";

const EXPECTED: Readonly<Record<OnepasswordGapCondition, string | null>> = {
  "api-browser-disagreement": null,
  "browser-surface-unreadable": null,
  "cli-not-installed": "install the 1Password CLI and make `op` reachable on PATH",
  "cli-not-signed-in": ONEPASSWORD_SIGNIN_STEP,
  "cli-output-unreadable": null,
  "cli-permission-refused":
    "the signed-in account lacks the administrative permission this surface needs - see the atlas README",
  "deep-link-unverified": null,
  "detail-unreadable": null,
  "events-pagination-incomplete": null,
  "events-scope-refused": "re-issue the Events API token with the `auditevents` family ticked",
  "events-token-not-configured": "slopweaver secrets set onepassword-events-token",
  "item-count-unavailable": null,
  "outside-planned-scope": null,
  "schema-drift": null,
  "sensitivity-gate-reported": null,
  "stable-identity-unverified": null,
};

describe("onepasswordUnblockFor", () => {
  it("prints the five knowable remedies exactly, and nothing for a condition that does not determine one", () => {
    expect(ONEPASSWORD_GAP_CONDITIONS.length).toBeGreaterThan(0);
    const actual = Object.fromEntries(
      ONEPASSWORD_GAP_CONDITIONS.map((condition) => [condition, onepasswordUnblockFor({ condition })]),
    );

    expect(actual).toEqual(EXPECTED);
  });
});
