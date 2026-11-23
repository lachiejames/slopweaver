/**
 * The repository, Linear workspace and records a card resolves a bare number or key against. Every Datadog host in
 * this file reads the synthetic `ap1` site rather than the install's own.
 */
import { describe, expect, it } from "vitest";

import {
  boardJsonDocument,
  boardJsonRow,
  NO_BOARD_REFERENCES,
  NO_DETACHED_FINDINGS,
} from "../../../../cli/commands/handover/listJson.js";
import { boardPrSteerRows } from "../../../../cli/commands/handover/listJsonPrSteers.js";
import { referenceContextOf } from "../../../../cli/commands/handover/referenceContext.js";
import { boardRowJsonText } from "../../../../cli/commands/handover/rowJson.js";
import { EMPTY_TAG_FILTER } from "../../../../handover/tagFilter.js";
import { doc, modelsFor, OBSERVED, SCAN_STARTED } from "./fixtures.js";

describe("the references a card resolves a bare number or key against", () => {
  const monitor = {
    id: "50001",
    kind: "datadog-monitor",
    title: "[ERROR] {{service.name}}",
    url: "https://ap1.datadoghq.com/monitors/50001",
  } as const;
  const references = {
    linear: { teamKeys: ["SECU"], workspaceSlug: "acme" },
    ownerNames: new Set<string>(),
    records: [monitor],
    repoSlugs: new Map([["/w/repo", "acme/acme-admin"]]),
  };
  const context = { linearTeamKeys: ["SECU"], linearWorkspaceSlug: "acme", records: [monitor] };

  it("publishes each row's repository as owner/repo, and the install's Linear workspace once", () => {
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [doc({ kind: "ask", slug: "acme-booking-draft-16406" })] }),
      observedAtIso: OBSERVED,
      references,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });

    expect(document.rows.map((row) => row.repoSlug)).toEqual(["acme/acme-admin"]);
    expect(document.referenceContext).toEqual(context);
  });

  it("prints the Linear facts and the records in the one wire shape both producers share", () => {
    expect(referenceContextOf(references)).toEqual(context);
    expect(referenceContextOf(NO_BOARD_REFERENCES)).toEqual({
      linearTeamKeys: [],
      linearWorkspaceSlug: undefined,
      records: [],
    });
  });

  it("publishes the workspace a row states, and none for a row that states none", () => {
    const [stated, bare] = modelsFor({
      docs: [{ ...doc({ slug: "iso" }), workspace: "team" }, doc({ slug: "bare" })],
    });

    expect(
      boardJsonRow({ model: stated!, ownerNames: new Set(), prSteers: undefined, repoSlugs: new Map() }).workspace,
    ).toBe("team");
    expect(
      boardJsonRow({ model: bare!, ownerNames: new Set(), prSteers: undefined, repoSlugs: new Map() }).workspace,
    ).toBeUndefined();
  });

  it("publishes every pull request the row names now, the set a proof verdict is checked against", () => {
    const [named, bare] = modelsFor({
      docs: [
        {
          ...doc({ slug: "named" }),
          summary: "turn https://github.com/Acme/acme-admin/pull/17564 into the switch",
        },
        doc({ slug: "bare" }),
      ],
    });

    expect(
      boardJsonRow({ model: named!, ownerNames: new Set(), prSteers: undefined, repoSlugs: new Map() }).prNamed,
    ).toEqual(["acme/acme-admin#17564"]);
    expect(
      boardJsonRow({ model: bare!, ownerNames: new Set(), prSteers: undefined, repoSlugs: new Map() }).prNamed,
    ).toEqual([]);
  });

  it("hands the pull-request fold each row's slug and the summary a pull request is written into", () => {
    const models = modelsFor({
      docs: [
        { ...doc({ slug: "named" }), summary: "turn acme/acme-admin#17564 into the switch" },
        doc({ slug: "bare" }),
      ],
    });
    const rows = boardPrSteerRows({ models, repoSlugs: new Map() });

    expect(rows.map((row) => row.slug)).toEqual(["named", "bare"]);
    expect(rows[0]!.texts).toContain("turn acme/acme-admin#17564 into the switch");
    expect(rows[0]!.repoSlug).toBeUndefined();
  });

  it("leaves a row whose path has no origin without a repository", () => {
    const [model] = modelsFor({ docs: [doc({ slug: "loose" })] });

    expect(
      boardJsonRow({ model: model!, ownerNames: new Set(), prSteers: undefined, repoSlugs: new Map() }).repoSlug,
    ).toBeUndefined();
  });

  it("prints the same repository and Linear workspace on the one row `handover row --json` prints", () => {
    const [model] = modelsFor({ docs: [doc({ slug: "one" })] });
    const printed = JSON.parse(boardRowJsonText({ model: model!, references, repoLargestPull: 18075 })) as Record<
      string,
      unknown
    >;

    expect(printed["repoSlug"]).toBe("acme/acme-admin");
    expect(printed["repoLargestPull"]).toBe(18075);
    expect(printed["referenceContext"]).toEqual(context);
  });

  it("prints no repoLargestPull for a row whose checkout attests none", () => {
    const [model] = modelsFor({ docs: [doc({ slug: "one" })] });
    const printed = JSON.parse(boardRowJsonText({ model: model!, references, repoLargestPull: undefined })) as Record<
      string,
      unknown
    >;

    expect(Object.keys(printed).includes("repoLargestPull")).toBe(false);
  });
});
