/**
 * Classifying a content row at intake: the facts read off a projected record, with visibility made effective
 * for the always-private sources, and the class the row is written with.
 */
import { describe, expect, it } from "vitest";

import {
  contentDataClass,
  contentDataClassFacts,
  contentDataClassFactsFromFields,
  OWNER_TURN_FACT_SOURCE,
  ownerCaptureDataClassFacts,
  ownerTurnDataClassFacts,
} from "../../../store/dataClassIntake.js";
import { composeDataClassRules, type DataClassRule } from "../../../store/dataClassRules.js";
import type { ProjectedContent, ProjectedRecord } from "../../../store/project.js";

/** A projected public Slack message, its content fields overridable. */
const projected = ({
  content = {},
  author = { email: null, handle: "fixture", nativeId: "U0FIXTURE" },
}: {
  content?: Partial<ProjectedContent>;
  author?: ProjectedRecord["author"];
} = {}): ProjectedRecord => ({
  author,
  container: { kind: "channel", name: "eng", nativeId: "slack/C0FIXTURE", source: "slack" },
  content: {
    authorIsBot: false,
    body: "the deploy rolled back",
    kind: "message",
    metadata: {},
    occurredAt: new Date("2026-10-01T09:00:00.000Z"),
    parentSourceId: null,
    source: "slack",
    sourceId: "C0FIXTURE:1.1",
    title: null,
    url: "https://example.test/1",
    visibility: "public",
    ...content,
  },
  sourceRow: null,
});

describe("contentDataClassFacts", () => {
  it("reads table, source, kind, visibility, container and author off the record", () => {
    expect(contentDataClassFacts({ record: projected() })).toEqual({
      author: "U0FIXTURE",
      container: "slack/C0FIXTURE",
      kind: "message",
      source: "slack",
      table: "content",
      visibility: "public",
    });
  });

  it("reads a record with no author as a null author", () => {
    expect(contentDataClassFacts({ record: projected({ author: null }) }).author).toBe(null);
  });

  it("reads an always-private source as private even when its row says public", () => {
    const record = projected({ content: { source: "gmail", visibility: "public" } });
    expect(contentDataClassFacts({ record }).visibility).toBe("private");
  });
});

describe("contentDataClassFactsFromFields", () => {
  it("builds the same facts from a stored row's fields as intake builds from the projected record", () => {
    const record = projected({ content: { kind: "message", source: "gmail", visibility: "public" } });
    expect(
      contentDataClassFactsFromFields({
        author: "U0FIXTURE",
        container: "slack/C0FIXTURE",
        kind: "message",
        source: "gmail",
        visibility: "public",
      }),
    ).toEqual(contentDataClassFacts({ record }));
  });

  it("reads an always-private kind as private when the source is not", () => {
    const facts = contentDataClassFactsFromFields({
      author: null,
      container: "slack/C0FIXTURE",
      kind: "huddle",
      source: "slack",
      visibility: "public",
    });
    expect(facts.visibility).toBe("private");
  });

  it("keeps a row stored against no container and no author as nulls", () => {
    const facts = contentDataClassFactsFromFields({
      author: null,
      container: null,
      kind: "message",
      source: "slack",
      visibility: "public",
    });
    expect(facts).toEqual({
      author: null,
      container: null,
      kind: "message",
      source: "slack",
      table: "content",
      visibility: "public",
    });
  });
});

describe("owner table facts", () => {
  it("reads an owner_capture row as private, its capturing app as the source", () => {
    expect(ownerCaptureDataClassFacts({ source: "superwhisper" })).toEqual({
      author: null,
      container: null,
      kind: null,
      source: "superwhisper",
      table: "owner_capture",
      visibility: "private",
    });
  });

  it("reads an owner_turn body as private under the one owner-turn source", () => {
    expect(ownerTurnDataClassFacts()).toEqual({
      author: null,
      container: null,
      kind: null,
      source: OWNER_TURN_FACT_SOURCE,
      table: "owner_turn",
      visibility: "private",
    });
    expect(OWNER_TURN_FACT_SOURCE).toBe("owner-turn");
  });
});

describe("contentDataClass", () => {
  it("writes a public record no rule names as unknown", () => {
    expect(contentDataClass({ record: projected(), rules: composeDataClassRules({ installation: [] }) })).toBe(
      "unknown",
    );
  });

  it("writes a record an installation rule classes public as public", () => {
    const installation: DataClassRule[] = [
      { action: "public", id: "install:eng", match: { container: ["slack/C0FIXTURE"] } },
    ];
    expect(contentDataClass({ record: projected(), rules: composeDataClassRules({ installation }) })).toBe("public");
  });

  it("writes a private-lane record as unknown, because its assessment does not run yet", () => {
    const installation: DataClassRule[] = [{ action: "public", id: "install:mail", match: { visibility: ["public"] } }];
    const record = projected({ content: { source: "gmail", visibility: "public" } });
    expect(contentDataClass({ record, rules: composeDataClassRules({ installation }) })).toBe("unknown");
  });
});
