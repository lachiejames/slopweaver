/*
 * A seat tool's parameters are declared twice: the schema the model is offered (`src/talk/seatToolSchemas.ts`) and
 * the argv the console builds from what it sends (`site/lib/talkToolsList.ts`). The site's own drift check compares
 * tool NAMES only, so a parameter added on one side — `browser_open`'s `page` — would be offered and
 * silently dropped, or accepted and never offered. This holds the two NAME SETS equal for every seat tool.
 *
 * In the src lane because `seatToolSchemas.ts` imports `src/browser/present.ts`, which the site build cannot resolve.
 * The site module is imported at run time, by address, because `src/`'s `rootDir` may not contain a `site/` file
 * (TS6059) — the shape `citationKindsMirror.test.ts` uses.
 */

import { describe, expect, it } from "vitest";

import { SEAT_TOOLS } from "../../../talk/seatToolSchemas.js";

const TALK_TOOLS_MODULE = new URL("../../../../site/lib/talkToolsList.ts", import.meta.url).href;

/** The site's declaration of one tool, as far as this test reads it. */
interface SiteTool {
  readonly name: string;
  readonly argv: readonly unknown[];
  readonly options: readonly { readonly name: string }[];
}

/**
 * Whether a module exposes the site's tool list.
 *
 * @param module what the run-time import returned
 * @returns true when it carries a `TALK_TOOLS` array
 */
function hasTalkTools(module: unknown): module is { TALK_TOOLS: readonly SiteTool[] } {
  return typeof module === "object" && module !== null && "TALK_TOOLS" in module && Array.isArray(module.TALK_TOOLS);
}

/** Every parameter name the site fills: each argv slot, then each option. */
function siteParameterNames({ tool }: { tool: SiteTool }): readonly string[] {
  const slots = tool.argv.flatMap((part) =>
    typeof part === "object" && part !== null && "slot" in part && typeof part.slot === "string" ? [part.slot] : [],
  );
  return [...slots, ...tool.options.map((option) => option.name)].toSorted();
}

/** Every parameter name the schema offers the model. */
function schemaParameterNames({ parameters }: { parameters: Readonly<Record<string, unknown>> }): readonly string[] {
  const properties = parameters["properties"];
  if (typeof properties !== "object" || properties === null) {
    return [];
  }
  return Object.keys(properties).toSorted();
}

describe("seat tool parameters mirror the console's argv", () => {
  it("offers the model exactly the parameters the console fills, for every seat tool", async () => {
    const site: unknown = await import(TALK_TOOLS_MODULE);
    expect(hasTalkTools(site)).toBe(true);
    const siteTools = (site as { TALK_TOOLS: readonly SiteTool[] }).TALK_TOOLS;
    expect(SEAT_TOOLS.length).toBeGreaterThan(0);
    const pairs = SEAT_TOOLS.map((tool) => ({
      name: tool.name,
      schema: schemaParameterNames({ parameters: tool.parameters }),
      site: siteParameterNames({ tool: siteTools.find((candidate) => candidate.name === tool.name)! }),
    }));
    expect(pairs.map((pair) => ({ name: pair.name, names: pair.site }))).toEqual(
      pairs.map((pair) => ({ name: pair.name, names: pair.schema })),
    );
  });

  it("carries browser_open's page on both sides", async () => {
    const site: unknown = await import(TALK_TOOLS_MODULE);
    const siteTools = (site as { TALK_TOOLS: readonly SiteTool[] }).TALK_TOOLS;
    const open = siteTools.find((tool) => tool.name === "browser_open")!;
    expect(siteParameterNames({ tool: open })).toEqual(["destination", "page", "url"]);
  });
});
