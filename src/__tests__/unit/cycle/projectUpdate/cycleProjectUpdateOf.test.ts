/*
 * `cycleProjectUpdateOf` — reading one bronze `update` line into a project update keyed to its project, by id or
 * by the slug id in a pre-SDK record's URL. It moved here when the project-update tests were split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { cycleProjectUpdateOf } from "../../../../cycle/projectHistory.js";

/** One bronze `update` line in the shape the SDK-era connector writes. */
const updateLine = ({
  id,
  projectId,
  createdAt,
  archivedAt = null,
}: {
  id: string;
  projectId: string;
  createdAt: string;
  archivedAt?: string | null;
}): string =>
  JSON.stringify({
    kind: "update",
    raw: { archivedAt, createdAt, id, project: { id: projectId } },
    sourceId: `projectUpdate:${id}`,
    tsIso: createdAt,
  });

describe("cycleProjectUpdateOf", () => {
  it("keys an update record to its project's own sourceId", () => {
    expect(
      cycleProjectUpdateOf({ line: updateLine({ createdAt: "2026-08-30T11:16:20.584Z", id: "u1", projectId: "p1" }) }),
    ).toEqual({
      createdAt: "2026-08-30T11:16:20.584Z",
      id: "projectUpdate:u1",
      projectId: "project:p1",
      projectSlugId: undefined,
    });
  });

  it("skips an archived update, which nobody watching the project sees", () => {
    const line = updateLine({
      archivedAt: "2026-09-01T00:00:00.000Z",
      createdAt: "2026-08-30T11:16:20.584Z",
      id: "u1",
      projectId: "p1",
    });
    expect(cycleProjectUpdateOf({ line })).toBe(undefined);
  });

  it("keys a pre-SDK update record, which names no project id, by the slug id in its URL", () => {
    const line = JSON.stringify({
      kind: "update",
      raw: { createdAt: "2026-06-01T00:00:00.000Z", id: "u0" },
      sourceId: "projectUpdate:u0",
      url: "https://linear.app/example/project/example-project-92f14fe7e9a9/activity#project-update-u0",
    });
    expect(cycleProjectUpdateOf({ line })).toEqual({
      createdAt: "2026-06-01T00:00:00.000Z",
      id: "projectUpdate:u0",
      projectId: undefined,
      projectSlugId: "92f14fe7e9a9",
    });
  });

  // Counterexample: a slug id that is not twelve hex characters was dropped.
  it("reads a slug id of any length, the last token of the project's path segment", () => {
    const line = JSON.stringify({
      kind: "update",
      raw: { createdAt: "2026-09-20T00:00:00.000Z", id: "u1" },
      sourceId: "projectUpdate:u1",
      url: "https://linear.app/acme/project/source-routing-abc123/activity#project-update-u1",
    });
    expect(cycleProjectUpdateOf({ line })!.projectSlugId).toBe("abc123");
  });

  it("skips an initiative update, which names no project and links none", () => {
    const line = JSON.stringify({
      kind: "update",
      raw: { createdAt: "2026-06-01T00:00:00.000Z", id: "i0" },
      sourceId: "initiativeUpdate:i0",
      url: "https://linear.app/example/initiative/growth-0123456789ab/updates#initiative-update-i0",
    });
    expect(cycleProjectUpdateOf({ line })).toBe(undefined);
  });

  // Counterexample: a compact-only pre-check refused a line the parse would have accepted.
  it("reads an update line whatever its JSON spacing", () => {
    const line =
      '{"kind": "update", "sourceId": "projectUpdate:u1", "raw": {"createdAt": "2026-09-20T00:00:00.000Z", "archivedAt": null, "project": {"id": "p1"}}}';
    expect(cycleProjectUpdateOf({ line })).toEqual({
      createdAt: "2026-09-20T00:00:00.000Z",
      id: "projectUpdate:u1",
      projectId: "project:p1",
      projectSlugId: undefined,
    });
  });

  // Counterexample: a `\u` escape spells the kind so no text pattern can see it.
  it("reads an update line whose kind is spelled with a unicode escape", () => {
    const line =
      '{"kind":"up\\u0064ate","sourceId":"projectUpdate:u1","raw":{"createdAt":"2026-09-20T00:00:00.000Z","archivedAt":null,"project":{"id":"p1"}}}';
    expect(cycleProjectUpdateOf({ line })).toEqual({
      createdAt: "2026-09-20T00:00:00.000Z",
      id: "projectUpdate:u1",
      projectId: "project:p1",
      projectSlugId: undefined,
    });
  });

  it("reads nothing from a project record", () => {
    const line = JSON.stringify({
      kind: "project",
      raw: { createdAt: "2026-06-01T00:00:00.000Z", project: { id: "p1" } },
      sourceId: "project:p1",
    });
    expect(cycleProjectUpdateOf({ line })).toBe(undefined);
  });
});
