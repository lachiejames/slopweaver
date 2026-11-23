/**
 * The owner's words about a pull request travel to every row naming it exactly, and to no row that merely looks alike.
 */
import { describe, expect, it } from "vitest";

import type { HisWords } from "../../../handover/hisWords.js";
import { type PrSteerRow, prIdentitiesIn, prSteersByRow } from "../../../handover/prSteers.js";

/** A quote of the owner's, synthetic words. */
function quote({ words, anchor }: { words: string; anchor: string }): HisWords {
  return { anchor, atIso: "2026-09-25T02:41:26.704Z", cut: "none", where: "console-voice", words };
}

const PROOF_ASK = quote({ anchor: "talk:proof", words: "show a before and after with screenshots" });
const LOCAL_AND_CI = quote({ anchor: "talk:ci", words: "it has to pass on a laptop and in CI alike" });

/** A row with defaults a case overrides. */
function row(over: Partial<PrSteerRow> & { slug: string }): PrSteerRow {
  return { quotes: [], repoSlug: undefined, texts: [], ...over };
}

describe("prIdentitiesIn", () => {
  it("reads a URL and an explicit owner/repo#N, lowercased", () => {
    expect(
      prIdentitiesIn({
        repoSlug: undefined,
        texts: ["see https://github.com/Acme/acme-admin/pull/17564 and acme/other#12"],
      }),
    ).toEqual(["acme/acme-admin#17564", "acme/other#12"]);
  });

  it("reads a bare #N and PR N only against the row's resolved repository", () => {
    expect(prIdentitiesIn({ repoSlug: "acme/acme-admin", texts: ["acme-admin #17564, then PR 16339"] })).toEqual([
      "acme/acme-admin#17564",
      "acme/acme-admin#16339",
    ]);
    expect(prIdentitiesIn({ repoSlug: undefined, texts: ["acme-admin #17564, then PR 16339"] })).toEqual([]);
  });

  it("reads nothing from a plain number, a slug or a dotted spelling", () => {
    expect(
      prIdentitiesIn({
        repoSlug: "acme/acme-admin",
        texts: ["17564 approved", "acme-admin-17564-gets-before-and-after-proof", ".17564... is approved"],
      }),
    ).toEqual([]);
  });

  it("reads no pull request out of a paste placeholder's attachment number", () => {
    expect(
      prIdentitiesIn({
        repoSlug: "lachiejames/slopweaver",
        texts: ["[Image #43] [Image #44] looks sick", "[Pasted text #2 +40 lines] and PR #97"],
      }),
    ).toEqual(["lachiejames/slopweaver#97"]);
  });

  it("never reads a short pull request number out of a longer one", () => {
    expect(prIdentitiesIn({ repoSlug: undefined, texts: ["https://github.com/o/r/pull/123"] })).toEqual(["o/r#123"]);
  });
});

describe("prSteersByRow", () => {
  it("carries the owner's words from another row naming the same pull request", () => {
    const steers = prSteersByRow({
      rows: [
        row({ quotes: [PROOF_ASK], slug: "proof-row", texts: ["https://github.com/acme/acme-admin/pull/17564"] }),
        row({ repoSlug: "acme/acme-admin", slug: "card-row", texts: ["acme-admin #17564"] }),
      ],
    });
    expect(steers[1]).toEqual([{ identity: "acme/acme-admin#17564", quote: PROOF_ASK, rowSlug: "proof-row" }]);
    expect(steers[0]).toEqual([]);
  });

  it("never carries words across a different repository with the same number", () => {
    const steers = prSteersByRow({
      rows: [
        row({ quotes: [PROOF_ASK], slug: "other-repo", texts: ["https://github.com/acme/other/pull/17564"] }),
        row({ slug: "card-row", texts: ["https://github.com/acme/acme-admin/pull/17564"] }),
      ],
    });
    expect(steers[1]).toEqual([]);
  });

  it("never carries words from a row naming the number with no repository", () => {
    const steers = prSteersByRow({
      rows: [
        row({ quotes: [LOCAL_AND_CI], slug: "relay", texts: ["#17564 approved"] }),
        row({ slug: "card-row", texts: ["https://github.com/acme/acme-admin/pull/17564"] }),
      ],
    });
    expect(steers[1]).toEqual([]);
  });

  it("carries a quote several rows copied once, and none the row already stores", () => {
    const url = "https://github.com/acme/acme-admin/pull/17564";
    const steers = prSteersByRow({
      rows: [
        row({ quotes: [PROOF_ASK, LOCAL_AND_CI], slug: "first", texts: [url] }),
        row({ quotes: [PROOF_ASK], slug: "second", texts: [url] }),
        row({ quotes: [LOCAL_AND_CI], slug: "card-row", texts: [url] }),
      ],
    });
    expect(steers[2]).toEqual([{ identity: "acme/acme-admin#17564", quote: PROOF_ASK, rowSlug: "first" }]);
    expect(steers[1]).toEqual([{ identity: "acme/acme-admin#17564", quote: LOCAL_AND_CI, rowSlug: "first" }]);
  });

  it("carries a quote from a row naming several pull requests only to the one its own words name", () => {
    const named = quote({ anchor: "talk:named", words: "on acme/acme-admin#17564 I want screenshots" });
    const steers = prSteersByRow({
      rows: [
        row({
          quotes: [PROOF_ASK, named],
          slug: "handoff",
          texts: ["acme/acme-admin#17564 and acme/acme-admin#16339"],
        }),
        row({ slug: "card-17564", texts: ["https://github.com/acme/acme-admin/pull/17564"] }),
        row({ slug: "card-16339", texts: ["https://github.com/acme/acme-admin/pull/16339"] }),
      ],
    });
    expect(steers[1]).toEqual([{ identity: "acme/acme-admin#17564", quote: named, rowSlug: "handoff" }]);
    expect(steers[2]).toEqual([]);
  });

  it("gives two rows sharing a slug each their own pull request's words", () => {
    const steers = prSteersByRow({
      rows: [
        row({ quotes: [PROOF_ASK], slug: "source-1", texts: ["acme/app#1"] }),
        row({ quotes: [LOCAL_AND_CI], slug: "source-2", texts: ["acme/app#2"] }),
        row({ slug: "duplicate", texts: ["acme/app#1"] }),
        row({ slug: "duplicate", texts: ["acme/app#2"] }),
      ],
    });
    expect([steers[2], steers[3]]).toEqual([
      [{ identity: "acme/app#1", quote: PROOF_ASK, rowSlug: "source-1" }],
      [{ identity: "acme/app#2", quote: LOCAL_AND_CI, rowSlug: "source-2" }],
    ]);
  });

  it("carries a quote between two rows sharing a slug", () => {
    const steers = prSteersByRow({
      rows: [
        row({ quotes: [PROOF_ASK], slug: "duplicate", texts: ["acme/app#1"] }),
        row({ slug: "duplicate", texts: ["acme/app#1"] }),
      ],
    });
    expect(steers).toEqual([[], [{ identity: "acme/app#1", quote: PROOF_ASK, rowSlug: "duplicate" }]]);
  });

  it("maps a row naming no pull request to no steers", () => {
    expect(prSteersByRow({ rows: [row({ quotes: [PROOF_ASK], slug: "lonely" })] })[0]).toEqual([]);
  });
});
