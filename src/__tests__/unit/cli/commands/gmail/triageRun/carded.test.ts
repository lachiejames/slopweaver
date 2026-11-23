/**
 * Unit: `gmail triage` marks a group an open card already stands for — the field step 4 of the inbox-triage recipe
 * skips on — in both JSON shapes and the text, surfaces what the scan could not read, never persists it, never
 * scans for `--card` or `--ruled`, and holds a `--pin` that would card such a group a second time.
 */
import { describe, expect, it } from "vitest";

import { runGmailTriage } from "../../../../../../cli/commands/gmail/triageRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { unwrapErr } from "../../../../../../lib/result.js";
import type { TriageCardStanding } from "../../../../../../live/gmail/triageCarded.js";
import type { TriageCardedKeysRead } from "../../../../../../live/gmail/triageCardedStore.js";
import { readTriageCard } from "../../../../../../live/gmail/triageCards.js";
import { renderGmailTriageJson } from "../../../../../../live/gmail/triageRender.js";
import { DOCUMENT, depsFor, fresh, newHome, useHomes } from "./harness.js";

useHomes();

const FILED_INTO = "inbox-triage-20261027-from-a-example-test";

/** The scan as it reads a card for `from:a` filed into a still-open ask, and an unreadable card for `from:b`. */
const SCAN: TriageCardedKeysRead = {
  diagnostics: [
    "from:b@example.test: the board row x did not read whole — carded again, never skipped on unread state",
  ],
  standingsByKey: new Map<string, TriageCardStanding>([
    [
      "from:a@example.test",
      {
        carded: true,
        filedInto: FILED_INTO,
        key: "from:a@example.test",
        line: "filed",
        reason: "filed-open",
        slug: "inbox-triage-20261028-from-a-example-test",
      },
    ],
    [
      "from:b@example.test",
      {
        carded: false,
        filedInto: null,
        key: "from:b@example.test",
        line: "unread",
        reason: "unreadable",
        slug: "inbox-triage-20261028-from-b-example-test",
      },
    ],
  ]),
};

describe("gmail triage — a group an open card already stands for", () => {
  it("whole --json carries each group's carded, null where no card is proven open", async () => {
    const recorded = fresh();
    expect(await runGmailTriage({ deps: depsFor({ carded: SCAN, recorded }), rest: ["--json"] })).toBe(EXIT_OK);
    const printed = JSON.parse(recorded.out[0]!) as { groups: { key: string; carded: unknown }[] };
    expect(printed.groups.map((group) => [group.key, group.carded])).toEqual([
      ["from:a@example.test", { filedInto: FILED_INTO, slug: "inbox-triage-20261028-from-a-example-test" }],
      ["from:b@example.test", null],
    ]);
  });

  it("says on stderr what the scan could not read, and still succeeds", async () => {
    const recorded = fresh();
    expect(await runGmailTriage({ deps: depsFor({ carded: SCAN, recorded }), rest: [] })).toBe(EXIT_OK);
    expect(recorded.diagnostics).toEqual([
      "gmail triage: from:b@example.test: the board row x did not read whole — carded again, never skipped on unread state",
    ]);
  });

  it("text names the open card on the group's key line", async () => {
    const recorded = fresh();
    await runGmailTriage({ deps: depsFor({ carded: SCAN, recorded }), rest: [] });
    const keyLines = recorded.out[0]!.split("\n").filter((line) => line.startsWith("     key "));
    expect(keyLines).toEqual([
      "     key from:a@example.test · already carded as inbox-triage-20261028-from-a-example-test, filed into " +
        `${FILED_INTO} (still open)`,
      "     key from:b@example.test",
    ]);
  });

  it("--key --json carries carded inside the group", async () => {
    const recorded = fresh();
    const deps = depsFor({ carded: SCAN, recorded });
    await runGmailTriage({ deps, rest: ["--key", "from:a@example.test", "--json", "--home", "/named-home"] });
    const printed = JSON.parse(recorded.out[0]!) as { group: { carded: unknown } };
    expect(printed.group.carded).toEqual({ filedInto: FILED_INTO, slug: "inbox-triage-20261028-from-a-example-test" });
    expect(recorded.reads.at(-1)).toBe("carded:/named-home:from:a@example.test,from:b@example.test");
  });

  it("never scans card standing for --card or --ruled", async () => {
    const recorded = fresh();
    await runGmailTriage({ deps: depsFor({ carded: SCAN, recorded }), rest: ["--ruled"] });
    await runGmailTriage({ deps: depsFor({ carded: SCAN, recorded }), rest: ["--card", "no-such-card"] });
    expect(recorded.reads.filter((read) => read.startsWith("carded:"))).toEqual([]);
    expect(recorded.reads.length).toBe(4);
  });

  it("--pin for a group an open card already stands for pins nothing, captures nothing, and names that card", async () => {
    const home = newHome();
    const recorded = fresh();
    const code = await runGmailTriage({
      deps: depsFor({ ambientHome: home, carded: SCAN, recorded }),
      rest: ["--key", "from:a@example.test", "--pin", "inbox-triage-20261029-from-a-example-test"],
    });
    expect([code, recorded.out, recorded.effects]).toEqual([EXIT_EXPECTED_EMPTY, [], []]);
    expect(recorded.diagnostics).toEqual([
      "gmail triage: from:b@example.test: the board row x did not read whole — carded again, never skipped on unread state",
      "gmail triage: from:a@example.test is already carded as inbox-triage-20261028-from-a-example-test, filed into " +
        `${FILED_INTO} and still open, so --pin inbox-triage-20261029-from-a-example-test pinned nothing; settle that ` +
        "card before carding the group again",
    ]);
    expect(unwrapErr(readTriageCard({ home, slug: "inbox-triage-20261029-from-a-example-test" })).code).toBe(
      "CARD_NOT_PINNED",
    );
  });

  it("--pin for a group whose card did not read pins it, so unread state never hides a group", async () => {
    const recorded = fresh();
    const code = await runGmailTriage({
      deps: depsFor({ ambientHome: newHome(), carded: SCAN, recorded }),
      rest: ["--key", "from:b@example.test", "--pin", "inbox-triage-20261029-from-b-example-test"],
    });
    expect([code, recorded.effects]).toEqual([EXIT_OK, ["capture:b-1", "pin:b-1"]]);
  });

  it("--write persists the mailbox's document, which carries no carded field", () => {
    expect(renderGmailTriageJson({ document: DOCUMENT })).not.toContain('"carded"');
    expect(renderGmailTriageJson({ document: DOCUMENT })).toContain('"key": "from:a@example.test"');
  });
});
