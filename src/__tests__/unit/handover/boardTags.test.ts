/**
 * A board row's TAGS as the one composer computes them, and every reader of them: `list --json` and `row --json`,
 * the rendered board a `--tag` filter narrows, and the lines around it. The property under test throughout is that
 * a filter narrows which rows print and never a fact about the whole board.
 */
import { describe, expect, it } from "vitest";

import {
  boardJsonDocument,
  NO_BOARD_REFERENCES,
  NO_DETACHED_FINDINGS,
} from "../../../cli/commands/handover/listJson.js";
import { incompleteTagWarningLines, tagFilterSummaryLines } from "../../../cli/commands/handover/listPresentation.js";
import { boardRowJsonText } from "../../../cli/commands/handover/rowJson.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { renderBoard } from "../../../handover/render.js";
import { EMPTY_TAG_FILTER, parseTagFilter, type TagFilter } from "../../../handover/tagFilter.js";
import { unwrap } from "../../../lib/result.js";

/** A parsed row: a plain doc, at `/h/<slug>.md`. */
function row({
  slug,
  extra = [],
  status = "ready",
}: {
  slug: string;
  extra?: readonly string[];
  status?: string;
}): HandoverDoc {
  const text = [
    "---",
    `slug: ${slug}`,
    "kind: doc",
    `status: ${status}`,
    `summary: ${slug} row`,
    ...extra,
    "---",
    "",
    `# ${slug}`,
    "",
  ];
  return parseHandoverDoc({ path: `/h/${slug}.md`, text: text.join("\n") });
}

const STARTED: RunEvent = { atIso: "2026-09-27T10:00:00.000Z", branch: "b", docHash: "h", kind: "started" };

/** A journal whose one event tags the row. */
function taggedWith({ set }: { set: readonly { key: string; value: string }[] }): RunEvent {
  return { atIso: "2026-09-27T09:00:00.000Z", drop: [], kind: "tagged", set, why: "test" };
}

const ACTION = {
  actor: "me" as const,
  body: "the switch-over is ready for review.",
  destinations: [{ channel: "C01SDLC", kind: "channel" as const, label: "Post it to #delivery", tradeoff: "all see" }],
  mentions: [],
  version: 1 as const,
};

type Journal = { readonly events: readonly RunEvent[]; readonly unreadableLines: readonly number[] };

/** Compose the board; every doc not named in `journals` gets an empty, readable journal, as `list` reads one. */
function compose({
  docs,
  journals = {},
}: {
  docs: readonly HandoverDoc[];
  journals?: Readonly<Record<string, Journal>>;
}): readonly BoardModel[] {
  const read = new Map<string, Journal>(docs.map((doc) => [doc.slug, { events: [], unreadableLines: [] }]));
  for (const [slug, journal] of Object.entries(journals)) {
    read.set(slug, journal);
  }
  return composeBoardModels({ journals: read, probeStates: new Map(), resolutionDocs: docs, roots: docs });
}

/** One model by slug. */
function modelOf({ models, slug }: { models: readonly BoardModel[]; slug: string }): BoardModel {
  return models.find((model) => model.doc.slug === slug)!;
}

/** A filter the terms parse to. */
function filterOf({ terms }: { terms: readonly string[] }): TagFilter {
  return unwrap(parseTagFilter({ flagValues: terms }));
}

describe("the composer's tags", () => {
  it("puts the declared tags first, then what the row's own fields derive", () => {
    const models = compose({
      docs: [row({ extra: ["repo: /w/slopweaver"], slug: "tagged" })],
      journals: { tagged: { events: [taggedWith({ set: [{ key: "impact", value: "high" }] })], unreadableLines: [] } },
    });
    expect(modelOf({ models, slug: "tagged" }).tags).toEqual({
      tags: [
        { key: "impact", source: "declared", value: "high" },
        { key: "kind", source: "derived", value: "doc" },
        { key: "priority", source: "derived", value: modelOf({ models, slug: "tagged" }).tags.tags[2]!.value },
        { key: "reply", source: "derived", value: "none" },
        { key: "repo", source: "derived", value: "slopweaver" },
        { key: "run", source: "derived", value: "none" },
      ],
      unrecognised: [],
    });
    expect(modelOf({ models, slug: "tagged" }).tagsIncomplete).toBe(false);
  });

  it("derives reply=drafted from an offered draft, readable or not, and none from a plain question", () => {
    const question = (over: Partial<Extract<RunEvent, { kind: "question" }>>): RunEvent => ({
      atIso: "2026-09-27T11:00:00.000Z",
      kind: "question",
      question: "post it?",
      ...over,
    });
    const models = compose({
      docs: [row({ slug: "readable" }), row({ slug: "broken" }), row({ slug: "plain" })],
      journals: {
        broken: { events: [STARTED, question({ actionUnreadable: true })], unreadableLines: [] },
        plain: { events: [STARTED, question({})], unreadableLines: [] },
        readable: { events: [STARTED, question({ action: ACTION })], unreadableLines: [] },
      },
    });
    const replyOf = ({ slug }: { slug: string }): string =>
      modelOf({ models, slug }).tags.tags.find((tag) => tag.key === "reply")!.value;
    expect([replyOf({ slug: "readable" }), replyOf({ slug: "broken" }), replyOf({ slug: "plain" })]).toEqual([
      "drafted",
      "drafted",
      "none",
    ]);
  });

  it("derives no reply at all for a row whose journal the composition was never handed", () => {
    const docs = [row({ slug: "unread" })];
    const [model] = composeBoardModels({
      journals: new Map(),
      probeStates: new Map(),
      resolutionDocs: docs,
      roots: docs,
    });
    expect(model!.tags.tags.map((tag) => tag.key)).toEqual(["kind", "priority"]);
  });

  it("marks tags incomplete for an undecodable line and for a journal that could not be read at all", () => {
    const models = compose({
      docs: [row({ slug: "a-bad-line" }), row({ slug: "unreadable" }), row({ slug: "fine" })],
      journals: {
        "a-bad-line": { events: [], unreadableLines: [3] },
        unreadable: { events: [], unreadableLines: [0] },
      },
    });
    expect(models.map((model) => [model.doc.slug, model.tagsIncomplete])).toEqual([
      ["a-bad-line", true],
      ["unreadable", true],
      ["fine", false],
    ]);
  });

  it("carries the tags through a row the dependency pass places", () => {
    const set = [{ key: "impact", value: "low" }];
    const models = compose({
      docs: [row({ extra: ["blockedBy: [elsewhere]"], slug: "waits" })],
      journals: { waits: { events: [taggedWith({ set })], unreadableLines: [] } },
    });
    expect(modelOf({ models, slug: "waits" }).section).toBe("NOT YET");
    expect(modelOf({ models, slug: "waits" }).tags.tags[0]).toEqual({
      key: "impact",
      source: "declared",
      value: "low",
    });
  });
});

/** A board of three live asks, one tagged `platform=slack`, and one DONE row tagged the same. */
function board(): readonly BoardModel[] {
  const slack = { events: [taggedWith({ set: [{ key: "platform", value: "slack" }] })], unreadableLines: [] };
  return compose({
    docs: [
      row({ slug: "slack-one" }),
      row({ slug: "plain-one" }),
      row({ slug: "broken-one" }),
      row({ slug: "slack-done", status: "done" }),
    ],
    journals: { "broken-one": { events: [], unreadableLines: [2] }, "slack-done": slack, "slack-one": slack },
  });
}

/** The JSON document for a board under a filter. */
function documentOf({ filter, models }: { filter: TagFilter; models: readonly BoardModel[] }) {
  return boardJsonDocument({
    detached: NO_DETACHED_FINDINGS,
    filter,
    handoverDir: "/h",
    models,
    observedAtIso: "2026-09-27T12:00:00.000Z",
    references: NO_BOARD_REFERENCES,
    scanStartedIso: "2026-09-27T11:59:00.000Z",
    unreadable: [],
    unresolved: 0,
  });
}

describe("list --json and row --json", () => {
  it("publishes each row's tags, unrecognised tags and completeness, and the whole board when unfiltered", () => {
    const document = documentOf({ filter: EMPTY_TAG_FILTER, models: board() });
    expect(document.tagFilter).toEqual([]);
    expect(document.rowsBeforeFilter).toBe(4);
    expect(document.rows.map((each) => each.slug)).toEqual(["slack-one", "plain-one", "broken-one", "slack-done"]);
    const slack = document.rows.find((each) => each.slug === "slack-one")!;
    expect(slack.tags[0]).toEqual({ key: "platform", source: "declared", value: "slack" });
    expect(slack.unrecognisedTags).toEqual([]);
    expect(document.rows.map((each) => each.tagsIncomplete)).toEqual([false, false, true, false]);
  });

  it("narrows rows only, closed sections included, keeping every board-wide count", () => {
    const whole = documentOf({ filter: EMPTY_TAG_FILTER, models: board() });
    const filtered = documentOf({ filter: filterOf({ terms: ["platform=slack", "platform=slack"] }), models: board() });
    expect(filtered.rows.map((each) => each.slug)).toEqual(["slack-one", "slack-done"]);
    expect(filtered.tagFilter).toEqual(["platform=slack"]);
    expect(filtered.rowsBeforeFilter).toBe(4);
    expect(filtered.summaryTruncation).toEqual(whole.summaryTruncation);
  });

  it("strips the source off an unrecognised tag, which is always the same word", () => {
    const models = compose({
      docs: [row({ slug: "old" })],
      journals: { old: { events: [taggedWith({ set: [{ key: "colour", value: "red" }] })], unreadableLines: [] } },
    });
    expect(documentOf({ filter: EMPTY_TAG_FILTER, models }).rows[0]!.unrecognisedTags).toEqual([
      { key: "colour", value: "red" },
    ]);
  });

  // An unreadable journal proves neither a draft nor where the run stands, so the row derives no reply= and no run=.
  it("gives the one-row surface the same three fields", () => {
    const model = modelOf({ models: board(), slug: "broken-one" });
    const printed = JSON.parse(
      boardRowJsonText({ model, references: NO_BOARD_REFERENCES, repoLargestPull: undefined }),
    ) as Record<string, unknown>;
    expect([printed["tags"], printed["unrecognisedTags"], printed["tagsIncomplete"]]).toEqual([
      [
        { key: "kind", source: "derived", value: "doc" },
        { key: "priority", source: "derived", value: model.tags.tags[1]!.value },
      ],
      [],
      true,
    ]);
  });
});

describe("the rendered board under --tag", () => {
  it("prints only matching rows while the hidden-terminal count stays about the whole board", () => {
    const models = board();
    const whole = renderBoard({ models, unreadable: [] });
    const filtered = renderBoard({ filter: filterOf({ terms: ["platform=slack"] }), models, unreadable: [] });
    expect(filtered.some((line) => line.includes("slack-one"))).toBe(true);
    expect(filtered.some((line) => line.includes("plain-one"))).toBe(false);
    expect(filtered.filter((line) => line.includes("hidden; use --all"))).toEqual(
      whole.filter((line) => line.includes("hidden; use --all")),
    );
  });

  it("counts the matched rows against what the board would print, so --all widens both", () => {
    const models = board();
    const live = models.filter((model) => model.section !== "DONE");
    const filter = filterOf({ terms: ["platform=slack"] });
    expect(tagFilterSummaryLines({ filter, population: live })).toEqual([
      "filtered by --tag platform=slack: 1 of 3 row(s)",
    ]);
    expect(tagFilterSummaryLines({ filter, population: models })).toEqual([
      "filtered by --tag platform=slack: 2 of 4 row(s)",
    ]);
    expect(tagFilterSummaryLines({ filter: EMPTY_TAG_FILTER, population: models })).toEqual([]);
  });

  it("warns of every incomplete row, excluded ones too, when a term reads the journal — and never otherwise", () => {
    const models = board();
    expect(incompleteTagWarningLines({ filter: filterOf({ terms: ["platform=slack"] }), models })).toEqual([
      "handover list: broken-one: its journal could not be completely read, so its declared tags and its reply " +
        "and run tags may be incomplete — the --tag verdict on it may be wrong",
    ]);
    expect(incompleteTagWarningLines({ filter: filterOf({ terms: ["run=open"] }), models })).toHaveLength(1);
    expect(incompleteTagWarningLines({ filter: filterOf({ terms: ["kind=doc", "!origin"] }), models })).toEqual([]);
  });
});
