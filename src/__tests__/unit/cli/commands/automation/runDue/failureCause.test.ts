/**
 * `slopweaver automation run-due` over a recipe whose step exits non-zero: the step's own closing stderr is SAVED,
 * on the firing's slot record and on the failure finding's ask, so the reader of either learns why without
 * reproducing the firing. One case per in-process step a multi-leg kind runs; the `verb-run` kind's is in
 * `signal.test.ts`, which pinned this before the multi-leg kinds carried it.
 */
import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../../../lib/result.js";
import { readSlotAttempt } from "../../../../../../live/automation/slotLedger.js";
import { runDueUnderFake } from "../../../../../runDueSignalFake.js";
import { alertRow, argvFor, digestRow, firingAt, investigateRow } from "./fixtures.js";
import { deps, homeWith, removeHomes } from "./harness.js";

afterEach(() => {
  removeHomes();
});

const NOW = "2026-09-08T12:05:00.000Z";

/**
 * Run one tick over a home holding `definition`, and read back what the failed firing left behind.
 *
 * @param definition the one row the home holds
 * @param injected the recording edges the tick runs over, already answering the failure under test
 * @returns the tick's exit, the home it ran over, the slot record's settled detail and the finding's ask
 */
async function failedFiring({
  definition,
  injected,
}: {
  definition: Record<string, unknown>;
  injected: ReturnType<typeof deps>;
}): Promise<{ readonly code: number; readonly home: string; readonly detail: string; readonly ask: string }> {
  const home = homeWith({ rows: [definition] });
  const slotIso = firingAt({ cadence: String(definition["cadence"]), nowIso: NOW });
  const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
  const stored = unwrap(readSlotAttempt({ home, recipeId: String(definition["recipeId"]), slotIso }))!;
  const settled = stored.outcome! as { readonly detail: string };
  return { ask: injected.registered[0]![1]!, code, detail: settled.detail, home };
}

describe("recipe run-due saves a failed step's cause", () => {
  it("keeps an alert-summary READ's stderr tail on the slot record and the finding", async () => {
    const fired = await failedFiring({
      definition: alertRow(),
      injected: deps({ readDiagnostics: "slack read: not_in_channel\n", readExitCode: 1 }),
    });
    expect(fired.code).toBe(1);
    expect(fired.detail).toBe(
      "recipe knock-alerts · READ FAILED · slack alert-summary --channel C0ALERTS · exit 1 · nothing was posted" +
        " · why: slack read: not_in_channel",
    );
    expect(fired.ask).toContain(fired.detail);
  });

  it("keeps the stderr tail of an alert-summary READ that exited zero with no document", async () => {
    const fired = await failedFiring({
      definition: alertRow(),
      injected: deps({ readDiagnostics: "slack read: malformed response\n", readLines: [] }),
    });
    expect(fired.code).toBe(1);
    expect(fired.detail).toBe(
      "recipe knock-alerts · READ FAILED · slack alert-summary --channel C0ALERTS · emitted 0 document(s) on " +
        "stdout, expected exactly 1 · nothing was posted · why: slack read: malformed response",
    );
    expect(fired.ask).toContain(fired.detail);
  });

  it("keeps an alert-summary POST's stderr tail on the slot record and the finding", async () => {
    const fired = await failedFiring({
      definition: alertRow(),
      injected: deps({ exitCode: 1, verbDiagnostics: "slack post: channel_not_found\n" }),
    });
    expect(fired.code).toBe(1);
    expect(fired.detail).toBe(
      "recipe knock-alerts · ran · slack alert-summary --channel C0ALERTS → slack post --as bot --channel D0PROMPT" +
        " · exit 1 · why: slack post: channel_not_found",
    );
    expect(fired.ask).toContain(fired.detail);
  });

  it("keeps a datadog-alert-digest READ's stderr tail on the slot record and the finding", async () => {
    const fired = await failedFiring({
      definition: digestRow(),
      injected: deps({ digestReadExitCode: 1, readDiagnostics: "datadog: 403 Forbidden on logs-count sends\n" }),
    });
    expect(fired.code).toBe(1);
    expect(fired.detail).toBe(
      "recipe knock-alerts-digest · READ FAILED · datadog alert-digest --label Knock · exit 1 · nothing was posted" +
        " · why: datadog: 403 Forbidden on logs-count sends",
    );
    expect(fired.ask).toContain(fired.detail);
  });

  it("keeps a datadog-alert-digest POST's stderr tail on the slot record and the finding", async () => {
    const fired = await failedFiring({
      definition: digestRow(),
      injected: deps({ exitCode: 1, verbDiagnostics: "slack post: invalid_blocks\n" }),
    });
    expect(fired.code).toBe(1);
    expect(fired.detail).toBe(
      "recipe knock-alerts-digest · ran · datadog alert-digest --label Knock → slack post --as bot --channel " +
        "D0PROMPT · exit 1 · why: slack post: invalid_blocks",
    );
    expect(fired.ask).toContain(fired.detail);
  });

  it("keeps an investigate row's failed ASK post stderr tail on the slot record and the finding", async () => {
    const fired = await failedFiring({
      definition: investigateRow(),
      injected: deps({ postDiagnostics: "slack post: ratelimited\n", postExitCode: 1 }),
    });
    expect(fired.code).toBe(1);
    expect(fired.detail).toBe(
      "recipe overnight-staging · ASK FAILED · recipe 'overnight-staging' could not ask its question in D0PROMPT: " +
        "slack post --as bot exited 1 · nothing was asked · why: slack post: ratelimited",
    );
    expect(fired.ask).toContain(fired.detail);
  });

  it("keeps the stderr tail of an investigate ASK post that exited zero with no report", async () => {
    const fired = await failedFiring({
      definition: investigateRow(),
      injected: deps({ postDiagnostics: "slack post: response body was not JSON\n", postLines: [] }),
    });
    expect(fired.code).toBe(1);
    expect(fired.detail).toBe(
      "recipe overnight-staging · ASK FAILED · recipe 'overnight-staging' asked its question and could not read " +
        "where it landed: slack post emitted 0 document(s) on stdout, expected exactly 1 · nothing was asked" +
        " · why: slack post: response body was not JSON",
    );
    expect(fired.ask).toContain(fired.detail);
  });

  it("keeps an investigate row's failed BRIEF stderr tail on the slot record and the finding", async () => {
    const fired = await failedFiring({
      definition: investigateRow(),
      injected: deps({ exitCode: 1, verbDiagnostics: "turn brief: thread D0PROMPT/1790.0001 is not readable\n" }),
    });
    expect(fired.code).toBe(1);
    expect(fired.detail).toBe(
      "recipe overnight-staging · ASKED, NOT BRIEFED · D0PROMPT/1789.0001 · turn brief exited 1 · the question is " +
        "posted; brief it by hand: slopweaver turn brief --channel D0PROMPT --message-ts 1789.0001 --thread-ts " +
        "1789.0001 --user U0OWNER --text 'what regressed in staging overnight?' --surface dm " +
        `--home ${fired.home} · why: turn brief: thread D0PROMPT/1790.0001 is not readable`,
    );
    expect(fired.ask).toContain(fired.detail);
  });
});
