/**
 * INTEGRATION test: the Linear PROJECT STATUS UPDATE write seam against the REAL Linear GraphQL API,
 * recorded + replayed via a Polly cassette.
 *
 * This seam SHIPPED WITHOUT ONE. `linearProjectWrite.test.ts` covers the project editor
 * (`mutation.projectUpdate`) and nothing covered `projectUpdateCreate`, which is a different mutation, a
 * different payload and a different false-success shape — the two names collide in Linear's own API, which
 * is exactly how a missing cassette hides behind a present one. The gap was found by auditing the write
 * surface against its cassettes rather than by a failure, so this file is the first thing that would have
 * caught a regression in a verb that notifies every member watching a project.
 *
 * Recording this CREATES A REAL PROJECT in the real workspace, posts a real status update to it, and deletes
 * both again. Same reasoning every other Linear write cassette states: a throwaway workspace would be
 * evidence of nothing, so the only honest recording is against the workspace the product actually targets.
 *
 * ## The sequence, and why each step is here
 *
 *   create project → post update → read update back → delete update → delete project
 *
 * The project exists only to be a destination — `ProjectUpdateCreateInput.projectId` is required, and
 * pointing it at a real team project would put a test report in a place colleagues read. `create` alone
 * proves nothing: `ProjectUpdatePayload.projectUpdate` is `Maybe<ProjectUpdate>`, the same false-success
 * shape `projectUpdateIdentityFrom` guards against. The read-back is what establishes the update exists at
 * the id we chose. Both deletes are asserted rather than fired and forgotten, for the reason the issue
 * cassette records: an unrecorded teardown is how a re-record leaves permanent litter in the workspace.
 *
 * ## What may be asserted, and what may not
 *
 * Same constraint as every cassette here: the redactor blanks every non-allowlisted string, so no assertion
 * may depend on a value Linear echoes back as TEXT — the update's `body` included. What survives is
 * `health` (an allowlisted structural key, and the one field a reader of a project actually acts on) and
 * REFERENTIAL EQUALITY between an id one call returns and the id a LATER call echoes back.
 *
 * `health` is what this test is really built around. The form makes it required where Linear leaves it
 * optional, and the verb reports the value Linear ECHOED rather than the one that was asked for — so a
 * provider that silently stored something else would show up here and nowhere else.
 *
 * Run:
 *   yarn test:integration                                                    # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_HOME=… \
 *     SLOPWEAVER_RECORD_LINEAR_TOKEN=lin_api_… \
 *     SLOPWEAVER_RECORD_LINEAR_TEAM=<team uuid> yarn test:integration        # (re)record — WRITES FOR REAL
 */
import { describe, expect, it } from "vitest";

import { projectIntentId } from "../../cli/commands/linear/projectCore.js";
import { projectUpdateInputFor, projectUpdateIntentId } from "../../cli/commands/linear/projectUpdateCore.js";
import { makeLinearWriteApi } from "../../corpus/linear/write.js";
import type { LinearProjectForm } from "../../outbound/linear/projectTypes.js";
import type { LinearProjectUpdateForm } from "../../outbound/linear/projectUpdateTypes.js";
import { NO_TERMS_LINEAR_PRIVACY } from "../linearWritePrivacyFixture.js";

const RECORD = process.env["POLLY_MODE"] === "record";

function linearToken(): string {
  if (!RECORD) {
    return "lin_api_replay-not-real";
  }
  const token = process.env["SLOPWEAVER_RECORD_LINEAR_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_LINEAR_TOKEN to record the Linear project-update cassette");
  }
  return token;
}

/** Same reasoning as `linearProjectWrite.test.ts`'s `linearTeam`: a placeholder on replay, real when
 * recording — the cassette matcher collapses identifiers positionally, so both produce the same match key. */
function linearTeam(): string {
  if (!RECORD) {
    return "00000000-0000-4000-8000-000000000003";
  }
  const team = process.env["SLOPWEAVER_RECORD_LINEAR_TEAM"];
  if (team === undefined || team.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_LINEAR_TEAM to the team UUID to create the test project in");
  }
  return team;
}

/** Every string is a LITERAL — no clock, no random — so the request is byte-identical at record and replay
 * time. Visibly a test artefact so a failed cleanup announces what it is and where it came from. */
const PROJECT_FORM: LinearProjectForm = {
  fields: {
    description: "auto-created and auto-deleted by src/__tests__/integration/linearProjectUpdateWrite.test.ts",
    name: "[slopweaver integration test] project-update destination gen2 (auto-deleted)",
    teamIds: [linearTeam()],
  },
};

/** The report itself: a capped one-line lead, with detail and evidence folded beneath it. */
function updateForm({ projectId }: { projectId: string }): LinearProjectUpdateForm {
  return {
    artifact: {
      detail: [{ kind: "para", text: "Posted at a caller-chosen id, so a lost response is settled by a read-back." }],
      evidence: [{ label: "the seam under test", url: "https://example.test/linear/project-update-seam" }],
      summary: "The project-update seam works: a capped lead, a declared health, and the detail folded.",
    },
    fields: { health: "atRisk", projectId },
  };
}

describe("linear project-update write (integration — real Linear via Polly cassette)", () => {
  it("posts a real status update at a caller-chosen id, reads it back, and deletes everything", async () => {
    const api = makeLinearWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      scheduler: (task) => task(),
      token: linearToken(),
    });
    const projectId = projectIntentId({ form: PROJECT_FORM });

    const createdProject = await api.createProject({
      id: projectId,
      input: { name: PROJECT_FORM.fields.name, teamIds: PROJECT_FORM.fields.teamIds },
    });
    expect(createdProject.isOk()).toBe(true);
    const projectIdentity = createdProject._unsafeUnwrap();
    expect(projectIdentity.id.length > 0).toBe(true);

    const form = updateForm({ projectId });
    const updateId = projectUpdateIntentId({ form });
    const posted = await api.createProjectUpdate({ id: updateId, input: projectUpdateInputFor({ form }) });
    expect(posted.isOk()).toBe(true);
    const updateIdentity = posted._unsafeUnwrap();
    expect(updateIdentity.id.length > 0).toBe(true);
    const readBack = await api.readProjectUpdate({ id: updateId });
    expect(readBack.isOk()).toBe(true);
    const found = readBack._unsafeUnwrap();
    // THE assertion this seam exists for: Linear STORED the health that was sent. It is read off the
    // read-back rather than the create, because `@linear/sdk`'s `ProjectUpdatePayload` echoes only an id —
    // which makes this a stronger check than it was, since it now reads what Linear kept rather than what it
    // acknowledged.
    expect(found!.health).toBe("atRisk");
    // It fails if the create silently did nothing, or if the read-back found a different object. It survives
    // redaction because both sides map through the same synthetic id.
    expect(found === undefined).toBe(false);
    expect(found!.id).toBe(updateIdentity.id);
    expect(found!.health).toBe("atRisk");

    // Cleanup, asserted rather than fired and forgotten. The update goes first: it lives inside the project.
    const deletedUpdate = await api.deleteProjectUpdate({ id: updateId });
    expect(deletedUpdate.isOk()).toBe(true);
    expect(deletedUpdate._unsafeUnwrap()).toBe(true);

    const deletedProject = await api.deleteProject({ id: projectId });
    expect(deletedProject.isOk()).toBe(true);
    expect(deletedProject._unsafeUnwrap()).toBe(true);
  });
});
