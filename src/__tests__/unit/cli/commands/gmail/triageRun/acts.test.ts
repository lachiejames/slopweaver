/**
 * Unit: the two act readings, `--card` and `--ruled`, called directly — the pinned ids an answer archives, under the
 * home it is handed, and the ruled ids. Synthetic inbox, the real pin store.
 */
import { describe, expect, it } from "vitest";

import { parseGmailTriageArgs } from "../../../../../../cli/commands/gmail/triageCore.js";
import { printCard, printRuled } from "../../../../../../cli/commands/gmail/triageRunActs.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../../lib/result.js";
import { pinTriageCard } from "../../../../../../live/gmail/triageCards.js";
import { DOCUMENT, depsFor, fresh, newHome, READ_AT, useHomes } from "./harness.js";

useHomes();

const ARGS = unwrap(parseGmailTriageArgs({ rest: [] }));

describe("printCard and printRuled", () => {
  it("printCard prints the pinned ids still in the inbox, read under the home it is handed", () => {
    const home = newHome();
    const slug = "inbox-triage-20261028-from-a-example-test";
    unwrap(
      pinTriageCard({
        card: { ids: ["a-late", "gone"], key: "from:a@example.test", pinnedAtIso: READ_AT, schemaVersion: 1, slug },
        home,
      }),
    );
    const recorded = fresh();
    expect(printCard({ args: ARGS, deps: depsFor({ recorded }), document: DOCUMENT, home, slug })).toBe(EXIT_OK);
    expect(recorded.out).toEqual([
      `card ${slug} · key from:a@example.test · pinned ${READ_AT}\n1 of 2 pinned id(s) still in the inbox: a-late`,
    ]);
  });

  it("printCard exits 1 on a card with no pin", () => {
    const recorded = fresh();
    const code = printCard({ args: ARGS, deps: depsFor({ recorded }), document: DOCUMENT, home: newHome(), slug: "x" });
    expect(code).toBe(EXIT_ERROR);
    expect(recorded.diagnostics).toEqual(["no ids are pinned for card x — act on nothing, and card the group again"]);
  });

  it("printRuled is exit 3 when no declared rule covers the reading", () => {
    const recorded = fresh();
    expect(printRuled({ args: ARGS, deps: depsFor({ recorded }), document: DOCUMENT })).toBe(EXIT_EXPECTED_EMPTY);
    expect(recorded.out).toEqual(["0 inbox message(s) under a declared archive rule"]);
  });
});
