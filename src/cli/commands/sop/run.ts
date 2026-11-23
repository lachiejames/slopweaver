/**
 * `slopweaver sop draft`, `sop lint` and `sop publish` — the effectful shells.
 *
 * `draft` renders a validated form into the house SOP markdown with pure code and writes it; `lint` reads a
 * file and reports; `publish` lints the bytes and then invokes `notion page` with them. Neither `draft` nor
 * `lint` touches the network, and no model runs in any of the three.
 *
 * ## `publish` is a composition, not a second Notion writer
 *
 * There is exactly one path from this program to a Notion page, and an SOP is one caller of it — so the
 * ownership ledger, the authorship check, the bare-reference linkifier, the lead's voice gate and the door
 * record are the same ones `notion page` already carries, rather than a parallel set that could drift.
 *
 * ## The lint gate is what makes `publish` different from `notion page`
 *
 * `notion page` will publish any markdown. `sop publish` REFUSES a document missing a house section, a step
 * with no named actor, an unfilled `TODO`, an untraceable source, or a deleted unreviewed-draft notice.
 *
 * ## Nothing here posts anywhere, and that is deliberate
 *
 * A published SOP is a page, not an announcement. Telling the team a procedure now exists is the owner's
 * act, under their own name, through `slack post --as me` — so there is no teaser, no channel flag and no send.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "../../../lib/logger.js";

import { lintSop, sopFindingLines } from "../../../outbound/sop/lint.js";
import { renderSop, sopEmoji, sopTitle } from "../../../outbound/sop/render.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseSopDraftArgs, parseSopForm, parseSopLintArgs, parseSopPublishArgs, sopPublishTarget } from "./core.js";
import { SOP_FORM_EXAMPLE } from "./formExample.js";

/** Where a verb's own arguments start in `process.argv`: after node, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** What `notion page` reported back, reduced to what this verb needs. */
export interface SopPublishOutcome {
  readonly code: number;
  readonly pageUrl: string | undefined;
}

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface SopDeps {
  readonly readText: (args: { source: string }) => string;
  readonly writeText: (args: { path: string; text: string }) => void;
  readonly publishPage: (args: {
    markdown: string;
    home: string;
    title: string | undefined;
    icon: string | undefined;
    parent: string | undefined;
    page: string | undefined;
    /** Where the draft's `file:` image placeholders resolve from — the draft file's own directory. */
    mediaBase: string;
    dryRun: boolean;
  }) => Promise<SopPublishOutcome>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** Print each line to stderr and return the code. */
function refuse({ deps, lines, code }: { deps: SopDeps; lines: readonly string[]; code: number }): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/**
 * Run `sop draft`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runSopDraft({ argv, deps }: { argv: readonly string[]; deps: SopDeps }): Promise<number> {
  const parsed = parseSopDraftArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: parsed.error });
  }
  const args = parsed.value;
  if (args.kind === "example") {
    deps.out(JSON.stringify(SOP_FORM_EXAMPLE, null, 2));
    return EXIT_OK;
  }
  const form = parseSopForm({ raw: deps.readText({ source: args.formSource }) });
  if (form.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: form.error });
  }
  const markdown = renderSop({ form: form.value });
  if (args.out === undefined) {
    deps.out(markdown.trimEnd());
  } else {
    deps.writeText({ path: args.out, text: markdown });
    deps.err(`draft written: ${args.out}`);
    deps.err(`title: ${sopTitle({ form: form.value })}   icon: ${sopEmoji({ form: form.value })}`);
  }
  const { findings, blocked } = lintSop({ markdown });
  for (const line of sopFindingLines({ findings })) {
    deps.err(line);
  }
  // The DRAFT verb never fails on its own lint. The renderer owns the shape and got it right; reporting
  // anything it found while still handing over the file is what lets the session fix it. `publish` refuses.
  deps.err(blocked ? "lint: fix the blocking findings above before publishing." : "lint: clean");
  return EXIT_OK;
}

/**
 * Run `sop lint`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns 0 when nothing blocks, 2 when something does, or a usage code
 */
export async function runSopLint({ argv, deps }: { argv: readonly string[]; deps: SopDeps }): Promise<number> {
  const parsed = parseSopLintArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: parsed.error });
  }
  const args = parsed.value;
  let markdown: string;
  try {
    markdown = deps.readText({ source: args.path });
  } catch {
    return refuse({ code: EXIT_ERROR, deps, lines: [`cannot read ${args.path}`] });
  }
  const { findings, blocked } = lintSop({ markdown });
  // A blocking finding exits `EXPECTED_EMPTY`, never `USAGE`. The linter ran perfectly and found something,
  // which is the diagnostic channel; `USAGE` would say the command itself was typed wrong.
  const code = blocked ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  if (args.json) {
    deps.out(JSON.stringify({ blocked, findings }, null, 2));
    return code;
  }
  for (const line of sopFindingLines({ findings })) {
    deps.err(line);
  }
  if (!blocked) {
    deps.out("sop: 0 blocking findings — ready to publish");
    return EXIT_OK;
  }
  deps.err("not ready: fix the blocking findings above, then re-run.");
  return code;
}

/**
 * Run `sop publish`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runSopPublish({ argv, deps }: { argv: readonly string[]; deps: SopDeps }): Promise<number> {
  const parsed = parseSopPublishArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: parsed.error });
  }
  const args = parsed.value;
  let markdown: string;
  try {
    markdown = deps.readText({ source: args.path });
  } catch {
    return refuse({ code: EXIT_ERROR, deps, lines: [`cannot read ${args.path}`] });
  }
  const { findings, blocked } = lintSop({ markdown });
  for (const line of sopFindingLines({ findings })) {
    deps.err(line);
  }
  if (blocked) {
    return refuse({
      code: EXIT_EXPECTED_EMPTY,
      deps,
      lines: ["refusing to publish: fix the blocking findings above first."],
    });
  }
  const target = sopPublishTarget({ page: args.page, parent: args.parent });
  if (target.kind === "refused") {
    return refuse({ code: EXIT_USAGE, deps, lines: [target.reason] });
  }
  const outcome = await deps.publishPage({
    dryRun: args.dryRun,
    home: resolveHome({ named: args.home }),
    icon: args.icon,
    // The draft file's own directory, because `![](file:./shots/x.png)` in a draft means relative to the
    // draft. The body reaches `notion page` on stdin, so it has nothing else to resolve against.
    mediaBase: dirname(args.path),
    markdown,
    page: target.kind === "update" ? target.page : undefined,
    parent: target.kind === "create" ? target.parent : undefined,
    title: args.title,
  });
  if (!args.dryRun && outcome.pageUrl !== undefined) {
    deps.err("the page is not proven until a browser has looked at it. Run:");
    deps.err(`  slopweaver notion verify ${outcome.pageUrl}`);
    deps.err("Telling anyone it exists is the owner's act, under their own name — this verb never posts.");
  }
  return outcome.code;
}

/**
 * The live edges, with `publishPage` delegating to the `notion page` command rather than to a second writer.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionSopDeps(): SopDeps {
  return {
    err: (line) => process.stderr.write(`sop: ${line}\n`),
    out: (line) => {
      logger.out({ line });
    },
    publishPage: async ({ markdown, home, title, icon, parent, page, mediaBase, dryRun }) => {
      // Imported lazily so `draft` and `lint` never load the Notion client at all.
      const { productionNotionPageDeps, runNotionPage } = await import("../notion/pageRun.js");
      const base = productionNotionPageDeps();
      let pageUrl: string | undefined;
      const code = await runNotionPage({
        argv: [
          "node",
          "slopweaver",
          "notion",
          "page",
          page === undefined ? "create" : "update",
          // `parent!` is honest: `sopPublishTarget` returns `create` only when a parent was resolved, and a
          // fallback here would send an empty parent to the provider instead of failing where it is wrong.
          ...(page === undefined ? ["--parent", parent!] : ["--page", page]),
          ...(title === undefined ? [] : ["--title", title]),
          ...(icon === undefined ? [] : ["--icon", icon]),
          ...(dryRun ? ["--dry-run"] : []),
          "--media-base",
          mediaBase,
          "--body",
          "-",
          "--home",
          home,
        ],
        deps: {
          ...base,
          out: (line) => {
            // The URL is read out of the verb's OWN report rather than returned by a second code path, so
            // the two can never disagree about what was published.
            if (line.startsWith("https://")) {
              pageUrl = line.trim();
            }
            base.out(line);
          },
          readBody: () => markdown,
        },
      });
      return { code, pageUrl };
    },
    readText: ({ source }) => (source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8")),
    writeText: ({ path, text }) => {
      writeFileSync(path, text);
    },
  };
}

/** `slopweaver sop draft` — render the house SOP markdown from a typed form, then self-lint it. */
export const sopDraftCommand = defineCommand({
  run: (argv: readonly string[]) => runSopDraft({ argv, deps: productionSopDeps() }),
});

/** `slopweaver sop lint` — the house gate over one drafted procedure. */
export const sopLintCommand = defineCommand({
  run: (argv: readonly string[]) => runSopLint({ argv, deps: productionSopDeps() }),
});

/** `slopweaver sop publish` — lint-gated publish of a drafted SOP, through the one Notion write path. */
export const sopPublishCommand = defineCommand({
  run: (argv: readonly string[]) => runSopPublish({ argv, deps: productionSopDeps() }),
});
