import { describe, expect, it } from "vitest";

import { readBoard } from "../../../components/live/read";
import { openedInContext } from "../../../lib/workstreamsContext";
import { ACME_PLACER } from "../../organisationFixture";
import { ACME_ADMIN_PR, board } from "./fixtures";

describe("workstreams — the slide-over opens only a row this workspace draws", () => {
  it("opens this workspace's row and a finding, and names the other workspace's row instead of drawing it", () => {
    expect(
      openedInContext({
        board: board(),
        context: "slopweaver",
        placer: ACME_PLACER,
        slug: "acme-console-pages-react-27-sep",
      }),
    ).toEqual({
      kind: "open",
      row: board().rows[1],
    });
    expect(
      openedInContext({ board: board(), context: "slopweaver", placer: ACME_PLACER, slug: "no-evidence" }),
    ).toEqual({
      kind: "open",
      row: board().rows[2],
    });
    expect(
      openedInContext({ board: board(), context: "slopweaver", placer: ACME_PLACER, slug: "iso-least-privilege" }),
    ).toEqual({
      kind: "elsewhere",
      slug: "iso-least-privilege",
    });
  });

  it("opens the clicked row of two sharing a slug, its own mark with it, and a link the first", () => {
    const twin = readBoard({
      rows: [
        { ...board().rows[1], slug: "dup" },
        { ...board().rows[1], prUrls: [ACME_ADMIN_PR], slug: "dup" },
      ],
      unresolved: 0,
    })!;
    expect(openedInContext({ at: 1, board: twin, context: "slopweaver", placer: ACME_PLACER, slug: "dup" })).toEqual({
      kind: "open",
      row: twin.rows[1],
    });
    expect(openedInContext({ board: twin, context: "slopweaver", placer: ACME_PLACER, slug: "dup" })).toEqual({
      kind: "open",
      row: twin.rows[0],
    });
    expect(
      openedInContext({ at: 0, board: board(), context: "slopweaver", placer: ACME_PLACER, slug: "no-evidence" }),
    ).toEqual({
      kind: "open",
      row: board().rows[2],
    });
    expect(
      openedInContext({
        at: 0,
        board: board(),
        context: "slopweaver",
        placer: ACME_PLACER,
        slug: "iso-least-privilege",
      }),
    ).toEqual({
      kind: "elsewhere",
      slug: "iso-least-privilege",
    });
  });

  it("opens nothing for no slug, or a slug on no row", () => {
    expect(openedInContext({ board: board(), context: "work", placer: ACME_PLACER, slug: undefined })).toEqual({
      kind: "none",
    });
    expect(openedInContext({ board: board(), context: "work", placer: ACME_PLACER, slug: "gone" })).toEqual({
      kind: "none",
    });
  });
});
