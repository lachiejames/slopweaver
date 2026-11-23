/**
 * Unit: `gmail triage` on a real home — the snapshot it persists and the card pins it keeps, each a real round trip
 * into a `mkdtempSync` home, which is the fixture shape `testing.md` allows. The inbox here is synthetic.
 */
import { chmodSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { runGmailTriage } from "../../../../../../cli/commands/gmail/triageRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { GmailErrors } from "../../../../../../live/gmail/errors.js";
import { buildGmailTriage, type GmailTriageDocument } from "../../../../../../live/gmail/triage.js";
import { readTriageCard } from "../../../../../../live/gmail/triageCards.js";
import { DEFAULT_TRIAGE_LIMIT } from "../../../../../../live/gmail/triageRead.js";
import { writeGmailTriageDocument } from "../../../../../../live/gmail/triageStore.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { EVERY_LANE_POLICY } from "../../../../live/gmail/triage/harness.js";
import { DOCUMENT, depsFor, EMPTY, fresh, message, newHome, READ_AT, useHomes } from "./harness.js";

useHomes();

describe("gmail triage on a real home", () => {
  it("writes the reading owner-only, tightening a directory that already stood open, and it reads back whole", () => {
    const home = newHome();
    const directory = stateHomePaths({ home }).live.gmail.root;
    mkdirSync(directory, { mode: 0o755, recursive: true });
    chmodSync(directory, 0o755);
    const written = unwrap(writeGmailTriageDocument({ document: DOCUMENT, home }));
    expect(written.path).toBe(stateHomePaths({ home }).live.gmail.triageJson);
    expect(JSON.parse(readFileSync(written.path, "utf8"))).toEqual(JSON.parse(JSON.stringify(DOCUMENT)));
    expect([statSync(written.path).mode & 0o777, statSync(directory).mode & 0o777]).toEqual([0o600, 0o700]);
  });

  it("--card prints only the pinned ids still in the inbox, never mail that arrived after the pin", async () => {
    const home = newHome();
    const pinning = fresh();
    const pinned = await runGmailTriage({
      deps: depsFor({ ambientHome: home, recorded: pinning }),
      rest: ["--key", "from:a@example.test", "--pin", "inbox-triage-1"],
    });
    expect(pinned).toBe(EXIT_OK);
    // Later: one pinned message has left the inbox and a new one from the same sender has arrived.
    const later = buildGmailTriage({
      account: "owner@example.test",
      complete: true,
      inviteFileIds: new Set<string>(),
      repliedThreadIds: new Set<string>(),
      inboxEstimate: 2,
      policy: EVERY_LANE_POLICY,
      messages: [
        message({ atIso: "2026-09-30T09:00:00.000Z", from: "a@example.test", id: "a-new" }),
        message({ atIso: "2026-09-28T10:00:00.000Z", from: "a@example.test", id: "a-early" }),
      ],
      readAtIso: "2026-09-30T10:00:00.000Z",
    });
    const reading = fresh();
    const code = await runGmailTriage({
      deps: depsFor({ ambientHome: home, document: later, recorded: reading }),
      rest: ["--card", "inbox-triage-1", "--json"],
    });
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(reading.out[0]!)).toEqual({
      card: "inbox-triage-1",
      ids: ["a-early"],
      key: "from:a@example.test",
      pinned: 2,
      pinnedAtIso: READ_AT,
    });
  });

  it("refuses a second pin under one slug, and exits 3 when every pinned id has left", async () => {
    const home = newHome();
    const rest = ["--key", "from:b@example.test", "--pin", "inbox-triage-2"];
    expect(await runGmailTriage({ deps: depsFor({ ambientHome: home, recorded: fresh() }), rest })).toBe(EXIT_OK);
    const again = fresh();
    expect(await runGmailTriage({ deps: depsFor({ ambientHome: home, recorded: again }), rest })).toBe(EXIT_ERROR);
    expect(again.diagnostics).toEqual([
      "a card is already pinned as inbox-triage-2, and a pin is written once — card the group under a new slug",
    ]);
    expect(again.out).toEqual([]);
    const cleared = fresh();
    const code = await runGmailTriage({
      deps: depsFor({ ambientHome: home, document: EMPTY, recorded: cleared }),
      rest: ["--card", "inbox-triage-2"],
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(cleared.out[0]!.split("\n").at(-1)).toBe("0 of 1 pinned id(s) still in the inbox: ");
  });

  it("--card over a reading STOPPED at the cap refuses a pinned id it missed, and passes one that found them all", async () => {
    const home = newHome();
    const pinning = { ambientHome: home, recorded: fresh() };
    const rest = ["--key", "from:a@example.test", "--pin", "inbox-triage-3"];
    expect(await runGmailTriage({ deps: depsFor(pinning), rest })).toBe(EXIT_OK);
    const capped = ({ ids }: { ids: readonly string[] }): GmailTriageDocument =>
      buildGmailTriage({
        account: "owner@example.test",
        complete: false,
        inviteFileIds: new Set<string>(),
        repliedThreadIds: new Set<string>(),
        inboxEstimate: 900,
        policy: EVERY_LANE_POLICY,
        messages: ids.map((id) => message({ atIso: "2026-09-30T09:00:00.000Z", from: "a@example.test", id })),
        readAtIso: "2026-09-30T10:00:00.000Z",
      });
    // `a-early` sits past the cap: absent from this reading, but nothing says it left the inbox.
    const missed = fresh();
    const refused = await runGmailTriage({
      deps: depsFor({ ambientHome: home, document: capped({ ids: ["a-new", "a-late"] }), recorded: missed }),
      rest: ["--card", "inbox-triage-3", "--json"],
    });
    expect([refused, missed.out]).toEqual([EXIT_ERROR, []]);
    expect(missed.diagnostics).toEqual([
      "gmail triage: card inbox-triage-3 — 1 of 2 pinned id(s) were not in a reading that STOPPED at the message " +
        `cap (--limit ${String(DEFAULT_TRIAGE_LIMIT)}), so they may still be in the inbox; act on nothing, and ` +
        "re-run with a higher --limit",
    ]);
    const found = fresh();
    const code = await runGmailTriage({
      deps: depsFor({ ambientHome: home, document: capped({ ids: ["a-late", "a-early"] }), recorded: found }),
      rest: ["--card", "inbox-triage-3", "--json"],
    });
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(found.out[0]!).ids).toEqual(["a-late", "a-early"]);
  });

  it("--pin captures the group's mail BEFORE it writes the pin, and says where each went", async () => {
    const home = newHome();
    const recorded = fresh();
    const code = await runGmailTriage({
      deps: depsFor({ ambientHome: home, recorded }),
      rest: ["--key", "from:a@example.test", "--pin", "inbox-triage-4"],
    });
    expect(code).toBe(EXIT_OK);
    expect(recorded.effects).toEqual(["capture:a-late,a-early", "pin:a-late,a-early"]);
    expect(recorded.diagnostics[0]).toBe(
      `gmail triage: stored 2 message(s) for card inbox-triage-4 at ${home}/live/gmail/card-mail/inbox-triage-4.json`,
    );
  });

  it("a capture that fails pins nothing and prints nothing, so no card stands without its mail", async () => {
    const home = newHome();
    const recorded = fresh();
    const code = await runGmailTriage({
      deps: depsFor({ ambientHome: home, captureFails: true, recorded }),
      rest: ["--key", "from:a@example.test", "--pin", "inbox-triage-5"],
    });
    expect([code, recorded.out, recorded.effects]).toEqual([EXIT_ERROR, [], ["capture:a-late,a-early"]]);
    expect(recorded.diagnostics).toEqual([
      `gmail triage: could not read pinned message a-late from Gmail: ${GmailErrors.notConnected().message} — nothing was pinned`,
    ]);
    expect(unwrapErr(readTriageCard({ home, slug: "inbox-triage-5" })).code).toBe("CARD_NOT_PINNED");
  });

  it("a slug already pinned is refused before any mail is captured over its stored copy", async () => {
    const home = newHome();
    const rest = ["--key", "from:b@example.test", "--pin", "inbox-triage-6"];
    expect(await runGmailTriage({ deps: depsFor({ ambientHome: home, recorded: fresh() }), rest })).toBe(EXIT_OK);
    const again = fresh();
    expect(await runGmailTriage({ deps: depsFor({ ambientHome: home, recorded: again }), rest })).toBe(EXIT_ERROR);
    expect(again.effects).toEqual([]);
  });

  it("a pin that cannot be written discards the mail captured for it", async () => {
    const recorded = fresh();
    const code = await runGmailTriage({
      deps: depsFor({ ambientHome: newHome(), pinFails: true, recorded }),
      rest: ["--key", "from:b@example.test", "--pin", "inbox-triage-7"],
    });
    expect([code, recorded.out]).toEqual([EXIT_ERROR, []]);
    expect(recorded.effects).toEqual(["capture:b-1", "pin:b-1", "discard:inbox-triage-7"]);
  });

  it("pins at most the newest 20 of a larger group, says how many stay, and prints the pinned ids", async () => {
    const ids = Array.from({ length: 23 }, (_, at) => `c-${String(100 - at)}`);
    const big = buildGmailTriage({
      account: "owner@example.test",
      complete: true,
      inboxEstimate: 23,
      policy: EVERY_LANE_POLICY,
      messages: ids.map((id, at) =>
        message({ atIso: new Date(Date.parse(READ_AT) - at * 60_000).toISOString(), from: "c@example.test", id }),
      ),
      readAtIso: READ_AT,
      inviteFileIds: new Set(),
      repliedThreadIds: new Set(),
    });
    const home = newHome();
    const recorded = fresh();
    const code = await runGmailTriage({
      deps: depsFor({ ambientHome: home, document: big, recorded }),
      rest: ["--key", "from:c@example.test", "--pin", "inbox-triage-8", "--json"],
    });
    expect(code).toBe(EXIT_OK);
    const printed = JSON.parse(recorded.out[0]!) as { ids: string[]; heldBack: number };
    expect([printed.ids, printed.heldBack]).toEqual([ids.slice(0, 20), 3]);
    expect(unwrap(readTriageCard({ home, slug: "inbox-triage-8" })).ids).toEqual(ids.slice(0, 20));
    expect(recorded.diagnostics[1]).toBe(
      `gmail triage: pinned 20 id(s) as card inbox-triage-8 at ${stateHomePaths({ home }).live.gmail.triageCards}/inbox-triage-8.json; ` +
        "3 older one(s) stay in the inbox for the next reading",
    );
  });

  it("--card on a slug never pinned is an error that acts on nothing", async () => {
    const recorded = fresh();
    const code = await runGmailTriage({
      deps: depsFor({ ambientHome: newHome(), recorded }),
      rest: ["--card", "inbox-triage-never"],
    });
    expect([code, recorded.out]).toEqual([EXIT_ERROR, []]);
    expect(recorded.diagnostics).toEqual([
      "no ids are pinned for card inbox-triage-never — act on nothing, and card the group again",
    ]);
  });
});
