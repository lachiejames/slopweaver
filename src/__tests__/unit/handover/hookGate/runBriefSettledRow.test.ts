/*
 * `runBriefLines` for a foreign run whose row is already settled: the reap named only when the reaper would act on
 * the cycle, and the ordinary stand-off, ambiguity or board-unreadable line kept in every other case.
 */
import { describe, expect, it } from "vitest";

import { runBriefLines } from "../../../../handover/hookGate.js";
import { MINE, OTHER_WRITER, run } from "./harness.js";

describe("runBriefLines", () => {
  it("never tells a session to claim a SETTLED row whose dead holder left the cycle open — it names the reap", () => {
    const runs = [
      run({
        ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER },
        reapable: true,
        settled: { settlement: "answered", witness: "https://github.com/lachiejames/slopweaver/pull/303" },
        slug: "held",
        writerLiveness: { kind: "dead" },
      }),
    ];
    const lines = runBriefLines({ flagSuffix: "", readerIdentified: true, runs });

    expect(lines).toEqual([
      '✓ The run "held" belongs to a row already settled answered (witness: ' +
        "https://github.com/lachiejames/slopweaver/pull/303) — there is nothing to take over; do NOT claim it. " +
        "Its session session-theirs died without closing the cycle, and `slopweaver handover reap` writes the " +
        "ending it never could.",
    ]);
  });

  it("says no witness was recorded on a settled row rather than printing undefined", () => {
    const runs = [
      run({
        ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER },
        reapable: true,
        settled: { settlement: "filed", witness: undefined },
        slug: "held",
        writerLiveness: { kind: "dead" },
      }),
    ];
    const lines = runBriefLines({ flagSuffix: "", readerIdentified: true, runs });

    expect(lines).toEqual([
      '✓ The run "held" belongs to a row already settled filed (witness: none recorded) — there is nothing to ' +
        "take over; do NOT claim it. Its session session-theirs died without closing the cycle, and " +
        "`slopweaver handover reap` writes the ending it never could.",
    ]);
  });

  it("keeps the ordinary line when the REAPER would skip the cycle, so it never names a reap that does nothing", () => {
    const runs = [
      run({
        ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER },
        reapable: false,
        settled: { settlement: "answered", witness: "w" },
        slug: "held",
        writerLiveness: { kind: "dead" },
      }),
    ];
    const lines = runBriefLines({ flagSuffix: "", readerIdentified: true, runs });

    expect(lines).toEqual([
      '⊘ The run "held" is held by session session-theirs in /wt/other, pid 4242 since 2026-08-06T01:00:00.000Z — that session is DEAD. Resume is read-only; do NOT finish, abandon, ask, answer or amend it. Take the run over with `handover claim held --why "…"` (a provably dead holder needs no --force).',
    ]);
  });

  it("keeps the ordinary stand-off for a settled row whose holder is LIVE, since it may still be finishing", () => {
    const runs = [
      run({
        ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER },
        settled: { settlement: "answered", witness: "w" },
        slug: "held",
        writerLiveness: { kind: "live" },
      }),
    ];
    const lines = runBriefLines({ flagSuffix: "", readerIdentified: true, runs });

    expect(lines).toEqual([
      '⊘ The run "held" is held by session session-theirs in /wt/other, pid 4242 since 2026-08-06T01:00:00.000Z — another session is driving it. Resume is read-only; do NOT finish, abandon, ask, answer or amend it. Transfer it with `handover release` in the owning session, then `handover claim` here.',
    ]);
  });

  it("keeps the ordinary line for a settled row whose holder's liveness is unknown, which the reap would skip", () => {
    const runs = [
      run({
        ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER },
        settled: { settlement: "answered", witness: "w" },
        slug: "held",
        writerLiveness: { kind: "unknown", why: "a registry file would not decode" },
      }),
    ];
    const lines = runBriefLines({ flagSuffix: "", readerIdentified: true, runs });

    expect(lines).toEqual([
      '⊘ The run "held" is held by session session-theirs in /wt/other, pid 4242 since 2026-08-06T01:00:00.000Z — another session is driving it. Resume is read-only; do NOT finish, abandon, ask, answer or amend it. If the owning session is still alive: `handover release held --why "…"` there, then `handover claim held --why "…"` here. If you know it is gone (a registry file would not decode): `handover claim held --force --why "…"`.',
    ]);
  });

  it("keeps the ambiguity line for a settled row whose journal has undecodable lines", () => {
    const runs = [
      run({
        journalAmbiguous: true,
        ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER },
        settled: { settlement: "answered", witness: "w" },
        slug: "held",
        writerLiveness: { kind: "dead" },
      }),
    ];
    const lines = runBriefLines({ flagSuffix: "", readerIdentified: true, runs });

    expect(lines).toEqual([
      '⊘ The run "held"\'s journal has undecodable line(s), so ownership is AMBIGUOUS (it last named session session-theirs) and every transfer verb will refuse it. Resume is read-only; do NOT finish, abandon, ask, answer or amend it. Inspect the journal file for the run "held" before acting.',
    ]);
  });

  it("does not trust one visible doc's settlement on a PARTIAL board scan — the board-unreadable line speaks", () => {
    const runs = [
      run({
        docClaim: "unknown",
        ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER },
        reapable: true,
        settled: { settlement: "answered", witness: "w" },
        slug: "held",
        writerLiveness: { kind: "dead" },
      }),
    ];
    const lines = runBriefLines({ flagSuffix: "", readerIdentified: true, runs });

    expect(lines).toEqual([
      '⊘ The run "held" is held by session session-theirs in /wt/other, pid 4242 since 2026-08-06T01:00:00.000Z — that session is DEAD. Resume is read-only; do NOT finish, abandon, ask, answer or amend it. The board could not be fully read, so whether a doc claims this slug is unknown and no takeover door can be named — fix the unreadable board doc(s) before acting.',
    ]);
  });

  it("never attaches the caller's --dir to `handover reap`, which takes no such flag", () => {
    const runs = [
      run({
        ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER },
        reapable: true,
        settled: { settlement: "answered", witness: "w" },
        slug: "held",
        writerLiveness: { kind: "dead" },
      }),
    ];
    const lines = runBriefLines({ flagSuffix: " --dir /custom/handovers", readerIdentified: true, runs });

    expect(lines).toEqual([
      '✓ The run "held" belongs to a row already settled answered (witness: w) — there is nothing to take ' +
        "over; do NOT claim it. Its session session-theirs died without closing the cycle, and `slopweaver " +
        "handover reap` writes the ending it never could.",
    ]);
  });
});
