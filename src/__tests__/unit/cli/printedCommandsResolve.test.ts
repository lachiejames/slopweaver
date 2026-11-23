/**
 * Every command the CLI prints as an instruction, in the four delimited shapes below, resolves to a real
 * verb and flags.
 *
 * A refusal, a door label or a manifest example is read as the next thing to type. `doorRefusal.ts` prints
 * `To override use the designated escape hatch <incantation> <command>`, so a wrong `command` is a re-run
 * line that cannot run: "a confident lie at the exact moment of failure … worse than a bare refusal"
 * (owner-ruled-additions.md § refusal-recommends-a-key-shape-that-cannot-work). Once, eleven such
 * strings named verbs or flags that did not exist (`vanta deactivate`, `gmail modify`, `notion write`,
 * `github request-review`, `pr update --body`, `slack probe --param` among them), and nothing checked any.
 *
 * Four populations, each resolved by `resolveInvocation` (`src/canon/staleReferences.ts`, the resolver
 * the canon sweep already trusts) against the live manifest:
 *
 *  - every escape-hatch row whose `command` is a `slopweaver …` invocation;
 *  - every manifest `meta.example`, from the row's OWN `slopweaver <noun> [<verb>]` prefix, so an example
 *    piped in from `echo`/`printf` or chained after another verb with `&&` is still checked as its own verb;
 *  - every double-quoted `command: "slopweaver …"` literal in non-test `src/**\/*.ts` — the door-refusal
 *    labels, the hatch rows again and any literal command map;
 *  - every backticked `` `slopweaver …` `` inside a string or template literal in that same source, read
 *    off the TypeScript AST so a comment never counts — the remedy a refusal or error message names
 *    (`profile owner set` and `sync slack` were two, neither a real verb).
 *
 * What this does NOT prove, stated rather than implied:
 *
 *  - a third word is checked only where the verb's usage declares a closed set of sub-commands straight
 *    after it (`github pr <update|…>`, `write vanta <deactivate | …>`), or where no usage line takes a
 *    word after the verb at all (`profile show set` is refused); a verb taking an open argument
 *    (`<id>`) reads any third word as that argument. Flags are still checked against the
 *    verb's whole usage, not the sub-command's, so `github pr summary --form` passes. A noun whose default
 *    verb takes a word after the noun reads an unknown second word as that argument (`connect slack
 *    --check`), so a misspelt verb on such a noun passes.
 *  - the string-literal population skips a fragment that only names a noun (`slopweaver atlas`), and reads
 *    a template's `${…}` as a placeholder, so whatever it interpolates is not checked.
 *  - the registry's alternation shorthand (`slack post|reply`, `github <enqueue|merge --admin>`) is expanded
 *    and every alternative resolved, but a whole-token placeholder (`atlas <platform> read`,
 *    `slopweaver <any verb>`) is a template the reader fills in and is not resolved past the noun.
 *  - an instruction printed as plain prose, with no backticks and no `command:` key (`run slopweaver plans
 *    sync-accounts`), is not collected: nothing in such a string marks where the command ends and the
 *    sentence resumes, so reading one would resolve prose as flags and arguments.
 *  - the backticked scan never reads a COMMENT, and the `command:` scan reads one only when it happens to
 *    spell `command: "slopweaver …"`, so a command named in prose in a JSDoc block is unguarded. The
 *    drawdown store's `codex watch --release <episodeId>` recovery note was one; its row in the first table
 *    below witnesses the resolver rejecting that string, not a scan finding it again if it came back.
 *  - a TEMPLATE literal or computed command is not collected (`slopweaver notion page ${verb}`,
 *    `slopweaver outlook ${verb}`); those are typed by their own verb unions instead.
 *  - a flag inside a double-quoted span is not checked: the resolver skips quoted text on purpose, because
 *    `cmux send --workspace <ws> "claude --resume <uuid>"` types another program's flags. So a hatch row
 *    carrying a quoted flag at all is refused outright below; a manifest example quoting its own flag
 *    would still pass.
 *  - flags are checked against the advertised USAGE, not by running a parser. Running a verb on a valid
 *    example performs it (`dryParseSafe` covers only no-args, `--help` and an unknown flag), so usage is the
 *    safe witness, and `helpTruth.test.ts` ties usage to the real parsers.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import { addressesFromManifestModules, resolveInvocation } from "../../../canon/staleReferences.js";
import { DEFAULT_VERB } from "../../../cli/manifest.js";
import { MANIFEST_MODULES } from "../../../cli/manifests/index.js";
import { ESCAPE_HATCHES } from "../../../hatch/registry.js";
import { workingTreeFilesOf } from "../../../lib/gitRepo.js";
import { readTextAhead } from "../../../lib/readAhead.js";
import { scanTextFiles } from "../../../lib/textFileScan.js";

const ADDRESSES = addressesFromManifestModules({ modules: MANIFEST_MODULES });

/** A double-quoted `command: "slopweaver …"` property, the shape every literal door label and hatch row uses. */
const COMMAND_LITERAL = /\bcommand:\s*"(slopweaver [^"\n]+)"/g;

/** A backticked `slopweaver …` command inside printed text. */
const BACKTICKED_COMMAND = /`(slopweaver [^`]+)`/g;

/** The repository root, four levels above this file. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** Every non-test TypeScript source path, the tree a printed command is written in. */
const SOURCE_PATHS = workingTreeFilesOf({ pathspec: "src", root: ROOT }).filter(
  (path) => path.endsWith(".ts") && !path.startsWith("src/__tests__/"),
);

/** The one concurrent read of {@link SOURCE_PATHS}, started by whichever scan asks first and only ever read. */
let sourceReader: Promise<(args: { path: string }) => string> | undefined;

/**
 * The one read-ahead of every source path, started by whichever scan asks first.
 *
 * @returns the pending read-ahead every later caller shares
 */
function sharedReadAhead(): Promise<(args: { path: string }) => string> {
  if (sourceReader !== undefined) {
    return sourceReader;
  }
  sourceReader = readTextAhead({ paths: SOURCE_PATHS, root: ROOT });
  return sourceReader;
}

/**
 * A reader over every source path, read once for the two whole-tree scans below rather than once each. A path the
 * read-ahead could not read is read again from disk at scan time, exactly as each scan read it alone, so a failure
 * one case met is never carried into another: a path still unreadable then is recorded unreadable by that scan.
 *
 * @returns the shared reader
 */
async function readSources(): Promise<(args: { path: string }) => string> {
  const ahead = await sharedReadAhead();
  return ({ path }) => {
    try {
      return ahead({ path });
    } catch {
      return readFileSync(join(ROOT, path), "utf8");
    }
  };
}

/**
 * The `slopweaver …` invocations in one backticked fragment. A fragment may pipe or chain one verb into
 * another (`cycle reconcile --form | slopweaver slack post --as bot`), and each side is its own command with
 * its own flags, so the fragment is split on a spaced `|`, `&&` or `;` first. An unspaced `|` is the
 * alternation shorthand and stays.
 */
function chainSegments({ fragment }: { fragment: string }): readonly string[] {
  return fragment
    .split(/\s+(?:\||&&|;)\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.startsWith("slopweaver "));
}

/**
 * The text of every string-like literal in one source file, never a comment. A template's interpolations
 * read as `<expr>`, a placeholder, so a command spanning one (`attach status --org ${org}`) is still whole.
 */
function literalTexts({ path, content }: { path: string; content: string }): readonly string[] {
  const texts: string[] = [];
  const visit: NodeVisitor = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      texts.push(node.text);
    }
    if (ts.isTemplateExpression(node)) {
      texts.push(node.head.text + node.templateSpans.map((span) => `<expr>${span.literal.text}`).join(""));
    }
    forEachChild({ node, visit });
  };
  withSourceFile({ fileName: path, text: content, use: (source) => visit(source) });
  return texts;
}

/**
 * Whether a backticked fragment only NAMES a noun (`slopweaver atlas`, `slopweaver cmux …`) rather than
 * telling the reader to run something. Printed prose names a noun the way a doc does; a hatch row or a
 * door label never does, so this is read only for the string-literal population.
 */
function namesOnlyANoun({ command }: { command: string }): boolean {
  const words = command.split(/\s+/).slice(1);
  return words.length === 1 || (words.length === 2 && words[1] === "…");
}

/** One printed command and where it came from, so a failure names the row to fix. */
interface PrintedCommand {
  readonly source: string;
  readonly command: string;
}

/**
 * Where `words` first occurs in `text` as whole words, or -1. Whole words so `slopweaver git` never matches
 * inside `slopweaver github`.
 */
function wordOffset({ text, words }: { text: string; words: string }): number {
  const escaped = words.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)(${escaped})(?=\\s|$)`).exec(text);
  return match === null ? -1 : match.index + match[0].length - match[1]!.length;
}

/** A verb word as the resolver reads one: lowercase, unbracketed. */
const VERB_WORD = /^[a-z][a-z0-9-]*$/;

/** A verb slot written as alternatives in the house shorthand, `post|reply` or `tick-record|sweep-prompt`. */
const VERB_ALTERNATION = /^[a-z][a-z0-9-]*(?:\|[a-z][a-z0-9-]*)+$/;

/** A whole-token placeholder with no alternatives in it, `<platform>`: a template the reader fills in. */
const PLACEHOLDER = /^<[^<>|]+>$/;

/** A bracketed group, `<enqueue|merge --admin>` or `<platform>`; one carrying a `|` lists alternatives. */
const BRACKETED_GROUP = /<([^<>]+)>/g;

/** Every noun with a bare default verb, so naming no verb on it is still a real invocation. */
const NOUNS_WITH_DEFAULT = new Set(ADDRESSES.filter((address) => address.verb === DEFAULT_VERB).map((a) => a.noun));

/** Every noun the manifest knows. */
const KNOWN_NOUNS = new Set(ADDRESSES.map((address) => address.noun));

/**
 * The concrete invocations a printed command's alternation shorthand stands for. The registry writes
 * `slack post|reply --draft` and `github <enqueue|merge --admin>`, and the resolver stops at the first
 * punctuated word, so an unexpanded one would read as the bare noun and pass whatever its verb said.
 */
function alternatives({ command }: { command: string }): readonly string[] {
  const group = Array.from(command.matchAll(BRACKETED_GROUP)).find((candidate) => candidate[1]!.includes("|"));
  if (group !== undefined) {
    const before = command.slice(0, group.index);
    const after = command.slice(group.index + group[0].length);
    return group[1]!.split("|").flatMap((choice) => alternatives({ command: `${before}${choice.trim()}${after}` }));
  }
  const words = command.split(/\s+/);
  const verb = words[2];
  if (verb !== undefined && VERB_ALTERNATION.test(verb)) {
    return verb
      .split("|")
      .flatMap((choice) => alternatives({ command: [...words.slice(0, 2), choice, ...words.slice(3)].join(" ") }));
  }
  return [command];
}

/**
 * The one shape `resolveInvocation` passes on purpose and a printed instruction must not: a known noun with
 * no default verb, followed by no verb word at all. Prose may name a bare noun; a re-run line may not.
 */
function verbless({ command }: { command: string }): readonly string[] {
  const [, noun, verb] = command.split(/\s+/);
  if (noun === undefined || !KNOWN_NOUNS.has(noun) || NOUNS_WITH_DEFAULT.has(noun)) {
    return [];
  }
  if (verb !== undefined && (VERB_WORD.test(verb) || PLACEHOLDER.test(verb))) {
    return [];
  }
  return [`verbless — \`${command}\` names no verb of \`${noun}\`, which has no default`];
}

/**
 * The sub-command words a verb's own usage declares straight after it, `usage: slopweaver github pr
 * <update|request-review|…>` or `usage: slopweaver write vanta <create-document | deactivate | …>`, or null
 * when its first positional is not a closed set of words.
 */
function declaredSubcommands({ noun, verb }: { noun: string; verb: string }): ReadonlySet<string> | null {
  const address = ADDRESSES.find((candidate) => candidate.noun === noun && candidate.verb === verb);
  if (address === undefined) {
    return null;
  }
  const declared = new RegExp(`usage: slopweaver ${noun} ${verb} <([^<>]+)>`).exec(address.usage);
  if (declared === null) {
    return null;
  }
  const words = declared[1]!.split("|").map((word) => word.trim());
  if (words.length < 2 || !words.every((word) => VERB_WORD.test(word))) {
    return null;
  }
  return new Set(words);
}

/**
 * Whether a named verb's usage takes a word straight after it: `profile show [--json]` does
 * not, so `profile show set` is an argument it refuses. Every usage line counts, the indented continuation
 * lines with no `usage:` prefix included (`profile standing add <id>` sits on the second), so one line taking a
 * word is enough. Null when no line spells `<noun> <verb>` (an alias of the default, documented under the bare
 * noun), which this cannot judge.
 */
function verbTakesAWord({ noun, verb }: { noun: string; verb: string }): boolean | null {
  const address = ADDRESSES.find((candidate) => candidate.noun === noun && candidate.verb === verb);
  if (address === undefined) {
    return null;
  }
  const lines = [
    ...address.usage.matchAll(new RegExp(`^\\s*(?:usage:\\s+)?slopweaver ${noun} ${verb}(?: (\\S+))?(?:\\s|$)`, "gm")),
  ];
  if (lines.length === 0) {
    return null;
  }
  return lines.some((line) => {
    const token = line[1];
    return token !== undefined && !token.startsWith("--") && !token.startsWith("[--");
  });
}

/**
 * A third word the resolver never reads: where the verb's usage declares a closed set of sub-commands, a
 * literal third word must be one of them, so `github pr boguss` fails where `github pr` alone resolved; and
 * where the usage takes no word at all, a literal third word is an argument the verb refuses.
 */
function unknownSubcommand({ command }: { command: string }): readonly string[] {
  const [, noun, verb, sub] = command.split(/\s+/);
  if (noun === undefined || verb === undefined || sub === undefined || !VERB_WORD.test(sub)) {
    return [];
  }
  const declared = declaredSubcommands({ noun, verb });
  if (declared === null) {
    if (verbTakesAWord({ noun, verb }) !== false) {
      return [];
    }
    return [`unexpected-argument — \`${noun} ${verb}\` takes no word after it, but is given \`${sub}\``];
  }
  if (declared.has(sub)) {
    return [];
  }
  return [`unknown-subcommand — no \`${sub}\` on \`${noun} ${verb}\`, whose usage declares ${[...declared].join("|")}`];
}

/**
 * Whether a noun's bare default verb takes a word straight after the noun, read off its usage: `connect
 * <github|slack|…>` does, so `connect slack` is that default with an argument; `profile show [--json]` does
 * not, so `profile owner` can only be a verb, and there is none.
 */
function defaultTakesAWord({ noun }: { noun: string }): boolean {
  const address = ADDRESSES.find((candidate) => candidate.noun === noun && candidate.verb === DEFAULT_VERB);
  if (address === undefined) {
    return false;
  }
  const next = new RegExp(`usage: slopweaver ${noun}(?: [a-z][a-z0-9-]*)?(?: (\\S+))?`).exec(address.usage);
  const token = next?.[1];
  return token !== undefined && !token.startsWith("--") && !token.startsWith("[--");
}

/**
 * The second case `resolveInvocation` passes on purpose: a noun WITH a default reads any unknown second word
 * as the default's argument. Where the default takes no word, that second word can only be a verb.
 */
function unknownVerbBesideDefault({ command }: { command: string }): readonly string[] {
  const [, noun, verb] = command.split(/\s+/);
  if (noun === undefined || verb === undefined || !NOUNS_WITH_DEFAULT.has(noun) || !VERB_WORD.test(verb)) {
    return [];
  }
  const known = ADDRESSES.some((address) => address.noun === noun && address.verb === verb);
  if (known || defaultTakesAWord({ noun })) {
    return [];
  }
  return [`unknown-verb — no verb \`${verb}\` on noun \`${noun}\`, whose default takes no word`];
}

/** Every way the given commands fail to resolve, each tagged with its source. */
function unresolved({ commands }: { commands: readonly PrintedCommand[] }): readonly string[] {
  return commands.flatMap(({ source, command }) =>
    alternatives({ command }).flatMap((concrete) => [
      ...verbless({ command: concrete }).map((problem) => `${source}: ${problem}`),
      ...unknownSubcommand({ command: concrete }).map((problem) => `${source}: ${problem}`),
      ...unknownVerbBesideDefault({ command: concrete }).map((problem) => `${source}: ${problem}`),
      ...resolveInvocation({ addresses: ADDRESSES, fragment: concrete }).map(
        (offender) => `${source}: ${offender.kind} — ${offender.detail}`,
      ),
    ]),
  );
}

describe("the resolver catches the strings this guard was written for", () => {
  it.each([
    { command: "slopweaver vanta deactivate", kind: "unknown-noun" },
    { command: "slopweaver gmail modify", kind: "unknown-verb" },
    { command: "slopweaver notion write", kind: "unknown-verb" },
    { command: "slopweaver github request-review", kind: "unknown-verb" },
    { command: "slopweaver github pr update --body", kind: "unknown-flag" },
    { command: "slopweaver codex watch --release <episodeId>", kind: "unknown-flag" },
    { command: "slopweaver slack probe --method conversations.history --param channel=C123", kind: "unknown-flag" },
    { command: "slopweaver turn answer --surface dm", kind: "unknown-flag" },
  ])("$command is $kind", ({ command, kind }) => {
    expect(resolveInvocation({ addresses: ADDRESSES, fragment: command }).map((offender) => offender.kind)).toEqual([
      kind,
    ]);
  });

  it.each([
    "slopweaver write vanta deactivate",
    "slopweaver gmail archive",
    "slopweaver notion page",
    "slopweaver github pr request-review",
    "slopweaver github pr update --form",
    "slopweaver slack probe --method conversations.history channel=C123 limit=1",
  ])("%s resolves", (command) => {
    expect(resolveInvocation({ addresses: ADDRESSES, fragment: command })).toEqual([]);
  });
});

describe("the guard reads the registry's alternation shorthand as every alternative", () => {
  it.each([
    {
      command: "slopweaver slack post|reply --draft",
      expanded: ["slopweaver slack post --draft", "slopweaver slack reply --draft"],
    },
    {
      command: "slopweaver github <enqueue|merge --admin>",
      expanded: ["slopweaver github enqueue", "slopweaver github merge --admin"],
    },
    { command: "slopweaver atlas <platform> read", expanded: ["slopweaver atlas <platform> read"] },
    { command: "slopweaver doctor | jq", expanded: ["slopweaver doctor | jq"] },
  ])("$command expands to $expanded", ({ command, expanded }) => {
    expect(alternatives({ command })).toEqual(expanded);
  });

  it("an alternative naming no real verb fails, where the unexpanded string passed the resolver", () => {
    const command = "slopweaver slack post|bogus --draft";
    expect(resolveInvocation({ addresses: ADDRESSES, fragment: command })).toEqual([]);
    expect(unresolved({ commands: [{ command, source: "witness" }] })).toEqual([
      "witness: unknown-verb — no verb `bogus` on noun `slack`",
    ]);
  });

  it("a misspelt sub-command fails against the verb's declared set, where the resolver passed it", () => {
    const command = "slopweaver github pr boguss";
    expect(resolveInvocation({ addresses: ADDRESSES, fragment: command })).toEqual([]);
    expect(unresolved({ commands: [{ command, source: "witness" }] })).toEqual([
      "witness: unknown-subcommand — no `boguss` on `github pr`, whose usage declares update|request-review|retarget|release-reservation|summary|standing|reviewers|review-prepare|review-record",
    ]);
  });

  it("a real sub-command passes on every verb that declares a set", () => {
    expect(declaredSubcommands({ noun: "write", verb: "vanta" })!.has("deactivate")).toBe(true);
    expect(unresolved({ commands: [{ command: "slopweaver github pr update --form", source: "witness" }] })).toEqual(
      [],
    );
  });

  it("a known noun with no default and no verb word fails, where the resolver passed it", () => {
    const command = "slopweaver slack --draft";
    expect(resolveInvocation({ addresses: ADDRESSES, fragment: command })).toEqual([]);
    expect(unresolved({ commands: [{ command, source: "witness" }] })).toEqual([
      "witness: verbless — `slopweaver slack --draft` names no verb of `slack`, which has no default",
    ]);
  });
});

describe("every command the CLI prints as an instruction resolves", () => {
  it("every escape-hatch row's slopweaver command", () => {
    const commands = ESCAPE_HATCHES.filter((hatch) => hatch.command.startsWith("slopweaver ")).map((hatch) => ({
      command: hatch.command,
      source: `hatch ${hatch.id}`,
    }));
    expect(commands.length).toBeGreaterThan(0);
    // The resolver skips quoted text, so a quoted flag here would never be checked: refuse the shape.
    expect(commands.filter(({ command }) => /"[^"]*--/.test(command)).map(({ source }) => source)).toEqual([]);
    expect(unresolved({ commands })).toEqual([]);
  });

  it("every manifest example, read from its own verb's prefix", () => {
    const examples = MANIFEST_MODULES.flatMap((module) =>
      Object.entries(module.verbs).flatMap(([verb, entry]) =>
        entry.meta.example === null ? [] : [{ example: entry.meta.example, noun: module.noun, verb }],
      ),
    );
    expect(examples.length).toBeGreaterThan(0);
    // A named verb that aliases its noun's default (`doctor run`, `catalog list`) is exemplified as the bare
    // noun (`slopweaver doctor`), so the noun's own prefix is the fallback; an example naming neither is the
    // failure, since a piped or chained one would otherwise be skipped silently.
    const located = examples.map(({ example, noun, verb }) => {
      const verbOffset = wordOffset({ text: example, words: `slopweaver ${noun} ${verb}` });
      const offset =
        verb !== DEFAULT_VERB && verbOffset !== -1
          ? verbOffset
          : wordOffset({ text: example, words: `slopweaver ${noun}` });
      return { example, offset, source: `example ${noun} ${verb}`.trimEnd() };
    });
    expect(located.filter(({ offset }) => offset === -1).map(({ source, example }) => `${source}: ${example}`)).toEqual(
      [],
    );
    const commands = located.map(({ example, offset, source }) => ({ command: example.slice(offset), source }));
    expect(unresolved({ commands })).toEqual([]);
  });

  it("every double-quoted command: literal in non-test source", async () => {
    const result = scanTextFiles({
      paths: SOURCE_PATHS,
      readText: await readSources(),
      scan: ({ content, path }) =>
        Array.from(content.matchAll(COMMAND_LITERAL), (match) => ({ command: match[1]!, source: path })),
    });
    expect(result.unreadable).toEqual([]);
    expect(result.scanned).toBeGreaterThan(0);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(unresolved({ commands: result.hits })).toEqual([]);
  });

  // A whole-tree read on a loaded CI shard runs several times slower than here, so it gets headroom.
  it(
    "every backticked slopweaver command inside a string literal in non-test source",
    { timeout: 60_000 },
    async () => {
      const result = scanTextFiles({
        paths: SOURCE_PATHS,
        readText: await readSources(),
        // Parsing every file timed out CI's default 20s on a shard (8s here); one without a backticked
        // `slopweaver ` anywhere in its source (an escaped backtick in a template still reads as one) cannot
        // hold a hit, so it is skipped unparsed, which took this case to 3.7s here.
        scan: ({ content, path }) =>
          (content.includes("`slopweaver ") ? literalTexts({ content, path }) : []).flatMap((text) =>
            Array.from(text.matchAll(BACKTICKED_COMMAND), (match) =>
              chainSegments({ fragment: match[1]! })
                .filter((command) => !namesOnlyANoun({ command }))
                .map((command) => ({ command, source: path })),
            ).flat(),
          ),
      });
      expect(result.unreadable).toEqual([]);
      expect(result.scanned).toBeGreaterThan(0);
      expect(result.hits.length).toBeGreaterThan(0);
      expect(unresolved({ commands: result.hits })).toEqual([]);
    },
  );
});

describe("the string-literal population reads printed text, never a comment", () => {
  it("collects a backticked command from a string and a template, and none from a comment", () => {
    const content = [
      "// run `slopweaver comment only` in a comment",
      'const a = "seed one with `slopweaver profile set --file <owner.json>`";',
      "const b = `run \\`slopweaver refresh --source slack\\` to refresh ${x}`;",
      "const c = `confirm with \\`slopweaver github attach status --org ${org}\\``;",
    ].join("\n");
    const found = literalTexts({ content, path: "witness.ts" }).flatMap((text) =>
      Array.from(text.matchAll(BACKTICKED_COMMAND), (match) => match[1]!),
    );
    expect(found).toEqual([
      "slopweaver profile set --file <owner.json>",
      "slopweaver refresh --source slack",
      "slopweaver github attach status --org <expr>",
    ]);
  });

  it("splits a piped chain into its own commands and keeps the alternation shorthand whole", () => {
    expect(
      chainSegments({
        fragment: "slopweaver cycle reconcile --form | slopweaver slack post --as bot --channel <id> --form -",
      }),
    ).toEqual(["slopweaver cycle reconcile --form", "slopweaver slack post --as bot --channel <id> --form -"]);
    expect(chainSegments({ fragment: "slopweaver slack post|reply --draft" })).toEqual([
      "slopweaver slack post|reply --draft",
    ]);
  });

  it("the remedies this population found fail on the old text", () => {
    expect(
      unresolved({
        commands: [
          { command: "slopweaver profile owner set", source: "context/load.ts" },
          { command: "slopweaver sync slack", source: "live/listen/witnessErrors.ts" },
          { command: "slopweaver github attach import", source: "attach.errors.ts" },
          { command: "slopweaver github attach login --org <expr>", source: "attach.errors.ts" },
          { command: "slopweaver profile show set", source: "context/load.ts" },
        ],
      }),
    ).toEqual([
      "context/load.ts: unknown-verb — no verb `owner` on noun `profile`, whose default takes no word",
      "live/listen/witnessErrors.ts: unknown-noun — no noun `sync` in the CLI manifest",
      "attach.errors.ts: unknown-subcommand — no `import` on `github attach`, whose usage declares upload|status",
      "attach.errors.ts: unknown-subcommand — no `login` on `github attach`, whose usage declares upload|status",
      "context/load.ts: unexpected-argument — `profile show` takes no word after it, but is given `set`",
    ]);
  });
});
