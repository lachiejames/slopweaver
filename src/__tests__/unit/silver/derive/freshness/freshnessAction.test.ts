/*
 * The two sanctioned behaviours a consumer takes on an artefact it cannot trust, a just-in-time refresh or a refusal
 * naming the command, plus the proceed cases and the reason line that names every moved source.
 */
import { describe, expect, it } from "vitest";
import { freshnessAction, freshnessReason, SILVER_ROSTER_ARTEFACT } from "../../../../../silver/derive/freshness.js";

describe("freshnessAction — two sanctioned behaviours, never a third", () => {
  it("proceeds on a fresh artefact", () => {
    expect(
      freshnessAction({ affectsOutput: true, artefact: SILVER_ROSTER_ARTEFACT, freshness: { kind: "fresh" } }),
    ).toEqual({ kind: "proceed" });
  });

  it("proceeds on a stale artefact that cannot change this consumer's output", () => {
    const action = freshnessAction({
      affectsOutput: false,
      artefact: SILVER_ROSTER_ARTEFACT,
      freshness: { kind: "absent", why: "it has never been derived" },
    });
    expect(action).toEqual({ kind: "proceed" });
  });

  it("refreshes just-in-time when the refresh is local and deterministic", () => {
    const action = freshnessAction({
      affectsOutput: true,
      artefact: SILVER_ROSTER_ARTEFACT,
      freshness: { kind: "absent", why: "it has never been derived" },
    });
    expect(action.kind).toBe("jit");
    expect(action).toEqual({
      command: "slopweaver derive",
      kind: "jit",
      line:
        "the derived identity roster (corpus/silver/index/identities.json) cannot be trusted: it has never " +
        "been derived — running `slopweaver derive` first (local, deterministic, no network)",
    });
  });

  it("refuses once the just-in-time refresh has already had its chance", () => {
    const action = freshnessAction({
      affectsOutput: true,
      artefact: SILVER_ROSTER_ARTEFACT,
      freshness: { kind: "absent", why: "it has never been derived" },
      refreshAttempted: true,
    });
    expect(action.kind).toBe("refuse");
    expect(action).toEqual({
      command: "slopweaver derive",
      kind: "refuse",
      line:
        "the derived identity roster (corpus/silver/index/identities.json) cannot be trusted: it has never " +
        "been derived — refusing rather than sending against stale state. `slopweaver derive` has already " +
        "run and did not make it fresh. Run `slopweaver derive`, then retry.",
    });
  });

  it("refuses, naming the command, when the refresh is remote or needs a person", () => {
    const action = freshnessAction({
      affectsOutput: true,
      artefact: { command: "slopweaver refresh --source slack", name: "bronze", refresh: "remote-or-human" },
      freshness: { kind: "absent", why: "it has never been ingested" },
    });
    expect(action).toEqual({
      command: "slopweaver refresh --source slack",
      kind: "refuse",
      line:
        "bronze cannot be trusted: it has never been ingested — refusing rather than sending against stale " +
        "state. Run `slopweaver refresh --source slack`, then retry.",
    });
  });

  it("names every moved source in the reason", () => {
    const reason = freshnessReason({
      artefact: SILVER_ROSTER_ARTEFACT,
      freshness: {
        changed: [
          { reasons: ["resume cursor a → b"], source: "slack" },
          { reasons: ["member roster 1B → 2B"], source: "github" },
        ],
        derivedAtIso: "2026-08-20T18:48:58.000Z",
        kind: "stale",
      },
    });
    expect(reason).toBe(
      "the derived identity roster (corpus/silver/index/identities.json) was built 2026-08-20T18:48:58.000Z " +
        "and its sources have moved since: slack (resume cursor a → b), github (member roster 1B → 2B)",
    );
  });
});
