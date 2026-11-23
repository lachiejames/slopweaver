/**
 * Unit: `gmail triage`'s shell over plain fakes — what it prints and writes, which home it reads the install's rule
 * row and the inbox under, and the exit code each reading earns. The inbox here is synthetic.
 */
import { describe, expect, it } from "vitest";

import { runGmailTriage } from "../../../../../../cli/commands/gmail/triageRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../../lib/result.js";
import { buildGmailTriage } from "../../../../../../live/gmail/triage.js";
import { GmailTriageRulesErrors, STORED_RULES_SOURCE } from "../../../../../../live/gmail/triageRuleErrors.js";
import { EMPTY_TRIAGE_POLICY, type GmailTriageArchiveRule } from "../../../../../../live/gmail/triageRules.js";
import { EVERY_LANE_POLICY } from "../../../../live/gmail/triage/harness.js";
import { DOCUMENT, depsFor, EMPTY, fresh, INSTALL_ROW, message, READ_AT } from "./harness.js";

describe("runGmailTriage", () => {
  it("prints the whole reading and writes nothing without --write", async () => {
    const recorded = fresh();
    const code = await runGmailTriage({ deps: depsFor({ recorded }), rest: ["--limit", "50"] });
    expect(code).toBe(EXIT_OK);
    expect(recorded.limits).toEqual([50]);
    expect(recorded.written).toEqual([]);
    expect(recorded.out[0]!.split("\n")[1]).toBe(
      "inbox: 3 message(s), 3 unread, in 2 sender group(s) · the whole inbox · Gmail ESTIMATES 3 in the inbox",
    );
  });

  it("--write persists under --home when named, and says where", async () => {
    const recorded = fresh();
    await runGmailTriage({ deps: depsFor({ recorded }), rest: ["--write", "--home", "/named-home"] });
    expect(recorded.written).toEqual(["/named-home"]);
    expect(recorded.diagnostics).toEqual(["gmail triage: wrote /named-home/live/gmail/triage.json"]);
  });

  it("--write persists under the ambient home when none is named", async () => {
    const recorded = fresh();
    await runGmailTriage({ deps: depsFor({ recorded }), rest: ["--write"] });
    expect(recorded.written).toEqual(["/ambient-home"]);
  });

  it("reads the install's policy and the inbox under the ONE home --home names, handing the policy to the reading", async () => {
    const recorded = fresh();
    const snapshot = {
      ...EMPTY_TRIAGE_POLICY,
      inertFile: undefined,
      revision: 2,
      rules: [INSTALL_ROW],
      structuralRules: EVERY_LANE_POLICY.structuralRules,
    };
    const deps = depsFor({ installRules: ok(snapshot), recorded });
    expect(await runGmailTriage({ deps, rest: ["--home", "/named-home"] })).toBe(EXIT_OK);
    expect(recorded.reads).toEqual([
      "rules:/named-home",
      "triage:/named-home:from:notices@vendor.example,last-reply,passed-invite",
      "carded:/named-home:from:a@example.test,from:b@example.test",
    ]);
  });

  it("reads both under the ambient home when none is named", async () => {
    const recorded = fresh();
    await runGmailTriage({ deps: depsFor({ recorded }), rest: [] });
    expect(recorded.reads).toEqual([
      "rules:/ambient-home",
      "triage:/ambient-home:",
      "carded:/ambient-home:from:a@example.test,from:b@example.test",
    ]);
  });

  it("exits 1 on a stored rule row it cannot apply, before the mailbox is read, naming the row", async () => {
    const recorded = fresh();
    const malformed = GmailTriageRulesErrors.malformed({
      issues: ["schemaVersion: Invalid input: expected 1"],
      source: STORED_RULES_SOURCE,
    });
    const deps = depsFor({ installRules: err(malformed), recorded });
    expect(await runGmailTriage({ deps, rest: ["--home", "/named-home", "--write"] })).toBe(EXIT_ERROR);
    expect([recorded.reads, recorded.limits, recorded.written, recorded.out]).toEqual([
      ["rules:/named-home"],
      [],
      [],
      [],
    ]);
    expect(recorded.diagnostics).toEqual([
      "gmail triage: the store's gmail-triage-rules row is not a gmail triage rule document " +
        "(schemaVersion: Invalid input: expected 1) — nothing was triaged",
    ]);
  });

  it("says the retired rule file is read by nothing when it still sits beside the row, and triages anyway", async () => {
    const recorded = fresh();
    const installRules = ok({
      ...EMPTY_TRIAGE_POLICY,
      inertFile: "/named-home/gmail-triage-rules.json",
      revision: 2,
      rules: [INSTALL_ROW],
    });
    const deps = depsFor({ installRules, recorded });
    await runGmailTriage({ deps, rest: ["--home", "/named-home"] });
    expect(recorded.diagnostics[0]).toBe(
      "gmail triage: /named-home/gmail-triage-rules.json is retired and read by nothing: the store's row " +
        "(revision 2) is this install's triage rules. Change them with `slopweaver gmail triage-rules --set " +
        "<path>`, then move that file out of the home",
    );
    expect(recorded.reads).toEqual([
      "rules:/named-home",
      "triage:/named-home:from:notices@vendor.example",
      "carded:/named-home:from:a@example.test,from:b@example.test",
    ]);
  });

  it("--key --json prints the one group and its ids, with null for a pin it was not asked to make", async () => {
    const recorded = fresh();
    const code = await runGmailTriage({
      deps: depsFor({ recorded }),
      rest: ["--key", "from:a@example.test", "--json"],
    });
    expect(code).toBe(EXIT_OK);
    const printed = JSON.parse(recorded.out[0]!) as { ids: string[]; key: string; pinned: string | null };
    expect([printed.ids, printed.key, printed.pinned]).toEqual([["a-late", "a-early"], "from:a@example.test", null]);
  });

  it("exits 3 for a key no group has, pinning nothing", async () => {
    const absent = fresh();
    expect(await runGmailTriage({ deps: depsFor({ recorded: absent }), rest: ["--key", "from:z@example.test"] })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
  });

  it("refuses a key no group has when the reading STOPPED at the cap, rather than calling it clear", async () => {
    const capped = { ...DOCUMENT, complete: false };
    const missed = fresh();
    const code = await runGmailTriage({
      deps: depsFor({ document: capped, recorded: missed }),
      rest: ["--key", "from:z@example.test", "--limit", "120"],
    });
    expect([code, missed.out]).toEqual([EXIT_ERROR, []]);
    expect(missed.diagnostics).toEqual([
      "gmail triage: no group has key from:z@example.test in a reading that STOPPED at the message cap " +
        "(--limit 120), so its mail may sit past the cap; re-run with a higher --limit",
    ]);
  });

  it("--ruled --json prints exactly the ids a declared rule covers, and exits 3 when none does", async () => {
    const pager = {
      anchor: "knowledge:l-0000000000000105",
      key: "from:no-reply@pager.example",
      kind: "from",
      sender: "Pager",
      why: "the page reaches the owner in chat",
    } as const satisfies GmailTriageArchiveRule;
    const ruledInbox = buildGmailTriage({
      account: "owner@example.test",
      complete: false,
      inviteFileIds: new Set<string>(),
      repliedThreadIds: new Set<string>(),
      inboxEstimate: 900,
      policy: { ...EVERY_LANE_POLICY, rules: [INSTALL_ROW, pager] },
      messages: [
        message({ atIso: "2026-09-29T10:00:00.000Z", from: "Vendor <notices@vendor.example>", id: "vendor-1" }),
        message({ atIso: "2026-09-29T09:00:00.000Z", from: "Pager <no-reply@pager.example>", id: "page-1" }),
        message({ atIso: "2026-09-28T10:00:00.000Z", from: "a@example.test", id: "a-1" }),
      ],
      readAtIso: READ_AT,
    });
    const recorded = fresh();
    const code = await runGmailTriage({
      deps: depsFor({ document: ruledInbox, recorded }),
      rest: ["--ruled", "--json", "--limit", "3"],
    });
    expect(code).toBe(EXIT_OK);
    const printed = JSON.parse(recorded.out[0]!) as { ids: string[]; complete: boolean; groups: { key: string }[] };
    expect([printed.ids, printed.complete, printed.groups.map((group) => group.key)]).toEqual([
      ["vendor-1", "page-1"],
      false,
      ["from:notices@vendor.example", "from:no-reply@pager.example"],
    ]);
    expect(recorded.diagnostics).toEqual([
      "gmail triage: the reading STOPPED at the message cap (--limit 3), so ruled mail may sit past it; archive " +
        "these, then re-run with a higher --limit",
    ]);
    const none = fresh();
    expect(await runGmailTriage({ deps: depsFor({ recorded: none }), rest: ["--ruled"] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(none.out).toEqual(["0 inbox message(s) under a declared archive rule"]);
  });

  it("exits 3 on an empty inbox, 1 on a failed read, and 2 before reading on a bad flag", async () => {
    expect(await runGmailTriage({ deps: depsFor({ document: EMPTY, recorded: fresh() }), rest: [] })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    const failed = fresh();
    expect(await runGmailTriage({ deps: depsFor({ readFails: true, recorded: failed }), rest: [] })).toBe(EXIT_ERROR);
    expect(failed.diagnostics[0]).toContain("slopweaver gmail connect");
    const refused = fresh();
    expect(await runGmailTriage({ deps: depsFor({ recorded: refused }), rest: ["--bogus"] })).toBe(EXIT_USAGE);
    expect(refused.limits).toEqual([]);
  });

  it("exits 0, not 3, on an inbox holding only Fathom mail, because that mail is still there to clear", async () => {
    const fathomOnly = buildGmailTriage({
      account: "owner@example.test",
      complete: true,
      inviteFileIds: new Set<string>(),
      repliedThreadIds: new Set<string>(),
      inboxEstimate: 1,
      policy: EVERY_LANE_POLICY,
      messages: [message({ atIso: READ_AT, from: "Fathom <no-reply@fathom.video>", id: "recap" })],
      readAtIso: READ_AT,
    });
    const recorded = fresh();
    expect(await runGmailTriage({ deps: depsFor({ document: fathomOnly, recorded }), rest: [] })).toBe(EXIT_OK);
    expect(recorded.out[0]!.split("\n").slice(1)).toEqual([
      "inbox: 0 message(s), 0 unread, in 0 sender group(s) · the whole inbox · Gmail ESTIMATES 1 in the inbox",
      "1 Fathom mail(s) held out of triage — never carded; the Fathom integration ingests each meeting, then " +
        "archives the mail: slopweaver fathom clear-inbox",
    ]);
  });

  it("exits 0, not 3, on an inbox holding only Gemini notes mail, because clear-meeting-notes still owns it", async () => {
    const notesOnly = buildGmailTriage({
      account: "owner@example.test",
      complete: true,
      inboxEstimate: 1,
      policy: EVERY_LANE_POLICY,
      messages: [message({ atIso: READ_AT, from: "Gemini <gemini-notes@google.com>", id: "notes" })],
      readAtIso: READ_AT,
      inviteFileIds: new Set(),
      repliedThreadIds: new Set(),
    });
    const recorded = fresh();
    expect(await runGmailTriage({ deps: depsFor({ document: notesOnly, recorded }), rest: [] })).toBe(EXIT_OK);
    expect(recorded.out[0]!.split("\n").slice(1)).toEqual([
      "inbox: 0 message(s), 0 unread, in 0 sender group(s) · the whole inbox · Gmail ESTIMATES 1 in the inbox",
      "1 Gemini meeting-notes mail(s) held out of triage — never carded here; each is archived once its " +
        "transcript is proven in the corpus, or proven absent: slopweaver gmail clear-meeting-notes",
    ]);
  });

  it("exits 0, not 3, on an inbox holding only threads the owner answered last, and prints them as ruled", async () => {
    const repliedOnly = buildGmailTriage({
      account: "owner@example.test",
      complete: true,
      inboxEstimate: 1,
      policy: EVERY_LANE_POLICY,
      messages: [message({ atIso: READ_AT, from: "Dana <dana@example.test>", id: "answered" })],
      readAtIso: READ_AT,
      inviteFileIds: new Set(),
      repliedThreadIds: new Set(["t-answered"]),
    });
    const recorded = fresh();
    expect(await runGmailTriage({ deps: depsFor({ document: repliedOnly, recorded }), rest: [] })).toBe(EXIT_OK);
    expect(recorded.out[0]!.split("\n").slice(-1)).toEqual([
      "  1  Dana · key thread:t-answered · your reply is the last message",
    ]);
    const ruled = fresh();
    expect(await runGmailTriage({ deps: depsFor({ document: repliedOnly, recorded: ruled }), rest: ["--ruled"] })).toBe(
      EXIT_OK,
    );
    expect(ruled.out).toEqual(["1 inbox message(s) under a declared archive rule\nthread:t-answered (1): answered"]);
  });
});
