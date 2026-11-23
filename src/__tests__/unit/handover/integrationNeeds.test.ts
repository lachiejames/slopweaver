/**
 * A row DECLARING it needs an integration this install is not connected to is held, not offered — and only that
 * row, only while no whole credential set of the integration is stored, and only while it sits in `RUN NOW`.
 */
import { describe, expect, it } from "vitest";

import { composeBoardModels } from "../../../handover/boardState.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import {
  disconnectedLines,
  disconnectedNeedsOf,
  disconnectedRowsOf,
  INTEGRATIONS,
} from "../../../handover/integrationNeeds.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { writableAssignment } from "../../../handover/rowTags.js";
import { unwrap } from "../../../lib/result.js";
import { credentialsByName } from "../../../secrets/registry.js";

/** A ready doc at `/h/<slug>.md`. */
function row({ slug }: { slug: string }): HandoverDoc {
  const text = ["---", `slug: ${slug}`, "kind: doc", "status: ready", `summary: ${slug} row`, "---", "", `# ${slug}`];
  return parseHandoverDoc({ path: `/h/${slug}.md`, text: text.join("\n") });
}

/** One `tagged` event setting `needs` to each value. */
function needs({ values }: { values: readonly string[] }): RunEvent {
  return {
    atIso: "2026-11-04T07:00:00.000Z",
    drop: [],
    kind: "tagged",
    set: values.map((value) => ({ key: "needs", value })),
    why: "test",
  };
}

/** The ranking for a board with no lifted row: a row ranks in the section it composed in. */
const composedRunNow = (model: BoardModel): boolean => model.section === "RUN NOW";

const STARTED: RunEvent = { atIso: "2026-11-04T08:00:00.000Z", branch: "b", docHash: "h", kind: "started" };

/** Compose the board with each slug's journal events, and the slugs whose journal holds an unreadable line. */
function compose({
  docs,
  events,
  unreadable = [],
}: {
  docs: readonly HandoverDoc[];
  events: Readonly<Record<string, readonly RunEvent[]>>;
  unreadable?: readonly string[];
}): readonly BoardModel[] {
  const journals = new Map(
    docs.map((doc) => {
      const lines = unreadable.includes(doc.slug) ? [2] : [];
      const journalled = events[doc.slug];
      if (journalled === undefined) {
        // A slug the case gave no events journals nothing: an empty journal, said here rather than defaulted.
        return [doc.slug, { events: [], unreadableLines: lines }];
      }
      return [doc.slug, { events: journalled, unreadableLines: lines }];
    }),
  );
  return composeBoardModels({ journals, probeStates: new Map(), resolutionDocs: docs, roots: docs });
}

describe("INTEGRATIONS", () => {
  it("names only credentials the secrets register declares", () => {
    expect(INTEGRATIONS.length).toBeGreaterThan(0);

    const declared = credentialsByName();
    const named = INTEGRATIONS.flatMap((spec) => spec.credentialSets.flat());
    expect(named.filter((name) => !declared.has(name))).toEqual([]);
  });

  it("carries the three integrations the owner named: Fathom, Calendar and Trelica", () => {
    expect(
      ["fathom", "calendar", "trelica"].filter((name) => !INTEGRATIONS.some((s) => s.integration === name)),
    ).toEqual([]);
  });
});

describe("the needs tag", () => {
  it("accepts an integration the table carries, as a key holding several", () => {
    expect(unwrap(writableAssignment({ assignment: { key: "needs", value: "fathom" } })).cardinality).toBe("many");
  });

  it("refuses a misspelled one, naming the nearest", () => {
    const refused = writableAssignment({ assignment: { key: "needs", value: "fathum" } });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().message).toContain("fathom");
  });
});

describe("disconnectedNeedsOf", () => {
  const tags = [
    { key: "needs", source: "declared", value: "fathom" },
    { key: "needs", source: "declared", value: "calendar" },
  ];

  /** One declared `needs` tag. */
  function needing({
    integration,
  }: {
    integration: string;
  }): readonly { key: string; source: string; value: string }[] {
    return [{ key: "needs", source: "declared", value: integration }];
  }

  it("names every needed integration with no credential set stored, in table order", () => {
    expect(disconnectedNeedsOf({ stored: new Set(["store-url"]), tags })).toEqual(["calendar", "fathom"]);
  });

  it("drops an integration once its credential is stored", () => {
    expect(disconnectedNeedsOf({ stored: new Set(["calendar-oauth.json"]), tags })).toEqual(["fathom"]);
  });

  it("counts either Slack token alone as Slack connected", () => {
    const slack = needing({ integration: "slack" });
    expect([
      disconnectedNeedsOf({ stored: new Set(["slack-user-token"]), tags: slack }),
      disconnectedNeedsOf({ stored: new Set(["slack-bot-token"]), tags: slack }),
    ]).toEqual([[], []]);
  });

  it("holds Datadog on its API key alone, and frees it once the app key is stored beside it", () => {
    const datadog = needing({ integration: "datadog" });
    expect([
      disconnectedNeedsOf({ stored: new Set(["datadog-api-key"]), tags: datadog }),
      disconnectedNeedsOf({ stored: new Set(["datadog-api-key", "datadog-app-key"]), tags: datadog }),
    ]).toEqual([["datadog"], []]);
  });

  it("holds Vanta on its client id alone, and frees it once the secret is stored beside it", () => {
    const vanta = needing({ integration: "vanta" });
    expect([
      disconnectedNeedsOf({ stored: new Set(["vanta-client-id"]), tags: vanta }),
      disconnectedNeedsOf({ stored: new Set(["vanta-client-id", "vanta-client-secret"]), tags: vanta }),
    ]).toEqual([["vanta"], []]);
  });

  it("holds nothing for a row that declares no need", () => {
    expect(
      disconnectedNeedsOf({ stored: new Set(), tags: [{ key: "workstream", source: "declared", value: "x" }] }),
    ).toEqual([]);
  });

  it("never acts on an unrecognised value", () => {
    const old = [{ key: "needs", source: "unrecognised", value: "fathom" }];
    expect(disconnectedNeedsOf({ stored: new Set(), tags: old })).toEqual([]);
  });
});

describe("disconnectedRowsOf", () => {
  it("holds the RUN NOW row that declared the need, and no other", () => {
    const models = compose({
      docs: [row({ slug: "meeting-notes" }), row({ slug: "plain" })],
      events: { "meeting-notes": [needs({ values: ["fathom"] })] },
    });
    const held = disconnectedRowsOf({ models, ranksRunNow: composedRunNow, stored: new Set(["store-url"]) });
    expect([...held.entries()]).toEqual([["/h/meeting-notes.md", { needs: ["fathom"], slug: "meeting-notes" }]]);
  });

  it("frees the row the moment its integration is stored", () => {
    const models = compose({
      docs: [row({ slug: "meeting-notes" })],
      events: { "meeting-notes": [needs({ values: ["fathom"] })] },
    });
    expect(disconnectedRowsOf({ models, ranksRunNow: composedRunNow, stored: new Set(["fathom-api-key"]) }).size).toBe(
      0,
    );
  });

  it("leaves an IN FLIGHT row alone, because its run is already open", () => {
    const models = compose({
      docs: [row({ slug: "meeting-notes" })],
      events: { "meeting-notes": [needs({ values: ["fathom"] }), STARTED] },
    });
    expect(models[0]!.section).toBe("IN FLIGHT");
    expect(disconnectedRowsOf({ models, ranksRunNow: composedRunNow, stored: new Set() }).size).toBe(0);
  });

  it("never reads an incomplete tag fold: a row with an unreadable journal line is a CONTRADICTION, not RUN NOW", () => {
    const models = compose({
      docs: [row({ slug: "meeting-notes" }), row({ slug: "plain" })],
      events: { "meeting-notes": [needs({ values: ["fathom"] })] },
      unreadable: ["meeting-notes"],
    });
    expect([
      models.map((model) => [model.doc.slug, model.section, model.tagsIncomplete]),
      disconnectedRowsOf({ models, ranksRunNow: composedRunNow, stored: new Set() }).size,
    ]).toEqual([
      [
        ["meeting-notes", "CONTRADICTION", true],
        ["plain", "RUN NOW", false],
      ],
      0,
    ]);
  });
});

describe("disconnectedLines", () => {
  it("says nothing when nothing is held and the store listed", () => {
    expect(disconnectedLines({ held: new Map(), unread: undefined })).toEqual([]);
  });

  it("names each held row, what it needs, and the command that frees it", () => {
    const held = new Map([
      ["/h/b.md", { needs: ["trelica"], slug: "b" }],
      ["/h/a.md", { needs: ["fathom", "calendar"], slug: "a" }],
    ]);
    expect(disconnectedLines({ held, unread: undefined })).toEqual([
      "(2 RUN NOW row(s) need an integration this install is not connected to — held, not to pick up, and kept on " +
        "the board. Connecting one frees its rows: calendar: `slopweaver calendar connect`; fathom: " +
        "`slopweaver secrets set fathom-api-key`; trelica: `slopweaver secrets set trelica-tenant-host`.)",
      "  a — needs fathom, calendar",
      "  b — needs trelica",
    ]);
  });

  it("says the store did not list rather than reading as nothing held", () => {
    expect(disconnectedLines({ held: new Map(), unread: "EACCES" })).toEqual([
      "(the secrets store could not be listed — EACCES — so a row's `needs` tag held nothing; every such row is " +
        "offered unchecked.)",
    ]);
  });
});
