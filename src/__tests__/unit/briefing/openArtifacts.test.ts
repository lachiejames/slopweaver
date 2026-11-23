import { describe, expect, it } from "vitest";

import { briefingErrorLines } from "../../../briefing/errors.js";
import {
  artifactValidity,
  type OpenArtifactReading,
  projectOpenArtifacts,
  rankOpenArtifacts,
} from "../../../briefing/openArtifacts.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { foldLockInLedger, type LockInRow, parseLockInRows } from "../../../sessionStart/lockIn.js";

const NOW = "2026-09-06T06:30:00Z";
const PAGE_A = "https://claude.ai/code/artifact/aaaaaaaa-0000-0000-0000-000000000000";
const PAGE_B = "https://claude.ai/code/artifact/bbbbbbbb-0000-0000-0000-000000000000";

/** One open page, as a sweep saw it. */
function reading({ over = {} }: { over?: Partial<OpenArtifactReading> } = {}): OpenArtifactReading {
  return {
    ask: "Pick A or B on the scope split.",
    label: "Scope split",
    landedIso: "2026-09-06T04:00:00Z",
    url: PAGE_A,
    ...over,
  };
}

/** One lock-in row, recorded against a page's URL the way a supervisor holding a link records one. */
function row({ over = {} }: { over?: Partial<LockInRow> } = {}): LockInRow {
  return {
    againstWhenIso: "2026-09-06T04:00:00Z",
    identity: PAGE_A,
    outcome: "noted",
    proposed: "react to the scope split",
    tsIso: "2026-09-06T05:00:00Z",
    verb: "note",
    ...over,
  };
}

/** The folded ledger these rows amount to, built through the real parser rather than by hand. */
function ledger({ rows }: { rows: readonly LockInRow[] }): ReturnType<typeof foldLockInLedger> {
  return foldLockInLedger({
    rows: parseLockInRows({
      text: rows
        .map((one) =>
          JSON.stringify({
            againstWhenIso: one.againstWhenIso,
            identity: one.identity,
            outcome: one.outcome,
            proposed: one.proposed,
            tsIso: one.tsIso,
            verb: one.verb,
            ...(one.note === undefined ? {} : { note: one.note }),
          }),
        )
        .join("\n"),
    }),
  });
}

describe("artifactValidity", () => {
  it("marks a page nothing has ruled on as valid", () => {
    const validity = artifactValidity({ nowIso: NOW, reading: reading(), siblings: [], states: ledger({ rows: [] }) });

    expect(validity).toEqual({ mark: "valid" });
  });

  it("finds a ruling the real ledger keyed `artifact:<uuid>` rather than by URL", () => {
    const states = ledger({
      rows: [row({ over: { identity: "artifact:aaaaaaaa-0000-0000-0000-000000000000", outcome: "edited" } })],
    });

    expect(artifactValidity({ nowIso: NOW, reading: reading(), siblings: [], states })).toEqual({
      mark: "partly-ruled",
      outcome: "edited",
      ruledIso: "2026-09-06T05:00:00Z",
    });
  });

  it("finds a ruling keyed by the eight-character short id the same ledger also uses", () => {
    const states = ledger({ rows: [row({ over: { identity: "artifact:aaaaaaaa", outcome: "noted" } })] });

    expect(artifactValidity({ nowIso: NOW, reading: reading(), siblings: [], states })).toEqual({
      mark: "partly-ruled",
      outcome: "noted",
      ruledIso: "2026-09-06T05:00:00Z",
    });
  });

  it("does not read a ruling about a different page's short id as this page's", () => {
    const states = ledger({ rows: [row({ over: { identity: "artifact:bbbbbbbb", outcome: "rejected" } })] });

    expect(artifactValidity({ nowIso: NOW, reading: reading(), siblings: [], states })).toEqual({ mark: "valid" });
  });

  it("marks a page the owner has ruled on as partly ruled, carrying the ruling's own date and outcome", () => {
    const states = ledger({ rows: [row({ over: { outcome: "edited", tsIso: "2026-09-06T05:12:00Z" } })] });

    expect(artifactValidity({ nowIso: NOW, reading: reading(), siblings: [], states })).toEqual({
      mark: "partly-ruled",
      outcome: "edited",
      ruledIso: "2026-09-06T05:12:00Z",
    });
  });

  it("marks a page superseded when a closing ruling's note names another page, and links it", () => {
    const states = ledger({
      rows: [row({ over: { note: `replaced by ${PAGE_B}`, outcome: "rejected", verb: "skip" } })],
    });
    const siblings = [reading(), reading({ over: { label: "Scope split, take two", url: PAGE_B } })];

    expect(artifactValidity({ nowIso: NOW, reading: reading(), siblings, states })).toEqual({
      by: "Scope split, take two",
      byUrl: PAGE_B,
      mark: "superseded",
    });
  });

  it("falls back to the superseding page's address when the sweep did not see that page", () => {
    const states = ledger({
      rows: [row({ over: { note: `replaced by ${PAGE_B}`, outcome: "dropped", verb: "skip" } })],
    });

    expect(artifactValidity({ nowIso: NOW, reading: reading(), siblings: [], states })).toEqual({
      by: PAGE_B,
      byUrl: PAGE_B,
      mark: "superseded",
    });
  });

  it("marks a closing ruling whose note names no other page as partly ruled rather than superseded", () => {
    const states = ledger({ rows: [row({ over: { note: "not worth it", outcome: "rejected", verb: "skip" } })] });

    expect(artifactValidity({ nowIso: NOW, reading: reading(), siblings: [], states })).toEqual({
      mark: "partly-ruled",
      outcome: "rejected",
      ruledIso: "2026-09-06T05:00:00Z",
    });
  });

  it("never supersedes a page by itself, however the ruling's note quotes it", () => {
    const states = ledger({ rows: [row({ over: { note: `see ${PAGE_A}`, outcome: "rejected", verb: "skip" } })] });

    expect(artifactValidity({ nowIso: NOW, reading: reading(), siblings: [], states })).toEqual({
      mark: "partly-ruled",
      outcome: "rejected",
      ruledIso: "2026-09-06T05:00:00Z",
    });
  });

  it("clears the mark when the page moved after the owner ruled, because the ruling lapsed", () => {
    const states = ledger({ rows: [row({ over: { note: `replaced by ${PAGE_B}`, outcome: "rejected" } })] });
    const republished = reading({ over: { updatedIso: "2026-09-06T06:00:00Z" } });

    expect(artifactValidity({ nowIso: NOW, reading: republished, siblings: [], states })).toEqual({ mark: "valid" });
  });

  it("reads a ruling against the page's own landed instant when nothing republished it", () => {
    const states = ledger({ rows: [row({ over: { againstWhenIso: "2026-09-06T03:00:00Z" } })] });

    expect(artifactValidity({ nowIso: NOW, reading: reading(), siblings: [], states })).toEqual({ mark: "valid" });
  });
});

describe("rankOpenArtifacts", () => {
  it("ranks valid pages above partly-ruled ones and superseded ones last, numbered from 1", () => {
    const states = ledger({
      rows: [
        row({ over: { identity: PAGE_A, note: `replaced by ${PAGE_B}`, outcome: "rejected", verb: "skip" } }),
        row({ over: { identity: PAGE_B, outcome: "noted" } }),
      ],
    });
    const readings = [
      reading(),
      reading({ over: { label: "Take two", url: PAGE_B } }),
      reading({
        over: { label: "Fresh page", url: "https://claude.ai/code/artifact/cccccccc-0000-0000-0000-000000000000" },
      }),
    ];

    const ranked = rankOpenArtifacts({ nowIso: NOW, readings, states });

    expect(ranked.map((one) => one.rank)).toEqual([1, 2, 3]);
    expect(ranked.map((one) => one.label)).toEqual(["Fresh page", "Take two", "Scope split"]);
    expect(ranked.map((one) => one.validity.mark)).toEqual(["valid", "partly-ruled", "superseded"]);
  });

  it("orders newest first inside one validity band", () => {
    const readings = [
      reading({ over: { label: "Older", landedIso: "2026-09-06T04:00:00Z", url: PAGE_A } }),
      reading({ over: { label: "Newer", landedIso: "2026-09-06T05:30:00Z", url: PAGE_B } }),
    ];

    const ranked = rankOpenArtifacts({ nowIso: NOW, readings, states: ledger({ rows: [] }) });

    expect(ranked.map((one) => one.label)).toEqual(["Newer", "Older"]);
  });

  it("breaks a same-instant tie on the address, so two runs produce the same page", () => {
    const readings = [
      reading({ over: { label: "Bee", url: PAGE_B } }),
      reading({ over: { label: "Ay", url: PAGE_A } }),
    ];

    const ranked = rankOpenArtifacts({ nowIso: NOW, readings, states: ledger({ rows: [] }) });

    expect(ranked.map((one) => one.url)).toEqual([PAGE_A, PAGE_B]);
  });

  it("carries the session's ask through as one text run", () => {
    const ranked = rankOpenArtifacts({ nowIso: NOW, readings: [reading()], states: ledger({ rows: [] }) });

    expect(ranked[0]!.ask).toEqual([{ kind: "text", text: "Pick A or B on the scope split." }]);
    expect(ranked[0]!.landedIso).toBe("2026-09-06T04:00:00Z");
  });

  it("indexes an empty sweep as an empty list rather than refusing", () => {
    expect(rankOpenArtifacts({ nowIso: NOW, readings: [], states: ledger({ rows: [] }) })).toEqual([]);
  });
});

describe("projectOpenArtifacts never indexes a markdown document as a page", () => {
  /** The exact url on the Slack-ingest-stall entry of one chair's `pre-p1-open-pages.json`. */
  const HIS_DOC =
    "file:///Users/ada.owner/.slopweaver/handovers/slack-ingest-stalls-on-poll-known-threads-corpus-a-day-behind.md";

  it("refuses the very entry the owner's finding card was projected from, naming its index and its url", () => {
    const document = [reading(), reading({ over: { label: "Slack ingest stall", url: HIS_DOC } })];

    const error = unwrapErr(projectOpenArtifacts({ document, ledgerText: "", nowIso: NOW }));

    expect(error.code).toBe("OPEN_ARTIFACTS_REFUSED");
    expect(briefingErrorLines({ error })).toEqual([
      `--open-artifacts entry 1 (${HIS_DOC}) links a markdown document, which opens as raw text you have to ` +
        "read top to bottom rather than a page you can react to. Publish the finding as a " +
        "page — `slopweaver page publish <slug> --page <fragment>.html --review <id>` — carrying what was measured, why it " +
        "matters, the candidate causes, and the options with their cost, and link that page instead; or drop " +
        "the card until the page exists.",
    ]);
  });

  it("names every offending entry in one pass, so a sweep fixes the document once", () => {
    const document = [
      reading({ over: { url: HIS_DOC } }),
      reading({ over: { url: PAGE_B } }),
      reading({ over: { url: "https://example.invalid/docs/plan.md" } }),
    ];

    expect(
      briefingErrorLines({ error: unwrapErr(projectOpenArtifacts({ document, ledgerText: "", nowIso: NOW })) }).map(
        (line) => line.split(" ")[2],
      ),
    ).toEqual(["0", "2"]);
  });

  it("indexes a published page beside a hosted artifact, untouched by the rule", () => {
    const page = "file:///Users/ada.owner/.slopweaver/pages/slack-ingest-stall/index.html";
    const document = [reading(), reading({ over: { landedIso: "2026-09-06T05:00:00Z", url: page } })];

    expect(unwrap(projectOpenArtifacts({ document, ledgerText: "", nowIso: NOW })).map((ranked) => ranked.url)).toEqual(
      [page, PAGE_A],
    );
  });
});
