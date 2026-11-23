/**
 * Two describe blocks, same shape as `staleReferences.test.ts`: the first exercises the PURE key-checker on
 * inline fixtures; the second reads this repository's real `.coderabbit.yaml` against a committed snapshot
 * of CodeRabbit's own schema (`src/__tests__/fixtures/coderabbitSchema.v2.json`, fetched from
 * https://coderabbit.ai/integrations/schema.v2.json) and asserts every key in the file is one CodeRabbit
 * actually reads — so a renamed key in the config fails this test instead of silently re-enabling reviews.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { findUnknownConfigKeys, type JsonSchemaNode } from "../../../coderabbit/schemaCheck.js";

const SAMPLE_SCHEMA: JsonSchemaNode = {
  properties: {
    inheritance: { type: "boolean" },
    reviews: {
      properties: {
        auto_review: {
          properties: {
            enabled: { type: "boolean" },
          },
          type: "object",
        },
        high_level_summary: { type: "boolean" },
      },
      type: "object",
    },
  },
  type: "object",
};

describe("findUnknownConfigKeys", () => {
  it("reports nothing when every key matches the schema", () => {
    const config = { inheritance: false, reviews: { auto_review: { enabled: false } } };
    expect(findUnknownConfigKeys({ config, schema: SAMPLE_SCHEMA })).toEqual([]);
  });

  it("reports a renamed top-level key", () => {
    const config = { inheritence: false };
    expect(findUnknownConfigKeys({ config, schema: SAMPLE_SCHEMA })).toEqual(["inheritence"]);
  });

  it("reports a renamed nested key with its dotted path", () => {
    const config = { reviews: { high_leval_summary: false } };
    expect(findUnknownConfigKeys({ config, schema: SAMPLE_SCHEMA })).toEqual(["reviews.high_leval_summary"]);
  });

  it("reports a key nested one level deeper than the schema defines", () => {
    const config = { reviews: { auto_review: { enable: false } } };
    expect(findUnknownConfigKeys({ config, schema: SAMPLE_SCHEMA })).toEqual(["reviews.auto_review.enable"]);
  });

  it("does not descend into a key whose schema type is not object", () => {
    const config = { reviews: { high_level_summary: { anything: true } } };
    expect(findUnknownConfigKeys({ config, schema: SAMPLE_SCHEMA })).toEqual([]);
  });

  it("reports every key under an object node whose parsed schema carries its properties as null", () => {
    const schema: unknown = JSON.parse(
      '{"type":"object","properties":{"reviews":{"type":"object","properties":null}}}',
    );
    const config = { reviews: { profile: "chill" } };
    expect(findUnknownConfigKeys({ config, schema: schema as JsonSchemaNode })).toEqual(["reviews.profile"]);
  });
});

describe("the real .coderabbit.yaml", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "..", "..", "..");
  const schema = JSON.parse(
    readFileSync(join(root, "src", "__tests__", "fixtures", "coderabbitSchema.v2.json"), "utf8"),
  ) as JsonSchemaNode;
  const config = parseYaml(readFileSync(join(root, ".coderabbit.yaml"), "utf8")) as Readonly<Record<string, unknown>>;

  it("uses only keys CodeRabbit's schema actually defines", () => {
    expect(findUnknownConfigKeys({ config, schema })).toEqual([]);
  });

  it("disables auto_review, so no automatic review ever runs", () => {
    const reviews = config["reviews"] as Readonly<Record<string, unknown>>;
    const autoReview = reviews["auto_review"] as Readonly<Record<string, unknown>>;
    expect(autoReview["enabled"]).toBe(false);
  });

  it("keeps inheritance off, so the org-level config cannot override this file", () => {
    expect(config["inheritance"]).toBe(false);
  });
});
