/**
 * Catalog renderers — the human + machine views of the command registry, both derived from the SINGLE
 * `discoverCommands({ groups: NOUN_GROUPS })` source so they can never drift from what is actually wired:
 *   - `renderCatalog`     : the recall view ("what can slopweaver do"), every verb grouped by noun with
 *                           its one-line summary.
 *   - `renderCatalogJson` : the machine-enumerable surface a future planner / doc-sync consumes.
 *   - `renderCapabilities`: the self-describe view — every verb with its external-write + work-item hints.
 *
 * Every discovered verb carries its metadata, because the registry admits no other entry shape, so none of
 * these three has an "undescribed verb" arm to render or to count.
 *
 * The last two render the OTHER surface a reader arrives asking about — not what the system can do, but
 * where the code that does it lives. `renderTreeAtlas` / `renderTreeAtlasJson` take the derived
 * {@link CodebaseAtlas} (`src/canon/codebaseAtlas.ts`) the same way: a value in, a string out.
 *
 * Pure: take the discovered list, return a string. No I/O.
 */

import type { CodebaseAtlas } from "../canon/codebaseAtlas.js";
import type { DiscoveredCommand } from "./discoverCommands.js";

/** Group commands by noun, preserving the (already noun,verb-sorted) order. */
function byNoun<T extends { readonly noun: string }>({
  commands,
}: {
  commands: readonly T[];
}): readonly (readonly [string, readonly T[]])[] {
  const groups = new Map<string, T[]>();
  for (const command of commands) {
    const bucket = groups.get(command.noun) ?? [];
    bucket.push(command);
    groups.set(command.noun, bucket);
  }
  return [...groups.entries()];
}

const PAD = 16;

/**
 * Human recall view: every verb under its noun with its one-line summary.
 *
 * @param commands the discovered commands
 * @returns the rendered catalog text
 */
export function renderCatalog({ commands }: { commands: readonly DiscoveredCommand[] }): string {
  const nouns = byNoun({ commands });
  const header = `slopweaver — ${String(commands.length)} commands across ${String(nouns.length)} nouns`;
  const lines: string[] = [header];
  for (const [noun, verbs] of nouns) {
    lines.push("", noun);
    for (const command of verbs) {
      lines.push(`  ${command.verb.padEnd(PAD)} ${command.meta.summary}`);
    }
  }
  return lines.join("\n");
}

/**
 * JSON view — the machine-enumerable surface a future planner / doc-sync consumes.
 *
 * @param commands the discovered commands
 * @returns the pretty-printed JSON array
 */
export function renderCatalogJson({ commands }: { commands: readonly DiscoveredCommand[] }): string {
  return JSON.stringify(
    commands.map((c) => ({
      noun: c.noun,
      verb: c.verb,
      summary: c.meta.summary,
      ...(c.meta.example === null ? {} : { example: c.meta.example }),
      createsWorkItem: c.meta.createsWorkItem === true,
      externalWrite: c.meta.effect === "external-write",
    })),
    null,
    2,
  );
}

/**
 * A capability flag suffix: which documented verbs mutate something outside this machine, and which create
 * tracked work.
 *
 * This used to print `[approval]` from a `requiresApproval` boolean, which read as a safety property and was
 * one: nothing anywhere asked anyone anything, and the marker was on 37 verbs of which none was gated. It is
 * derived from `effect` now, which is the enforced field — `admit/coverage.ts` refuses an `external-write`
 * verb that is not door-routed. Whether a particular verb HOLDS for an approval is a property of the request
 * it makes, so it is stated in that verb's own summary rather than in a flag here; `src/admit/approval.ts`
 * carries the finding.
 */
function flags({ command }: { command: DiscoveredCommand }): string {
  const parts: string[] = [];
  if (command.meta.effect === "external-write") {
    parts.push("external-write");
  }
  if (command.meta.createsWorkItem === true) {
    parts.push("creates-work-item");
  }
  return parts.length === 0 ? "" : `  [${parts.join(", ")}]`;
}

/**
 * Self-describe view: every verb grouped by noun, with external-write / work-item hints.
 *
 * @param commands the discovered commands
 * @returns the rendered capabilities text
 */
export function renderCapabilities({ commands }: { commands: readonly DiscoveredCommand[] }): string {
  if (commands.length === 0) {
    return "No commands are registered.";
  }
  const header = `I can run ${String(commands.length)} described commands:`;
  const lines: string[] = [header];
  for (const [noun, verbs] of byNoun({ commands })) {
    lines.push("", noun);
    for (const command of verbs) {
      lines.push(`  ${command.verb.padEnd(PAD)} ${command.meta.summary}${flags({ command })}`);
    }
  }
  return lines.join("\n");
}

/**
 * The codebase atlas as a table: one row per top-level `src/` tree, with its blurb, its entry nouns and
 * the area rule that governs it.
 *
 * Skills and the import edges are deliberately NOT in this view. A terminal reader asking "where does this
 * live" is answered by the tree rows; the edges are a picture (the docs site draws them) and the skills are
 * already `ls skills/`. `--json` carries all three for anything that wants to draw them.
 *
 * @param atlas the derived atlas
 * @returns the rendered text
 */
export function renderTreeAtlas({ atlas }: { atlas: CodebaseAtlas }): string {
  const modules = atlas.trees.reduce((total, tree) => total + tree.modules, 0);
  const lines: string[] = [
    `slopweaver — ${String(atlas.trees.length)} top-level trees under src/, ${String(modules)} modules, ` +
      `${String(atlas.skills.length)} skills`,
  ];
  for (const tree of atlas.trees) {
    lines.push("", `${tree.tree}/  (${String(tree.modules)} modules)`);
    lines.push(`  ${tree.blurb}`);
    if (tree.entryNouns.length > 0) {
      lines.push(`  entered by: ${entryLine({ nouns: tree.entryNouns })}`);
    }
    if (tree.rulePath !== undefined) {
      lines.push(`  rule: ${tree.rulePath}`);
    }
    if (tree.dependsOn.length > 0) {
      lines.push(`  depends on: ${tree.dependsOn.join(", ")}`);
    }
  }
  return lines.join("\n");
}

/** How many entry nouns one tree row names before it says how many more there are. */
const NOUNS_SHOWN = 8;

/**
 * A tree's entry nouns, capped so a shared floor reached by ninety nouns does not become the whole page.
 *
 * @param nouns the nouns, already heaviest first
 * @returns the display string
 */
function entryLine({ nouns }: { nouns: readonly string[] }): string {
  if (nouns.length <= NOUNS_SHOWN) {
    return nouns.join(", ");
  }
  return `${nouns.slice(0, NOUNS_SHOWN).join(", ")} … +${String(nouns.length - NOUNS_SHOWN)} more`;
}

/**
 * The codebase atlas as JSON — every tree, every skill and every cross-tree edge, which is what the docs
 * site renders its atlas page and its map figure from.
 *
 * @param atlas the derived atlas
 * @returns the pretty-printed JSON document
 */
export function renderTreeAtlasJson({ atlas }: { atlas: CodebaseAtlas }): string {
  return JSON.stringify(atlas, null, 2);
}
