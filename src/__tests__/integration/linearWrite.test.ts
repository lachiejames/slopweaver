/**
 * INTEGRATION test: the Linear WRITE seam against the REAL Linear GraphQL API, recorded + replayed via a
 * Polly cassette.
 *
 * Recording this CREATES A REAL ISSUE in the real workspace, then deletes it again. A throwaway workspace was
 * rejected as too thin to be evidence of anything, so the only honest way to produce this cassette is against
 * the workspace the product actually targets.
 *
 * ## The sequence, and why each step is here
 *
 *   create → read back → delete
 *
 * `create` alone proves nothing: a mutation can answer `success: true` with a null issue, which the schema
 * genuinely permits. The read-back is what establishes that an object exists at the id we chose. The delete
 * is cleanup, and it is not optional — the predecessor system recorded write cassettes with no teardown at
 * all, so every re-record left another permanent test issue in the real workspace and later read tests
 * degraded as the litter accumulated.
 *
 * ## What may be asserted, and what may not
 *
 * The cassette redactor rewrites `identifier` to a synthetic id and blanks every non-allowlisted string, so
 * **no assertion here may depend on a value Linear echoes back as text.** A `[REDACTED]` title is non-empty,
 * which is exactly how the existing read test's `title.length > 0` check passes without proving anything.
 *
 * What survives and is asserted instead: booleans, the SHAPE of an id, and — the load-bearing one —
 * REFERENTIAL EQUALITY between the id the create returned and the id the read-back returned. Both map to the
 * same synthetic value, so the equality holds on replay while still failing if the read-back returned a
 * different object, nothing, or a stale match.
 *
 * Run:
 *   yarn test:integration                                                    # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_HOME=… \
 *     SLOPWEAVER_RECORD_LINEAR_TOKEN=lin_api_… \
 *     SLOPWEAVER_RECORD_LINEAR_TEAM=<team uuid> yarn test:integration        # (re)record — WRITES FOR REAL
 */
import { describe, expect, it } from "vitest";

import { intentId } from "../../cli/commands/linear/core.js";
import { makeLinearWriteApi } from "../../corpus/linear/write.js";
import { renderIssueBody } from "../../outbound/linear/render.js";
import type { LinearIssueForm } from "../../outbound/linear/types.js";
import { NO_TERMS_LINEAR_PRIVACY } from "../linearWritePrivacyFixture.js";

const RECORD = process.env["POLLY_MODE"] === "record";

function linearToken(): string {
  if (!RECORD) {
    return "lin_api_replay-not-real";
  }
  const token = process.env["SLOPWEAVER_RECORD_LINEAR_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_LINEAR_TOKEN to record the Linear write cassette");
  }
  return token;
}

/**
 * The destination team.
 *
 * A fixed placeholder UUID on replay, the real one when recording. The two differ, and that is fine: the
 * cassette matcher collapses identifiers POSITIONALLY, so a real UUID and a placeholder produce the same
 * match key. That is the mechanism that lets a write cassette replay at all without committing a real
 * workspace id to this public repository — which is precisely what the predecessor system did instead.
 */
function linearTeam(): string {
  if (!RECORD) {
    return "00000000-0000-4000-8000-000000000001";
  }
  const team = process.env["SLOPWEAVER_RECORD_LINEAR_TEAM"];
  if (team === undefined || team.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_LINEAR_TEAM to the team UUID to create the test issue in");
  }
  return team;
}

/**
 * The issue this test files. Every string is a LITERAL — no clock, no random — so the rendered body is
 * byte-identical at record and replay time and the request matches its recording.
 *
 * The title is visibly a test artefact so that if cleanup ever fails, whatever is left in the workspace
 * announces what it is and where it came from.
 */
const FORM: LinearIssueForm = {
  artifact: {
    acceptance: ["The created issue is readable at the id the caller chose", "The issue is deleted afterwards"],
    aiPrompt: [
      { kind: "para", text: "**Goal.** Nothing. This issue exists only to prove the write seam works." },
      { kind: "code", lang: "diff", text: "--- a/x\n+++ b/x\n@@ a diff whose headers must not close the block" },
    ],
    kind: "structured",
    problem: [
      {
        kind: "para",
        text: "Slopweaver could not prove that a Linear issue it composed was ever actually created.",
      },
    ],
    solution: [{ kind: "para", text: "Create one, read it back by the id we chose, then delete it." }],
  },
  fields: {
    teamId: linearTeam(),
    title: "[slopweaver integration test] write seam probe (auto-deleted)",
  },
};

describe("linear write (integration — real Linear via Polly cassette)", () => {
  it("creates a real issue at a caller-chosen id, reads it back, and deletes it", async () => {
    const api = makeLinearWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      scheduler: (task) => task(),
      token: linearToken(),
    });
    const id = intentId({ form: FORM });
    const description = renderIssueBody({ artifact: FORM.artifact });

    // The body is rendered once, by the same function the dry-run prints, so the bytes proven here are the
    // bytes an operator was shown.
    expect(description.startsWith("## Problem\n\n")).toBe(true);
    expect(description.endsWith("\n\n+++")).toBe(true);

    const created = await api.createIssue({
      id,
      input: { description, teamId: FORM.fields.teamId, title: FORM.fields.title },
    });
    expect(created.isOk()).toBe(true);
    const identity = created._unsafeUnwrap();

    // A Linear identifier is `<TEAM>-<n>` live and a synthetic id once redacted. Asserting it is NON-EMPTY
    // would pass on `[REDACTED]`, so the only honest assertion is that it exists as a distinct value and
    // matches what a separate read returns.
    expect(identity.id.length > 0).toBe(true);

    const readBack = await api.readIssue({ id });
    expect(readBack.isOk()).toBe(true);
    const found = readBack._unsafeUnwrap();

    // THE assertion. It fails if the create silently did nothing, if the read-back found a different object,
    // or if the id we chose is not the id Linear stored. It survives redaction because both sides map
    // through the same synthetic id.
    expect(found === undefined).toBe(false);
    expect(found!.id).toBe(identity.id);
    expect(Number.isNaN(Date.parse(found!.updatedAt))).toBe(false);

    // Cleanup, asserted rather than fired and forgotten. Linear moves a deleted issue to Recently Deleted
    // for 30 days, so this removes the active issue; it does not erase the record.
    const deleted = await api.deleteIssue({ id });
    expect(deleted.isOk()).toBe(true);
    expect(deleted._unsafeUnwrap()).toBe(true);
  });
});
