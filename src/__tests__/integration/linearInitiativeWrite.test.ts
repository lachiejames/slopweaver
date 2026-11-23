/**
 * INTEGRATION test: the Linear INITIATIVE lane — the object, the project link, and the status update posted
 * to it — against the REAL Linear GraphQL API, recorded + replayed via a Polly cassette.
 *
 * Three mutations that had no path through this door at all before, and the reason they are ONE cassette
 * rather than three is the reason they are one lane: an initiative with nothing under it and no report on it
 * is inert, so the sequence a caller actually performs is the sequence worth recording.
 *
 * Recording this CREATES A REAL INITIATIVE AND A REAL PROJECT in the real workspace, joins them, posts a
 * status update, and tears all of it down again. Same reasoning every other Linear write cassette states: a
 * throwaway workspace would be evidence of nothing.
 *
 * ## The sequence, and why each step is here
 *
 *   create initiative → update it → read back → create project → link project→initiative → read link back →
 *   post initiative update → read update back → archive update → delete link → delete project →
 *   delete initiative
 *
 * `initiativeCreate` alone proves nothing: `InitiativePayload.initiative` is `Maybe<Initiative>`, the same
 * false-success shape every parser in this repo's Linear lane guards against. The single read-back — placed
 * AFTER the update deliberately — establishes both that the object exists at the id we chose and that the
 * patch landed, because it finds `Active` where the create sent `Planned`. Two reads would not: this lane's
 * cassette matcher keys a GraphQL request on its normalised body with `order: false`, so two identical
 * `initiative(id:)` reads collapse onto one entry and the second replays the first's answer. The LINK is what the middle of this test is built around — its two
 * endpoints must be the initiative and the project this test created, which is the only thing that proves
 * `initiativeToProjectCreate` joined the pair the caller named rather than merely returning an edge.
 *
 * The update is ARCHIVED rather than deleted, and that is Linear's shape rather than a shortcut: the schema
 * ships `initiativeUpdateArchive` and no `initiativeUpdateDelete` at all. Every teardown is asserted rather
 * than fired and forgotten, for the reason the issue cassette records: an unrecorded teardown is how a
 * re-record leaves permanent litter in the real workspace.
 *
 * ## What may be asserted, and what may not
 *
 * Same constraint as every cassette here: the redactor blanks every non-allowlisted string, so no assertion
 * may depend on a value Linear echoes back as TEXT (`name`, `description`, the full `url`). What survives is
 * booleans, `health` and `state`-class allowlisted keys, and REFERENTIAL EQUALITY between an id one call
 * returns and the id a LATER call echoes back.
 *
 * Run:
 *   yarn test:integration                                                    # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_HOME=… \
 *     SLOPWEAVER_RECORD_LINEAR_TOKEN=lin_api_… \
 *     SLOPWEAVER_RECORD_LINEAR_TEAM=<team uuid> yarn test:integration        # (re)record — WRITES FOR REAL
 */
import { describe, expect, it } from "vitest";

import {
  initiativeInputFor,
  initiativeIntentId,
  initiativeLinkIntentId,
} from "../../cli/commands/linear/initiativeCore.js";
import { initiativeUpdateInputFor, initiativeUpdateIntentId } from "../../cli/commands/linear/initiativeUpdateCore.js";
import { projectIntentId } from "../../cli/commands/linear/projectCore.js";
import { makeLinearWriteApi } from "../../corpus/linear/write.js";
import { makeLinearInitiativeWriteApi } from "../../corpus/linear/writeInitiative.js";
import type {
  LinearInitiativeForm,
  LinearInitiativeLinkForm,
  LinearInitiativeUpdateForm,
} from "../../outbound/linear/initiativeTypes.js";
import type { LinearProjectForm } from "../../outbound/linear/projectTypes.js";
import { NO_TERMS_LINEAR_PRIVACY } from "../linearWritePrivacyFixture.js";

const RECORD = process.env["POLLY_MODE"] === "record";

function linearToken(): string {
  if (!RECORD) {
    return "lin_api_replay-not-real";
  }
  const token = process.env["SLOPWEAVER_RECORD_LINEAR_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_LINEAR_TOKEN to record the Linear initiative cassette");
  }
  return token;
}

/** Same reasoning as `linearProjectWrite.test.ts`'s `linearTeam`: a placeholder on replay, real when
 * recording — the cassette matcher collapses identifiers positionally, so both produce the same match key. */
function linearTeam(): string {
  if (!RECORD) {
    return "00000000-0000-4000-8000-000000000004";
  }
  const team = process.env["SLOPWEAVER_RECORD_LINEAR_TEAM"];
  if (team === undefined || team.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_LINEAR_TEAM to the team UUID to create the test project in");
  }
  return team;
}

/** Every string is a LITERAL — no clock, no random — so the request is byte-identical at record and replay
 * time. Visibly a test artefact so a failed cleanup announces what it is and where it came from. */
const INITIATIVE_FORM: LinearInitiativeForm = {
  fields: {
    description: "auto-created and auto-deleted by src/__tests__/integration/linearInitiativeWrite.test.ts",
    name: "[slopweaver integration test] initiative write seam probe gen4 (auto-deleted)",
    status: "Planned",
    targetDate: "2026-12-31",
  },
};

const PROJECT_FORM: LinearProjectForm = {
  fields: {
    name: "[slopweaver integration test] initiative link destination gen4 (auto-deleted)",
    teamIds: [linearTeam()],
  },
};

describe("linear initiative write (integration — real Linear via Polly cassette)", () => {
  it("creates an initiative, edits it, files a project under it, reports on it, and tears it all down", async () => {
    const api = makeLinearInitiativeWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      scheduler: (task) => task(),
      token: linearToken(),
    });
    // The PROJECT comes from the other lane's factory, exactly as production does: an initiative link joins
    // two objects this door already knows how to make, and using the real project seam here is what proves
    // the two lanes address the same workspace rather than two convenient fictions.
    const projectApi = makeLinearWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      scheduler: (task) => task(),
      token: linearToken(),
    });

    const initiativeId = initiativeIntentId({ form: INITIATIVE_FORM });
    const created = await api.createInitiative({
      id: initiativeId,
      input: initiativeInputFor({ fields: INITIATIVE_FORM.fields }),
    });
    expect(created.isOk()).toBe(true);
    const identity = created._unsafeUnwrap();
    // A Linear id is a real UUID live and a synthetic one once redacted — either way it is non-empty, and
    // that is the only claim about the VALUE itself that survives redaction.
    expect(identity.id.length > 0).toBe(true);

    const updated = await api.updateInitiative({ id: initiativeId, input: { status: "Active" } });
    expect(updated.isOk()).toBe(true);
    expect(updated._unsafeUnwrap().id).toBe(identity.id);

    // ONE read-back, after the update, and it carries BOTH claims. `setup-polly.ts` matches a GraphQL
    // request on its normalised body with `order: false`, so two identical `initiative(id:)` reads would
    // collapse onto one cassette entry and the second would replay the first's answer — a test that
    // "passed" while proving the patch never landed. Sequencing it this way is the fix, not a shortcut:
    // finding the object at the id we chose proves the CREATE landed, and finding `Active` where the create
    // sent `Planned` proves the UPDATE did.
    const readBack = await api.readInitiative({ id: initiativeId });
    expect(readBack.isOk()).toBe(true);
    const found = readBack._unsafeUnwrap();
    expect(found === undefined).toBe(false);
    expect(found!.id).toBe(identity.id);
    // `status` is allowlisted structural, so the value Linear STORED is assertable where a name is not.
    expect(found!.status).toBe("Active");

    const projectId = projectIntentId({ form: PROJECT_FORM });
    const createdProject = await projectApi.createProject({
      id: projectId,
      input: { name: PROJECT_FORM.fields.name, teamIds: PROJECT_FORM.fields.teamIds },
    });
    expect(createdProject.isOk()).toBe(true);
    const projectIdentity = createdProject._unsafeUnwrap();

    const linkForm: LinearInitiativeLinkForm = { fields: { initiativeId, projectId } };
    const linkId = initiativeLinkIntentId({ form: linkForm });
    const linked = await api.createInitiativeLink({ id: linkId, input: { initiativeId, projectId } });
    expect(linked.isOk()).toBe(true);
    // THE link assertion, and the reason the project is created rather than stubbed: both endpoints resolve
    // to the two objects this test made, which is the whole meaning of filing a project under an initiative.
    // It is made on the READ-BACK rather than the create's echo, because the SDK's `InitiativeToProjectPayload`
    // returns the edge as a bare id — so this now checks what Linear KEPT rather than what it acknowledged.
    const readLink = await api.readInitiativeLink({ id: linkId });
    expect(readLink.isOk()).toBe(true);
    expect(readLink._unsafeUnwrap()!.initiativeId).toBe(identity.id);
    expect(readLink._unsafeUnwrap()!.projectId).toBe(projectIdentity.id);

    const updateForm: LinearInitiativeUpdateForm = {
      artifact: {
        detail: [{ kind: "para", text: "One project is filed under it, and this report proves the seam." }],
        summary: "The initiative-update seam works: a capped lead, a declared health, and the detail folded.",
      },
      fields: { health: "onTrack", initiativeId },
    };
    const updateId = initiativeUpdateIntentId({ form: updateForm });
    const posted = await api.createInitiativeUpdate({
      id: updateId,
      input: initiativeUpdateInputFor({ form: updateForm }),
    });
    expect(posted.isOk()).toBe(true);

    // Linear STORED the health that was sent. The verb reports this value rather than the one the form asked
    // for, so a provider storing something else surfaces here and nowhere else. Read back rather than taken
    // from the create's echo, which under the SDK's `InitiativeUpdatePayload` is a bare id.
    const readUpdate = await api.readInitiativeUpdate({ id: updateId });
    expect(readUpdate.isOk()).toBe(true);
    expect(readUpdate._unsafeUnwrap()!.id).toBe(posted._unsafeUnwrap().id);
    expect(readUpdate._unsafeUnwrap()!.health).toBe("onTrack");

    // Teardown, innermost first, every step asserted. The update is ARCHIVED because that is the only
    // teardown Linear ships for the kind — there is no `initiativeUpdateDelete` in the schema at all.
    const archived = await api.archiveInitiativeUpdate({ id: updateId });
    expect(archived.isOk()).toBe(true);
    expect(archived._unsafeUnwrap()).toBe(true);

    const unlinked = await api.deleteInitiativeLink({ id: linkId });
    expect(unlinked.isOk()).toBe(true);
    expect(unlinked._unsafeUnwrap()).toBe(true);

    const deletedProject = await projectApi.deleteProject({ id: projectId });
    expect(deletedProject.isOk()).toBe(true);
    expect(deletedProject._unsafeUnwrap()).toBe(true);

    const deletedInitiative = await api.deleteInitiative({ id: initiativeId });
    expect(deletedInitiative.isOk()).toBe(true);
    expect(deletedInitiative._unsafeUnwrap()).toBe(true);
  });
});
