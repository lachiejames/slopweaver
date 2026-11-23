/*
 * `foreignRunLine` for a run another session holds: whether that holder is live, dead or unknown, whether this reader
 * could identify itself, and the one transfer command that would succeed from here. It moved here when
 * `runOwner.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { foreignRunLine } from "../../../../handover/runOwner.js";
import { AT, elsewhere, MINE, THEIRS, writer } from "./harness.js";

describe("foreignRunLine", () => {
  it("spells out the live-holder transfer when non-default routing is in play, so the flags survive the paste", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      docClaim: "one",
      flagSuffix: " --dir '/tmp/custom board'",
      journalAmbiguous: false,
      liveness: { kind: "live" },
      ownership: elsewhere,
      phase: "open",
      slug: "held",
    })!;

    expect(line).toContain("Transfer it with `handover release held --dir '/tmp/custom board' --why \"…\"`");
    expect(line).toContain("then `handover claim held --dir '/tmp/custom board' --why \"…\"` here");
  });

  it("keeps the live-holder stand-off byte-for-byte unchanged", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "one",
      phase: "open",
      journalAmbiguous: false,
      liveness: { kind: "live" },
      ownership: elsewhere,
      slug: "held",
    })!;

    expect(line).toBe(
      `⊘ The run "held" is held by session ${THEIRS} in /wt/theirs, pid 65036 since ${AT} — another session ` +
        "is driving it. Resume is read-only; do NOT finish, abandon, ask, answer or amend it. Transfer it with " +
        "`handover release` in the owning session, then `handover claim` here.",
    );
  });

  it("treats an unsupplied liveness as unknown — conditional framing, never dead, never unconditional", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "one",
      phase: "open",
      journalAmbiguous: false,
      liveness: undefined,
      ownership: elsewhere,
      slug: "held",
    })!;

    expect(line).toContain("another session is driving it");
    expect(line).toContain('If the owning session is still alive: `handover release held --why "…"` there');
    expect(line).toContain('If you know it is gone: `handover claim held --force --why "…"`.');
    expect(line).not.toContain("DEAD");
  });

  it("sends a dead holder to ordinary claim with the slug and no --force", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "one",
      phase: "open",
      journalAmbiguous: false,
      liveness: { kind: "dead" },
      ownership: elsewhere,
      slug: "held",
    })!;

    expect(line).toBe(
      `⊘ The run "held" is held by session ${THEIRS} in /wt/theirs, pid 65036 since ${AT} — that session is ` +
        "DEAD. Resume is read-only; do NOT finish, abandon, ask, answer or amend it. Take the run over with " +
        '`handover claim held --why "…"` (a provably dead holder needs no --force).',
    );
    expect(line).not.toContain("handover release");
  });

  it("sends a dead ORPHAN holder to the orphan abandon, since claim needs a doc", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "none",
      phase: "open",
      journalAmbiguous: false,
      liveness: { kind: "dead" },
      ownership: elsewhere,
      slug: "held",
    })!;

    expect(line).toContain("no doc on the board claims the slug");
    expect(line).toContain('`handover abandon held --why "…"`');
    expect(line).not.toContain("handover claim");
  });

  it("gives an unidentified session the working claim command for a dead holder, never the impossible release", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "one",
      phase: "open",
      journalAmbiguous: false,
      liveness: { kind: "dead" },
      ownership: { kind: "elsewhere", thisSession: undefined, writer },
      slug: "held",
    })!;

    expect(line).toContain("that session is DEAD");
    expect(line).toContain('`handover claim held --why "…"`');
    expect(line).toContain("run it from an identified visible session");
    expect(line).not.toContain("handover release");
  });

  it("spells out full invocations for an unidentified reader of a LIVE holder — changed text, no bare verbs", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "one",
      journalAmbiguous: false,
      liveness: { kind: "live" },
      ownership: { kind: "elsewhere", thisSession: undefined, writer },
      phase: "open",
      slug: "held",
    })!;

    expect(line).toContain('Transfer it with `handover release held --why "…"` in the owning session');
    expect(line).toContain('then `handover claim held --why "…"` here');
    expect(line).toContain("Any takeover command above must run from an identified visible session");
  });

  it("keeps the cannot-claim stand-off for an unidentified session when the holder is not proven dead", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "one",
      phase: "open",
      journalAmbiguous: false,
      liveness: { kind: "unknown", why: "no registry" },
      ownership: { kind: "elsewhere", thisSession: undefined, writer },
      slug: "held",
    })!;

    expect(line).toContain("this session could not identify itself, so it cannot claim the run");
    expect(line).toContain("Any takeover command above must run from an identified visible session");
    expect(line).not.toContain("DEAD");
  });

  it("gives an unidentified reader of an unknown ORPHAN the same conditional guidance, never a bare claim", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "none",
      phase: "open",
      journalAmbiguous: false,
      liveness: { kind: "unknown", why: "no registry" },
      ownership: { kind: "elsewhere", thisSession: undefined, writer },
      slug: "held",
    })!;

    expect(line).toContain('it can close its own orphaned run there with `handover abandon held --why "…"`');
    expect(line).toContain("If it is gone (no registry), no typed takeover exists for this case yet");
    expect(line).not.toContain("handover release");
    expect(line).not.toContain("`handover claim` here");
    expect(line).not.toContain("--force");
  });

  it("adds the forced claim escape only for unknown liveness", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "one",
      phase: "open",
      journalAmbiguous: false,
      liveness: { kind: "unknown", why: "no registry" },
      ownership: elsewhere,
      slug: "held",
    })!;

    expect(line).toContain('If the owning session is still alive: `handover release held --why "…"` there');
    expect(line).toContain('then `handover claim held --why "…"` here');
    expect(line).toContain('If you know it is gone (no registry): `handover claim held --force --why "…"`.');
  });

  it("frames every unknown-ORPHAN command on the condition it succeeds under, plus the recorded limitation", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      flagSuffix: " --home /custom",
      docClaim: "none",
      phase: "open",
      journalAmbiguous: false,
      liveness: { kind: "unknown", why: "Codex exposes no live-thread registry to this CLI" },
      ownership: elsewhere,
      slug: "held",
    })!;

    expect(line).toContain("no transfer verb can act from here");
    expect(line).toContain(
      'it can close its own orphaned run there with `handover abandon held --home /custom --why "…"`',
    );
    expect(line).toContain(
      "If it is gone (Codex exposes no live-thread registry to this CLI), no typed takeover exists for this case yet",
    );
    expect(line).not.toContain("--force");
  });

  it("omits the worktree and pid it was never told, rather than printing a placeholder", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "one",
      phase: "open",
      journalAmbiguous: false,
      liveness: undefined,
      ownership: {
        kind: "elsewhere",
        thisSession: MINE,
        writer: { atIso: AT, pid: undefined, sessionId: THEIRS, worktree: undefined },
      },
      slug: "held",
    })!;

    expect(line).toContain(`session ${THEIRS} since ${AT}`);
    expect(line).not.toContain("undefined");
  });
});
