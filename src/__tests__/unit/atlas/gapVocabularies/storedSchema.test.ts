/*
 * A gap each platform's own constructor builds is one that platform's stored gap schema admits unchanged, so the
 * spread-vocabulary family never mints a gap its store would refuse to read back.
 */
import { describe, expect, it } from "vitest";

import { aetherKindFileSchema } from "../../../../atlas/aether/entities.js";
import { AETHER_SCHEMA_VERSION } from "../../../../atlas/aether/model.js";
import { airtableAtlasGapSchema } from "../../../../atlas/airtable/model.js";
import { brazeAtlasGapSchema } from "../../../../atlas/braze/model.js";
import { clerkAtlasGapSchema } from "../../../../atlas/clerk/model.js";
import { figmaAtlasGapSchema } from "../../../../atlas/figma/model.js";
import { geminiAiStudioAtlasGapSchema } from "../../../../atlas/geminiAiStudio/model.js";
import { inngestAtlasGapSchema } from "../../../../atlas/inngest/model.js";
import { knockGapSchema } from "../../../../atlas/knock/model.js";
import { notionAtlasGapSchema } from "../../../../atlas/notion/model.js";
import { onepasswordGapSchema } from "../../../../atlas/onepassword/model.js";
import { prismaDataPlatformGapSchema } from "../../../../atlas/prismaDataPlatform/model.js";
import { trelicaAtlasGapSchema } from "../../../../atlas/trelica/model.js";
import { AT } from "./harness.js";
import { SPREAD_CASES } from "./spreadCases.js";

/** Anything that reads a stored gap back, throwing on one the store would refuse. */
interface StoredGapReader {
  readonly parse: (value: unknown) => unknown;
}

/** Aether's gap schema is module-private, so its gap is read back through the kind file that stores it. */
const AETHER_GAP_READ_BACK: StoredGapReader = {
  parse: (value) =>
    aetherKindFileSchema.parse({
      coverage: [],
      entities: [],
      gaps: [value],
      kind: "project",
      schemaVersion: AETHER_SCHEMA_VERSION,
      updatedAt: AT,
    }).gaps[0],
};

/** The stored gap schema each platform's constructor must satisfy, keyed by platform. */
const STORED_SCHEMAS: Readonly<Record<string, StoredGapReader>> = {
  aether: AETHER_GAP_READ_BACK,
  airtable: airtableAtlasGapSchema,
  braze: brazeAtlasGapSchema,
  clerk: clerkAtlasGapSchema,
  figma: figmaAtlasGapSchema,
  "gemini-ai-studio": geminiAiStudioAtlasGapSchema,
  inngest: inngestAtlasGapSchema,
  knock: knockGapSchema,
  notion: notionAtlasGapSchema,
  onepassword: onepasswordGapSchema,
  "prisma-data-platform": prismaDataPlatformGapSchema,
  trelica: trelicaAtlasGapSchema,
};

describe("a constructed gap is one its platform's stored schema admits unchanged", () => {
  it("holds a schema for every platform in the family", () => {
    expect(Object.keys(STORED_SCHEMAS).toSorted()).toEqual(SPREAD_CASES.map((entry) => entry.platform).toSorted());
  });

  it.each(SPREAD_CASES)("$platform's gap round-trips through its strict schema", ({ open, platform }) => {
    const gap = open({ at: AT });

    expect(STORED_SCHEMAS[platform]!.parse(gap)).toEqual(gap);
  });
});
