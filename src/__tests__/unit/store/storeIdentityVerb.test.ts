/**
 * What `store identity` accepts and what it says, with no database in the room.
 *
 * The interesting property here is a refusal that does not exist: the verb takes no `--source` and no
 * `--limit`, because the person set is built from the whole directory and the whole member pull, so
 * reconciling a subset would produce a DIFFERENT person set rather than a smaller one. A flag that
 * quietly changes the answer instead of the scope is the shape this file pins against.
 */
import { describe, expect, it } from "vitest";

import { parseStoreIdentityArgs, STORE_IDENTITY_FLAG_NAMES } from "../../../cli/commands/store/identityArgs.js";
import { identityLines } from "../../../cli/commands/store/identityLines.js";
import { unwrapErr } from "../../../lib/result.js";
import type { ReconcileReport } from "../../../store/identity/reconcile.js";

/** A report carrying the shape a live run produces, so each test states its own subject. */
const report = (over: Partial<ReconcileReport> = {}): ReconcileReport => ({
  authorsRepointed: 4200,
  bots: 12,
  accepted: 3,
  candidates: 7,
  directoryUsers: 40,
  elapsedMs: 250,
  fromDirectory: 40,
  membersRead: 180,
  people: 52,
  pruned: 0,
  refused: [],
  renamed: 0,
  unmatched: 9,
  warnings: [],
  ...over,
});

describe("the flags it accepts", () => {
  it("takes no argument at all", () => {
    const parsed = parseStoreIdentityArgs({ rest: [] });
    expect(parsed.isOk()).toBe(true);
  });

  it("takes a state home, so a test can point it somewhere of its own", () => {
    const parsed = parseStoreIdentityArgs({ rest: ["--home", "/tmp/x"] });
    expect(parsed.isOk() ? parsed.value.home : "").toBe("/tmp/x");
  });

  it("reports no home when none was given, rather than inventing one", () => {
    const parsed = parseStoreIdentityArgs({ rest: [] });
    expect(parsed.isOk() ? parsed.value.home : "unset").toBe(undefined);
  });

  it("does not pull the directory unless asked, because a pull reaches the network", () => {
    const parsed = parseStoreIdentityArgs({ rest: [] });
    expect(parsed.isOk() ? parsed.value.pull : true).toBe(false);
  });

  it("takes --pull to read the directory through the grant first", () => {
    const parsed = parseStoreIdentityArgs({ rest: ["--pull"] });
    expect(parsed.isOk() ? parsed.value.pull : false).toBe(true);
  });

  it("refuses a source filter, because a partial reconcile changes the answer", () => {
    expect(unwrapErr(parseStoreIdentityArgs({ rest: ["--source", "slack"] }))).toEqual([
      "unknown flag: --source",
      "unexpected argument: slack",
    ]);
  });

  it("refuses a limit, for the same reason", () => {
    expect(unwrapErr(parseStoreIdentityArgs({ rest: ["--limit", "10"] }))).toEqual([
      "unknown flag: --limit",
      "unexpected argument: 10",
    ]);
  });

  it("advertises exactly the three flags it takes", () => {
    expect([...STORE_IDENTITY_FLAG_NAMES]).toEqual(["--home", "--json", "--pull"]);
  });
});

describe("what a run reports", () => {
  it("leads with how many people it wrote and from what, which are different numbers", () => {
    expect(identityLines({ report: report() })[0]).toBe(
      "52 person(s) written from 40 directory user(s) and 180 member row(s) in 250 ms",
    );
  });

  it("splits the people Google keys from the ones a trusted address keeps, and says the latter are never forgotten", () => {
    expect(identityLines({ report: report({ fromDirectory: 38, people: 52 }) })[1]).toBe(
      "38 keyed by Google Admin, 14 by a trusted address Google does not hold (departed, contractor or guest — kept, never forgotten)",
    );
  });

  it("reports the bots it skipped, on a line that says a bot is never a person", () => {
    expect(identityLines({ report: report() })[2]).toBe(
      "12 bot member(s) skipped: a bot is never a person, its id stays on the content row",
    );
  });

  it("says a name candidate is never applied, on the line that reports it", () => {
    expect(identityLines({ report: report() })[3]).toBe(
      "4 name candidate(s) recorded for review, never applied; 3 exact org-member name(s) linked; 9 member(s) with no address and no close name",
    );
  });

  it("reports how many content rows now point at a person", () => {
    expect(identityLines({ report: report() })[4]).toBe(
      "4200 content row(s) re-pointed at a person; 0 stale person row(s) pruned, none of them an author of anything",
    );
  });

  it("says how many people the Google id followed to a new primary address, when any did", () => {
    expect(identityLines({ report: report({ renamed: 2 }) })[5]).toBe(
      "2 person row(s) renamed in place to the new primary address their Google id now carries, keeping their history",
    );
  });

  it("prints every refusal in full, because each names an id the schema would refuse", () => {
    const lines = identityLines({
      report: report({
        refused: ["linear B0SYN000014: not the shape of a linear member id, so it cannot be a person's"],
      }),
    });
    expect(lines[5]).toBe(
      "  refused: linear B0SYN000014: not the shape of a linear member id, so it cannot be a person's",
    );
  });

  it("says nothing extra when nothing was refused and no store raised a warning", () => {
    expect(identityLines({ report: report() }).length).toBe(5);
  });

  it("surfaces a member-store warning rather than swallowing it", () => {
    const lines = identityLines({ report: report({ warnings: ["members/github.jsonl: no email scope"] }) });
    expect(lines).toContain("  members/github.jsonl: no email scope");
  });
});
