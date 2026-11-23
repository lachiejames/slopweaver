/**
 * INTEGRATION test: the Linear PROJECT + MILESTONE write seam against the REAL Linear GraphQL API, recorded
 * + replayed via a Polly cassette — the same rationale `linearWrite.test.ts` states for the issue seam,
 * extended rather than re-derived.
 *
 * Recording this CREATES A REAL PROJECT (and a milestone inside it) in the real workspace, then deletes both
 * again. Same reasoning as the issue cassette: a throwaway workspace would be evidence of nothing, so the
 * only honest recording is against the workspace the product actually targets.
 *
 * ## The sequence, and why each step is here
 *
 *   create project → read back → update project → create milestone → read back → delete milestone → delete
 *   project
 *
 * `create` alone proves nothing — `ProjectPayload.project` is `Maybe<Project>`, the same false-success shape
 * `identityFrom` guards against for issues. The read-back establishes the project exists at the id we chose.
 * `update` proves the patch-shaped write actually lands (project fields, unlike an issue's replace-shaped
 * body, don't need a before/after body comparison — see `projectCore.ts`'s own doc for why). The milestone
 * create then proves the second write-API lane end to end, including that its `project` reference resolves
 * to the SAME project — the referential-equality assertion this test is actually built around. Both deletes
 * are cleanup, asserted rather than fired and forgotten, for the same reason the issue cassette asserts its
 * own delete: an unrecorded teardown is how a re-record leaves permanent litter in the real workspace.
 *
 * ## What may be asserted, and what may not
 *
 * Same constraint as `linearWrite.test.ts`: the cassette redactor blanks every non-allowlisted string, so no
 * assertion may depend on a value Linear echoes back as TEXT (`name`, `description`, the full `url`). What
 * survives: booleans, non-empty-ness, and referential equality between an id one call returns and the id a
 * LATER call echoes back — the project id must match across create/read/update/milestone-read, and the
 * milestone's nested project id must match the project's own id.
 *
 * Run:
 *   yarn test:integration                                                    # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_HOME=… \
 *     SLOPWEAVER_RECORD_LINEAR_TOKEN=lin_api_… \
 *     SLOPWEAVER_RECORD_LINEAR_TEAM=<team uuid> yarn test:integration        # (re)record — WRITES FOR REAL
 */
import { describe, expect, it } from "vitest";

import { milestoneIntentId } from "../../cli/commands/linear/milestoneCore.js";
import { projectIntentId } from "../../cli/commands/linear/projectCore.js";
import { makeLinearWriteApi } from "../../corpus/linear/write.js";
import type { LinearMilestoneForm, LinearProjectForm } from "../../outbound/linear/projectTypes.js";
import { NO_TERMS_LINEAR_PRIVACY } from "../linearWritePrivacyFixture.js";

const RECORD = process.env["POLLY_MODE"] === "record";

function linearToken(): string {
  if (!RECORD) {
    return "lin_api_replay-not-real";
  }
  const token = process.env["SLOPWEAVER_RECORD_LINEAR_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_LINEAR_TOKEN to record the Linear project-write cassette");
  }
  return token;
}

/** Same reasoning as `linearWrite.test.ts`'s `linearTeam`: a placeholder on replay, real when recording — the
 * cassette matcher collapses identifiers positionally, so both produce the same match key. */
function linearTeam(): string {
  if (!RECORD) {
    return "00000000-0000-4000-8000-000000000002";
  }
  const team = process.env["SLOPWEAVER_RECORD_LINEAR_TEAM"];
  if (team === undefined || team.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_LINEAR_TEAM to the team UUID to create the test project in");
  }
  return team;
}

/**
 * Every string is a LITERAL — no clock, no random — so the request is byte-identical at record and replay
 * time. Visibly a test artefact so a failed cleanup announces what it is and where it came from.
 *
 * **Re-recording needs a new generation in both names.** The project and milestone ids are derived from this
 * content, and a deleted project keeps its id reserved — MEASURED, a re-record of the `gen1`
 * names failed `projectCreate` with "Entity Project … already exists" minutes after this test's own cleanup
 * had deleted it. Bump `genN` in both, exactly as `linearInitiativeWrite.test.ts` does.
 */
const PROJECT_FORM: LinearProjectForm = {
  fields: {
    description: "auto-created and auto-deleted by src/__tests__/integration/linearProjectWrite.test.ts",
    name: "[slopweaver integration test] project write seam probe gen2 (auto-deleted)",
    teamIds: [linearTeam()],
  },
};

describe("linear project + milestone write (integration — real Linear via Polly cassette)", () => {
  it("creates a real project at a caller-chosen id, updates it, files a milestone, and deletes both", async () => {
    const api = makeLinearWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      scheduler: (task) => task(),
      token: linearToken(),
    });
    const projectId = projectIntentId({ form: PROJECT_FORM });

    const created = await api.createProject({
      id: projectId,
      input: { name: PROJECT_FORM.fields.name, teamIds: PROJECT_FORM.fields.teamIds },
    });
    expect(created.isOk()).toBe(true);
    const createdIdentity = created._unsafeUnwrap();
    // A Linear id is a real UUID live and a synthetic one once redacted — either way it is non-empty, and
    // that is the only claim this survives redaction to make about the VALUE itself.
    expect(createdIdentity.id.length > 0).toBe(true);

    const readAfterCreate = await api.readProject({ id: projectId });
    expect(readAfterCreate.isOk()).toBe(true);
    const foundAfterCreate = readAfterCreate._unsafeUnwrap();
    // THE create assertion: it fails if the create silently did nothing, or if the read-back found a
    // different object. It survives redaction because both sides map through the same synthetic id.
    expect(foundAfterCreate === undefined).toBe(false);
    expect(foundAfterCreate!.id).toBe(createdIdentity.id);

    const updated = await api.updateProject({
      id: projectId,
      input: { priority: 2, targetDate: "2026-12-31" },
    });
    expect(updated.isOk()).toBe(true);
    expect(updated._unsafeUnwrap().id).toBe(createdIdentity.id);

    const milestoneForm: LinearMilestoneForm = {
      fields: { name: "[slopweaver integration test] milestone probe gen2 (auto-deleted)", projectId },
    };
    const milestoneId = milestoneIntentId({ form: milestoneForm });
    const createdMilestone = await api.createMilestone({
      id: milestoneId,
      input: { name: milestoneForm.fields.name, projectId: milestoneForm.fields.projectId },
    });
    expect(createdMilestone.isOk()).toBe(true);
    const milestoneIdentity = createdMilestone._unsafeUnwrap();
    expect(milestoneIdentity.id.length > 0).toBe(true);
    const readMilestone = await api.readMilestone({ id: milestoneId });
    expect(readMilestone.isOk()).toBe(true);
    // THE milestone assertion: its nested project reference resolves to the SAME project this test created,
    // proving the write API's project↔milestone linkage rather than merely that some milestone exists. Read
    // off the read-back, because the SDK's `ProjectMilestonePayload` echoes only an id.
    expect(readMilestone._unsafeUnwrap()!.projectId).toBe(createdIdentity.id);
    const foundMilestone = readMilestone._unsafeUnwrap();
    expect(foundMilestone === undefined).toBe(false);
    expect(foundMilestone!.id).toBe(milestoneIdentity.id);
    expect(foundMilestone!.projectId).toBe(createdIdentity.id);

    // Cleanup, asserted rather than fired and forgotten — same posture `linearWrite.test.ts` takes for the
    // issue it creates. The milestone is deleted first: it lives inside the project.
    const deletedMilestone = await api.deleteMilestone({ id: milestoneId });
    expect(deletedMilestone.isOk()).toBe(true);
    expect(deletedMilestone._unsafeUnwrap()).toBe(true);

    const deletedProject = await api.deleteProject({ id: projectId });
    expect(deletedProject.isOk()).toBe(true);
    expect(deletedProject._unsafeUnwrap()).toBe(true);
  });
});
