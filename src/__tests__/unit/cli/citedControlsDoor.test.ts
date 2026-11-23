import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { citedControlsVerdictFor, linkedCardOrRefusals } from "../../../cli/citedControlsDoor.js";
import { buildHatchGrant } from "../../../hatch/grant.js";
import { appendHatchGrant } from "../../../hatch/grantStore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { DetailBlock, InlineRun, UpdateArtifact } from "../../../outbound/artifact/types.js";
import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";
import { grantSessionEnv, TEST_GRANT_SESSION } from "../../hatchGrantFixture.js";

const HRS_52_URL = "https://app.vanta.com/c/acme/controls?controlId=0syn0002";
const DCH_108_URL = "https://app.vanta.com/c/acme/controls?controlId=0syn0001";

const CONTEXT: BareRefContext = {
  complianceControls: [
    { id: "HRS-52", url: HRS_52_URL },
    { id: "DCH-108", url: DCH_108_URL },
  ],
  linearTeamKeys: ["SECU", "SUP", "OPS"],
  linearWorkspaceSlug: "acme",
  repos: [],
};

const NOW = "2026-09-18T11:00:00.000Z";

/** A card carrying the given detail blocks and citations, with everything else at its empty default. */
function card({
  detail,
  citations = [],
  index = [],
}: {
  detail: readonly DetailBlock[];
  citations?: UpdateArtifact["citations"];
  index?: readonly (readonly InlineRun[])[];
}): UpdateArtifact {
  return { citations, detail, index, kind: "update", media: [], tldr: "a card" };
}

/** A paragraph of the given runs. */
function paragraph({ runs }: { runs: readonly InlineRun[] }): DetailBlock {
  return { runs, type: "paragraph" };
}

describe("citedControlsVerdictFor", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cited-controls-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses the bot-card path that used to send fifteen uncited controls", () => {
    const verdict = citedControlsVerdictFor({
      artifact: card({
        detail: [paragraph({ runs: [{ text: "HRS-52 and DCH-108 are the next two", type: "text" }] })],
      }),
      context: CONTEXT,
      env: {},
      home,
      nowIso: NOW,
    });
    expect(verdict.refusals.length).toBe(2);
    expect(verdict.refusals[0]).toContain('"HRS-52" is named here with no citation');
    expect(verdict.refusals[1]).toContain('"DCH-108" is named here with no citation');
  });

  it("points at `detail`, the field this FORM has, never the answer arm's `body`", () => {
    const verdict = citedControlsVerdictFor({
      artifact: card({ detail: [paragraph({ runs: [{ text: "HRS-52 is close", type: "text" }] })] }),
      context: CONTEXT,
      env: {},
      home,
      nowIso: NOW,
    });
    expect(verdict.refusals[0]!.startsWith("detail.0: ")).toBe(true);
  });

  it("accepts a control cited in its own item by that control's own page", () => {
    const verdict = citedControlsVerdictFor({
      artifact: card({
        citations: [{ id: "c1", label: "[1]", url: HRS_52_URL }],
        detail: [
          paragraph({
            runs: [
              { label: "HRS-52", type: "link", url: HRS_52_URL },
              { text: " is close ", type: "text" },
              { citationId: "c1", type: "citation" },
            ],
          }),
        ],
      }),
      context: CONTEXT,
      env: {},
      home,
      nowIso: NOW,
    });
    expect(verdict.refusals).toEqual([]);
  });

  it("checks the above-the-fold index too, where a ranked card puts its rows", () => {
    const verdict = citedControlsVerdictFor({
      artifact: card({
        detail: [paragraph({ runs: [{ text: "the two nearest wins", type: "text" }] })],
        index: [[{ text: "DCH-108 needs one document", type: "text" }]],
      }),
      context: CONTEXT,
      env: {},
      home,
      nowIso: NOW,
    });
    expect(verdict.refusals.length).toBe(1);
    expect(verdict.refusals[0]!.startsWith("index.0: ")).toBe(true);
  });

  it("leaves a routine briefing card alone, which is why rule TWO is not wired here", () => {
    const verdict = citedControlsVerdictFor({
      artifact: card({
        detail: [paragraph({ runs: [{ text: "SECU-101, SUP-102 and OPS-104 all moved", type: "text" }] })],
      }),
      context: CONTEXT,
      env: {},
      home,
      nowIso: NOW,
    });
    expect(verdict.refusals).toEqual([]);
  });

  it("says nothing at all under this session's live uncited-controls grant", () => {
    appendHatchGrant({
      grant: buildHatchGrant({
        claudeSessionId: TEST_GRANT_SESSION,
        hatchId: "uncited-controls",
        issuedAtIso: NOW,
        reason: "quoting the control list verbatim",
      }),
      home,
    });
    const verdict = citedControlsVerdictFor({
      artifact: card({
        detail: [paragraph({ runs: [{ text: "HRS-52 and DCH-108 are the next two", type: "text" }] })],
      }),
      context: CONTEXT,
      env: grantSessionEnv({ home }),
      home,
      nowIso: NOW,
    });
    expect(verdict.refusals).toEqual([]);
  });

  it("still refuses with the retired variable set and no grant, because a variable leaves no journal row", () => {
    const verdict = citedControlsVerdictFor({
      artifact: card({
        detail: [paragraph({ runs: [{ text: "HRS-52 and DCH-108 are the next two", type: "text" }] })],
      }),
      context: CONTEXT,
      env: { ...grantSessionEnv({ home }), SLOPWEAVER_ALLOW_UNCITED_CONTROLS: "1" },
      home,
      nowIso: NOW,
    });
    expect(verdict.refusals.length).toBe(2);
  });
});

describe("linkedCardOrRefusals", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "linked-card-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses an unresolvable bare reference BEFORE it judges any control mention", () => {
    const result = linkedCardOrRefusals({
      // The bare number in this text resolves against no repo — CONTEXT declares none — so it is what survives linkifying.
      artifact: card({ detail: [paragraph({ runs: [{ text: "HRS-52 blocks #412", type: "text" }] })] }),
      context: CONTEXT,
      env: {},
      home,
      nowIso: NOW,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).length).toBe(1);
    expect(unwrapErr(result)[0]).toContain("#412");
  });

  it("returns the LINKIFIED card, so the control rule judged what the reader will meet", () => {
    const result = linkedCardOrRefusals({
      artifact: card({
        citations: [{ id: "c1", label: "[1]", url: HRS_52_URL }],
        detail: [
          paragraph({
            runs: [
              { text: "HRS-52 is close ", type: "text" },
              { citationId: "c1", type: "citation" },
            ],
          }),
        ],
      }),
      context: CONTEXT,
      env: {},
      home,
      nowIso: NOW,
    });
    expect(result.isOk()).toBe(true);
    const block = unwrap(result).detail[0]!;
    expect(block.type).toBe("paragraph");
    expect(JSON.stringify(block)).toContain(HRS_52_URL);
  });
});
