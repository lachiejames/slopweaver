/**
 * INTEGRATION test: the Linear DOCUMENT write seam against the REAL Linear GraphQL API, recorded + replayed via
 * a Polly cassette.
 *
 * Recording this CREATES A REAL PROJECT in the real workspace, writes a real document onto it, re-renders that
 * document, and deletes both again. Same reasoning every other Linear write cassette states: a throwaway
 * workspace would be evidence of nothing, so the only honest recording is against the workspace the product
 * actually targets.
 *
 * ## The sequence, and why each step is here
 *
 *   create project → create document → read back → update document → read back → delete document → delete project
 *
 * The project exists only to be a destination. Pointing a document at a real team project would put a test
 * page where colleagues read. `documentCreate` echoes only an id, so the first read-back is what establishes
 * the page exists at the id WE chose and hangs off the project the form named. The second read-back is the
 * update's whole proof: `linear document update` re-renders a page in place, so the page must still be at the
 * same id and still on the same project afterwards. Both deletes are asserted rather than fired and forgotten,
 * for the reason the issue cassette records: an unrecorded teardown is how a re-record leaves litter.
 *
 * ## What may be asserted, and what may not
 *
 * The redactor blanks every non-allowlisted string, so no assertion may depend on text Linear echoes back,
 * the document's `content` and `title` included. What survives is REFERENTIAL EQUALITY: the id a create
 * returns against the id a later read echoes, and the project id the create named against the parent the
 * read-back reports.
 *
 * Run:
 *   yarn test:integration                                                    # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_HOME=… \
 *     SLOPWEAVER_RECORD_LINEAR_TOKEN=lin_api_… \
 *     SLOPWEAVER_RECORD_LINEAR_TEAM=<team uuid> yarn test:integration        # (re)record — WRITES FOR REAL
 */
import { describe, expect, it } from "vitest";

import {
  documentCreateInputFor,
  documentIntentId,
  documentUpdateInputFor,
} from "../../cli/commands/linear/documentCore.js";
import { projectIntentId } from "../../cli/commands/linear/projectCore.js";
import { makeLinearWriteApi } from "../../corpus/linear/write.js";
import { makeLinearDocumentWriteApi } from "../../corpus/linear/writeDocument.js";
import type { LinearDocumentForm } from "../../outbound/linear/documentTypes.js";
import type { LinearProjectForm } from "../../outbound/linear/projectTypes.js";
import { NO_TERMS_LINEAR_PRIVACY } from "../linearWritePrivacyFixture.js";

const RECORD = process.env["POLLY_MODE"] === "record";

function linearToken(): string {
  if (!RECORD) {
    return "lin_api_replay-not-real";
  }
  const token = process.env["SLOPWEAVER_RECORD_LINEAR_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_LINEAR_TOKEN to record the Linear document cassette");
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

/** Every string is a LITERAL, so the request is byte-identical at record and replay time. Visibly a test
 * artefact, so a failed cleanup announces what it is and where it came from. */
const PROJECT_FORM: LinearProjectForm = {
  fields: {
    description: "auto-created and auto-deleted by src/__tests__/integration/linearDocumentWrite.test.ts",
    name: "[slopweaver integration test] document destination (auto-deleted)",
    teamIds: [linearTeam()],
  },
};

/** The page as first written, and as re-rendered: same destination, different words. */
function documentForm({ projectId, revision }: { projectId: string; revision: string }): LinearDocumentForm {
  return {
    content: [
      { kind: "para", text: `The document seam works, ${revision}.` },
      { kind: "heading", text: "Why" },
      { items: [{ text: "Written at a caller-chosen id." }, { text: "Re-rendered in place." }], kind: "bullets" },
    ],
    fields: {
      destination: { id: projectId, kind: "project" },
      title: "[slopweaver integration test] document (auto-deleted)",
    },
  };
}

describe("linear document write (integration — real Linear via Polly cassette)", () => {
  it("writes a real document at a caller-chosen id, re-renders it in place, and deletes everything", async () => {
    const api = makeLinearWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      scheduler: (task) => task(),
      token: linearToken(),
    });
    const documents = makeLinearDocumentWriteApi({
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

    const first = documentForm({ projectId, revision: "first draft" });
    const documentId = documentIntentId({ form: first });
    const created = await documents.createDocument({ id: documentId, input: documentCreateInputFor({ form: first }) });
    expect(created.isOk()).toBe(true);
    const documentIdentity = created._unsafeUnwrap();

    const afterCreate = await documents.readDocument({ id: documentId });
    expect(afterCreate.isOk()).toBe(true);
    const createdPage = afterCreate._unsafeUnwrap();
    // The page is at the id we chose, and hangs off the project the form named rather than anything else.
    expect(createdPage === undefined).toBe(false);
    expect(createdPage!.id).toBe(documentIdentity.id);
    expect(createdPage!.projectId).toBe(projectIdentity.id);
    expect(createdPage!.issueId).toBe(undefined);
    expect(createdPage!.initiativeId).toBe(undefined);

    const second = documentForm({ projectId, revision: "second draft" });
    const updated = await documents.updateDocument({ id: documentId, input: documentUpdateInputFor({ form: second }) });
    expect(updated.isOk()).toBe(true);
    expect(updated._unsafeUnwrap().id).toBe(documentIdentity.id);

    const afterUpdate = await documents.readDocument({ id: documentId });
    expect(afterUpdate.isOk()).toBe(true);
    const updatedPage = afterUpdate._unsafeUnwrap();
    // Re-rendered IN PLACE: the same page, still on the same project.
    expect(updatedPage!.id).toBe(documentIdentity.id);
    expect(updatedPage!.projectId).toBe(projectIdentity.id);

    // Cleanup, asserted. The document goes first: it lives on the project.
    const deletedDocument = await documents.deleteDocument({ id: documentId });
    expect(deletedDocument.isOk()).toBe(true);
    expect(deletedDocument._unsafeUnwrap()).toBe(true);

    const deletedProject = await api.deleteProject({ id: projectId });
    expect(deletedProject.isOk()).toBe(true);
    expect(deletedProject._unsafeUnwrap()).toBe(true);
  });
});
