import { describe, expect, it } from "vitest";
import { renderCapabilities, renderCatalog, renderCatalogJson } from "../../../../../cli/catalog.js";
import { catalogRunCommand, runCatalog } from "../../../../../cli/commands/catalog/run.js";
import { discoverCommands } from "../../../../../cli/discoverCommands.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { NOUN_GROUPS } from "../../../../../cli/nounGroups.js";
import { parseOwnJson } from "../../../../parseOwnJson.js";

function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "catalog", ...tail];
}

describe("runCatalog", () => {
  it("exits OK on --help", () => {
    expect(runCatalog(argv({ tail: ["--help"] }))).toBe(EXIT_OK);
  });

  // These three assert the EXIT CODE only. Named for what they check, because a review pass pointed out
  // that calling them "renders JSON" while observing nothing but `EXIT_OK` is a claim the test does not
  // make good on — delete the `logger.out` line and they stay green. What is actually rendered is asserted
  // against the pure renderers below, which is where the output lives.
  it("exits OK for the human catalog", () => {
    expect(runCatalog(argv({ tail: [] }))).toBe(EXIT_OK);
  });

  it("exits OK for --json", () => {
    expect(runCatalog(argv({ tail: ["--json"] }))).toBe(EXIT_OK);
  });

  it("exits OK for --capabilities", () => {
    expect(runCatalog(argv({ tail: ["--capabilities"] }))).toBe(EXIT_OK);
  });

  it("tolerates the bare-noun alias token as a positional", () => {
    expect(runCatalog(argv({ tail: ["list"] }))).toBe(EXIT_OK);
  });

  it("REFUSES an unknown flag rather than ignoring it", () => {
    expect(runCatalog(argv({ tail: ["--definitely-not-a-real-flag"] }))).toBe(EXIT_USAGE);
  });
});

describe("the manifest-selected handler", () => {
  it("is the run function itself, carrying no metadata of its own", () => {
    expect(catalogRunCommand).toBe(runCatalog);
    expect(Object.hasOwn(catalogRunCommand, "meta")).toBe(false);
  });
});

describe("what the verb actually renders", () => {
  const commands = discoverCommands({ groups: NOUN_GROUPS });

  it("emits JSON that parses and names every discovered verb", () => {
    const parsed = parseOwnJson<readonly unknown[]>({ text: renderCatalogJson({ commands }) });
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(commands.length);
  });

  it("emits a human catalog containing a known verb and its noun", () => {
    const text = renderCatalog({ commands });
    expect(text.includes("doctor")).toBe(true);
    expect(text.includes("catalog")).toBe(true);
  });

  it("emits capabilities containing a known verb", () => {
    expect(renderCapabilities({ commands }).includes("doctor")).toBe(true);
  });

  it("discovers a non-empty surface, so the three assertions above cannot pass vacuously", () => {
    expect(commands.length > 0).toBe(true);
  });
});
