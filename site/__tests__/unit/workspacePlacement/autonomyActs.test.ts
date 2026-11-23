import { describe, expect, it } from "vitest";

import { indexBoardRows } from "../../../lib/boardRowIndex";
import { actPlacement, type PlacedBoardFields } from "../../../lib/registerPlacement";
import { type WorkspacePlacement } from "../../../lib/workspacePlacement";
import { ACME_PLACER } from "../../organisationFixture";
import { ACME_ADMIN_PR, acmeBy, BARE, SLOPWEAVER_PR } from "./fixtures";

describe("autonomy acts", () => {
  it("places an act by the pull request its subject leads with, never by the prose after it", () => {
    expect(
      actPlacement({
        act: { kind: "press-merge-when-ready", run: undefined, subject: `${ACME_ADMIN_PR} slopweaver asked for it` },
        board: indexBoardRows({ rows: [] }),
        placer: ACME_PLACER,
      }),
    ).toEqual(acmeBy({ source: "repository", value: "acme/acme-admin" }));
  });

  it("places an owner/repo#n subject, and a state: subject in self", () => {
    expect(
      actPlacement({
        act: { kind: "press-merge-when-ready", run: undefined, subject: "acme/acme-admin#17870" },
        board: indexBoardRows({ rows: [] }),
        placer: ACME_PLACER,
      }).kind,
    ).toBe("placed");
    expect(
      actPlacement({
        act: { kind: "press-merge-when-ready", run: undefined, subject: "state:recipes/tick.json" },
        board: indexBoardRows({ rows: [] }),
        placer: ACME_PLACER,
      }),
    ).toEqual({
      by: [{ source: "installation-state", value: "state:", workspace: "self" }],
      kind: "placed",
      workspace: "self",
    });
  });

  it("joins the board row its subject or run names", () => {
    const row: PlacedBoardFields = { ...BARE, prUrls: [ACME_ADMIN_PR], slug: "dependabot-medium-low-sla" };
    expect(
      actPlacement({
        act: { kind: "press-merge-when-ready", run: "dependabot-medium-low-sla", subject: "pressed merge" },
        board: indexBoardRows({ rows: [row] }),
        placer: ACME_PLACER,
      }),
    ).toEqual({
      by: [
        { source: "board-row", value: "dependabot-medium-low-sla", workspace: "team" },
        { source: "repository", value: "acme/acme-admin", workspace: "team" },
      ],
      kind: "placed",
      workspace: "team",
    });
  });

  it("reads the joined rows in board order, whichever of its subject or run names each", () => {
    const run: PlacedBoardFields = { ...BARE, prUrls: [ACME_ADMIN_PR], slug: "the-run" };
    const between: PlacedBoardFields = { ...BARE, prUrls: [ACME_ADMIN_PR], slug: "unrelated" };
    const named: PlacedBoardFields = { ...BARE, prUrls: [SLOPWEAVER_PR], slug: "the-subject" };
    expect(
      actPlacement({
        act: { kind: "press-merge-when-ready", run: "the-run", subject: "the-subject pressed" },
        board: indexBoardRows({ rows: [run, between, named] }),
        placer: ACME_PLACER,
      }),
    ).toEqual({
      evidence: [
        { source: "board-row", value: "the-run", workspace: "team" },
        { source: "repository", value: "acme/acme-admin", workspace: "team" },
        { source: "board-row", value: "the-subject", workspace: "self" },
        { source: "repository", value: "octo-self/slopweaver", workspace: "self" },
      ],
      kind: "conflict",
    });
  });

  it("indexes the rows as they stood, so a caller changing its own array later moves nothing", () => {
    const rows: PlacedBoardFields[] = [{ ...BARE, prUrls: [ACME_ADMIN_PR], slug: "a" }];
    const indexed = indexBoardRows({ rows });
    rows[0] = { ...BARE, prUrls: [SLOPWEAVER_PR], slug: "a" };
    rows.push({ ...BARE, prUrls: [SLOPWEAVER_PR], slug: "b" });
    const placedBy = ({ subject }: { subject: string }): WorkspacePlacement =>
      actPlacement({
        act: { kind: "press-merge-when-ready", run: undefined, subject },
        board: indexed,
        placer: ACME_PLACER,
      });
    expect(placedBy({ subject: "a" })).toEqual({
      by: [
        { source: "board-row", value: "a", workspace: "team" },
        { source: "repository", value: "acme/acme-admin", workspace: "team" },
      ],
      kind: "placed",
      workspace: "team",
    });
    expect(placedBy({ subject: "b" }).kind).toBe("unplaced");
  });

  it("places a console URL subject in self — localhost is this installation", () => {
    expect(
      actPlacement({
        act: { kind: "restart-dev-server", run: undefined, subject: "http://localhost:3000" },
        board: indexBoardRows({ rows: [] }),
        placer: ACME_PLACER,
      }),
    ).toEqual({
      by: [{ source: "installation-state", value: "localhost:3000", workspace: "self" }],
      kind: "placed",
      workspace: "self",
    });
  });

  it("places every spelling of this machine alike: the root dot, IPv6, any IPv4 loopback", () => {
    const placed = ({ subject }: { subject: string }): string =>
      actPlacement({
        act: { kind: "restart-dev-server", run: undefined, subject },
        board: indexBoardRows({ rows: [] }),
        placer: ACME_PLACER,
      }).kind;
    expect(placed({ subject: "http://localhost.:3000/queue" })).toBe("placed");
    expect(placed({ subject: "http://LOCALHOST:3000/queue" })).toBe("placed");
    expect(placed({ subject: "http://[::1]:3000/queue" })).toBe("placed");
    expect(placed({ subject: "http://127.0.0.2:3000/queue" })).toBe("placed");
    expect(placed({ subject: "http://128.0.0.1:3000/queue" })).toBe("unplaced");
  });

  it("reads an IPv4 host with its root dot, which the parser drops, as the address written", () => {
    const placed = ({ subject }: { subject: string }): string =>
      actPlacement({
        act: { kind: "press-merge-when-ready", run: undefined, subject },
        board: indexBoardRows({ rows: [] }),
        placer: ACME_PLACER,
      }).kind;
    expect(placed({ subject: "http://127.0.0.1.:3000/queue" })).toBe("placed");
    expect(placed({ subject: "http://127.0.0.1./queue" })).toBe("placed");
    expect(placed({ subject: "http://127.1:3000/queue" })).toBe("unplaced");
    expect(placed({ subject: "http://127.0.0.1..:3000/queue" })).toBe("unplaced");
  });

  it("places an internal finding pull request in self by its kind, whose recorder guarantees the repository", () => {
    expect(
      actPlacement({
        act: { kind: "open-internal-finding-pull-request", run: "machine-load-hold", subject: "machine-load-hold" },
        board: indexBoardRows({ rows: [] }),
        placer: ACME_PLACER,
      }),
    ).toEqual({
      by: [{ source: "act-kind", value: "open-internal-finding-pull-request", workspace: "self" }],
      kind: "placed",
      workspace: "self",
    });
  });

  it("places a Vanta document subject in team by the workspace its URL names", () => {
    expect(
      actPlacement({
        act: {
          kind: "file-compliance-evidence",
          run: undefined,
          subject: "https://app.vanta.com/c/acme/documents/x",
        },
        board: indexBoardRows({ rows: [] }),
        placer: ACME_PLACER,
      }),
    ).toEqual(acmeBy({ source: "vanta-workspace", value: "app.vanta.com/c/acme" }));
  });

  it("leaves a Gmail URL unplaced — it names no account", () => {
    expect(
      actPlacement({
        act: { kind: "gmail-archive", run: undefined, subject: "https://mail.google.com/mail/u/0/#all/18f" },
        board: indexBoardRows({ rows: [] }),
        placer: ACME_PLACER,
      }).kind,
    ).toBe("unplaced");
  });

  it("leaves a free-text subject unplaced, whatever workspace its words name", () => {
    expect(
      actPlacement({
        act: { kind: "press-merge-when-ready", run: undefined, subject: "tidied the Acme ISO notes" },
        board: indexBoardRows({ rows: [] }),
        placer: ACME_PLACER,
      }).kind,
    ).toBe("unplaced");
  });
});
