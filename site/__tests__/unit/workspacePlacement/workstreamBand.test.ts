import { describe, expect, it } from "vitest";

import { type Board, readBoard } from "../../../components/live/read";
import { type WorkspacePlacement } from "../../../lib/workspacePlacement";
import { findingLabel } from "../../../lib/workspacePlacementContext";
import { workstreamsInContext } from "../../../lib/workstreamsContext";
import { ACME_PLACER } from "../../organisationFixture";
import { ACME_ADMIN_PR, BOARD_ROW } from "./fixtures";

describe("the Queue's workstream band — each workspace folds only its own rows", () => {
  const tag = ({ value }: { value: string }): Record<string, unknown> => ({
    tags: [{ key: "workstream", source: "declared", value }],
  });
  const tagged = (): Board =>
    readBoard({
      rows: [
        { ...BOARD_ROW, prUrls: [ACME_ADMIN_PR], slug: "iso-least-privilege", ...tag({ value: "iso" }) },
        { ...BOARD_ROW, slug: "console-pages", workspace: "self", ...tag({ value: "console" }) },
        { ...BOARD_ROW, slug: "no-evidence", ...tag({ value: "console" }) },
        { ...BOARD_ROW, section: "DONE", slug: "done-no-evidence", ...tag({ value: "iso" }) },
      ],
      unresolved: 0,
    })!;

  it("folds self's streams from self's rows, and counts the one OPEN finding in neither", () => {
    const narrowed = workstreamsInContext({ board: tagged(), context: "slopweaver", nowMs: 0, placer: ACME_PLACER });
    expect(narrowed.folded.workstreams.map((stream) => [stream.name, stream.rowSlugs])).toEqual([
      ["console", ["console-pages"]],
    ]);
    expect(narrowed.findings).toBe(1);
  });

  it("names each folded row a stated workspace placed over a conflict, so the band marks it", () => {
    const stated = readBoard({
      rows: [
        {
          ...BOARD_ROW,
          prUrls: [ACME_ADMIN_PR],
          slug: "settled",
          workspace: "self",
          ...tag({ value: "console" }),
        },
        { ...BOARD_ROW, slug: "console-pages", workspace: "self", ...tag({ value: "console" }) },
      ],
      unresolved: 0,
    })!;
    const narrowed = workstreamsInContext({ board: stated, context: "slopweaver", nowMs: 0, placer: ACME_PLACER });
    expect([...narrowed.stated.keys()]).toEqual(["settled"]);
    expect(narrowed.stated.get("settled")!.map((placement) => findingLabel({ placement })!.label)).toEqual([
      "stated over a conflict",
    ]);
    expect(workstreamsInContext({ board: stated, context: "work", nowMs: 0, placer: ACME_PLACER }).stated.size).toBe(0);
  });

  it("keeps each same-slug row's own mark, so a second row never absorbs the first's overruled address", () => {
    const twice = readBoard({
      rows: [
        { ...BOARD_ROW, prUrls: [ACME_ADMIN_PR], slug: "dup", workspace: "self", ...tag({ value: "console" }) },
        {
          ...BOARD_ROW,
          prUrls: ["https://github.com/acme/infra/pull/2"],
          slug: "dup",
          workspace: "self",
          ...tag({ value: "console" }),
        },
      ],
      unresolved: 0,
    })!;
    const narrowed = workstreamsInContext({ board: twice, context: "slopweaver", nowMs: 0, placer: ACME_PLACER });
    const over = ({ repo }: { repo: string }): WorkspacePlacement => ({
      by: [{ source: "stated", value: "self", workspace: "self" }],
      kind: "placed",
      overruled: [{ source: "repository", value: repo, workspace: "team" }],
      workspace: "self",
    });
    expect(narrowed.stated.get("dup")).toEqual([over({ repo: "acme/acme-admin" }), over({ repo: "acme/infra" })]);
  });

  it("folds team's from team's, with no self row in any stream and no finding counted", () => {
    const narrowed = workstreamsInContext({ board: tagged(), context: "work", nowMs: 0, placer: ACME_PLACER });
    expect(narrowed.folded.workstreams.map((stream) => [stream.name, stream.rowSlugs])).toEqual([
      ["iso", ["iso-least-privilege"]],
    ]);
    expect(narrowed.findings).toBe(0);
  });
});
