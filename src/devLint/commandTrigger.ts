/**
 * The gate that stops a skill shipping with metadata the skill listing cannot use.
 *
 * ## The defect, measured
 *
 * A skill is loaded by Claude Code from its YAML front matter, and the listing the model reads carries
 * `description` and NOTHING else — not the body, not `argument-hint`. So a sentence written to make a skill
 * fire has to live in the `description` or it cannot participate in the firing at all. The
 * `slack-read-thread` doc is the instructive case: it carried a perfectly good "when to use this without
 * being asked" paragraph in its BODY, which only loads once the skill has already been chosen.
 *
 * When this gate was written the same verbs lived in a `commands/` directory whose front matter carried a
 * second field, `when_to_use`, appended to the description in the listing. Sixteen of seventeen descriptions
 * said what the verb IS and never when to reach for it. The seventeenth, the `loop` doc, did carry trigger
 * phrases — spelled `Triggers: "run the bot"` inside a plain YAML scalar, which is not valid YAML at all,
 * because a plain scalar may not contain a colon followed by a space. It rendered anyway, so nothing said so.
 *
 * That directory is gone: every verb is now one `SKILL.md`, which both hosts read. `when_to_use` went with
 * it, and this gate now treats the field as a DEFECT rather than an alternative — see
 * {@link checkWhenToUseIsDead}. The measured history above is kept because it is why each check exists.
 *
 * ## What it checks, and what each check is grounded in
 *
 * Every property here comes from the documented contract rather than from a guess about any one parser:
 *
 * - the front matter exists and parses as YAML — the `loop` doc failed this while looking fine;
 * - `description` is a non-empty string, which is what the listing is built from;
 * - `description` fits {@link LISTING_MAX_CHARS}, because the listing truncates at that length. The loss is
 *   silent, and only in the model's view. Where a trigger clause falls inside a long description is not
 *   knowable here — that depends on how it was written — which is its own reason to keep the entry short;
 * - `when_to_use:` is ABSENT, because a skill's front matter has no such field and anything written there is
 *   read by nothing;
 * - the entry says WHEN to load, as a "use when …" clause in the description.
 *
 * ## What it does NOT prove, stated so nobody reads more into a green run
 *
 * It cannot tell whether a trigger phrase is accurate, whether two skills claim the same one, or whether the
 * model actually routes to the right skill. It is a floor against OMISSION — the defect that was actually
 * measured — and the semantic question stays a review obligation. A gate that overstated its reach would be
 * the exact failure this gate family exists to close.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/**
 * The `description` ceiling the skill listing truncates at.
 *
 * Configurable in the harness, so this is the documented default rather than a law. Held well below it in
 * practice, and deliberately without quoting how far, because the cost of an entry that silently loses its
 * trigger phrases is paid in skills that never fire.
 *
 * When commands still existed the listing appended `when_to_use` after a three-character separator, and this
 * ceiling covered the pair. It now covers the description alone, which is the whole of what the listing
 * renders.
 */
export const LISTING_MAX_CHARS = 1536;

/** One thing wrong with a skill's front matter. */
export interface CommandTriggerIssue {
  readonly kind: "frontmatter" | "yaml" | "description" | "when-to-use" | "listing-cap" | "trigger";
  readonly line: number;
  readonly message: string;
  readonly path: string;
}

/** The front-matter block, with the line it starts on so an issue can point at real coordinates. */
interface FrontMatter {
  readonly text: string;
  readonly firstFieldLine: number;
}

/**
 * Lift the YAML front matter out of a skill file.
 *
 * Requires the opening `---` to be the very first line: a block further down is body prose that happens to
 * look like front matter, and treating it as metadata would report issues about text the harness never reads.
 */
function frontMatterOf({ content }: { content: string }): FrontMatter | undefined {
  const lines = content.split("\n");
  if (lines[0] !== "---") {
    return undefined;
  }
  const closing = lines.indexOf("---", 1);
  if (closing === -1) {
    return undefined;
  }
  return { firstFieldLine: 2, text: lines.slice(1, closing).join("\n") };
}

/**
 * The repair advice for the one YAML failure this repo has actually shipped, attached only to it.
 *
 * The `loop` doc once carried `Triggers: "run the bot"` inside a plain scalar, which YAML reads as a nested
 * mapping. Naming the fix in the error saves the reader a spec lookup. It is CONDITIONAL because the same
 * sentence bolted onto an unrelated failure — a duplicate key, say — would be confident and wrong, which is
 * the defect class this gate family exists to close rather than reproduce.
 */
function colonSpaceHint({ failure }: { failure: string }): string {
  return /mapping/i.test(failure)
    ? ". A plain (unquoted) scalar cannot contain a colon followed by a space; move the phrases into " +
        "`when_to_use:` or quote the value"
    : "";
}

/**
 * Where a field is declared, for reporting. Falls back to the block's first line when it is absent.
 *
 * Searches the FRONT MATTER only, never the body. Review found the alternative: scanning the whole file made
 * a `description:` written in body prose answer for a front matter that had none, so the finding was right
 * and its line number pointed at text the harness never reads.
 *
 * Matches a QUOTED key as well as a bare one, because {@link stringField} reads the parsed document by
 * semantic key and YAML treats `"description":` as the same field. A line finder narrower than the parser it
 * reports for sends the reader to the wrong line while the finding itself is correct.
 *
 * Anchored at column zero, so an INDENTED key nested under some other mapping cannot answer for the
 * top-level field {@link stringField} actually read. Review found that too: `meta:` with a nested
 * `description:` reported the nested line for a front matter that has no top-level description.
 */
function lineOfField({ matter, field }: { matter: FrontMatter; field: string }): number {
  const declaration = new RegExp(`^["']?${field}["']?\\s*:`);
  const index = matter.text.split("\n").findIndex((line) => declaration.test(line));
  return index === -1 ? matter.firstFieldLine : index + matter.firstFieldLine;
}

/**
 * Whether the entry says WHEN to load, not only what the skill is.
 *
 * A "use when …" / "use whenever …" clause in the description is the shape the shipped reference skills use,
 * and it is now the only place that can carry the answer: the `when_to_use` field these verbs used to have
 * belonged to command files, which no longer exist. The clause has to sit within one sentence of the "use",
 * so a description that happens to contain both words paragraphs apart does not pass by accident.
 */
function statesWhenToLoad({ description }: { description: string }): boolean {
  return /\buse\b[^.!?]{0,120}?\bwhen(ever)?\b/i.test(description);
}

/**
 * Read a front-matter field as a string, separating "there is nothing here" from "this is not text".
 *
 * A `description:` holding a number or a mapping is a real defect rather than a missing field, so those are
 * kept apart for the caller to report differently. An explicit YAML `null` deliberately counts as ABSENT
 * rather than as a wrong type: `description:` with nothing after it, and `description: null`, are the same
 * situation for a reader and the same advice — write one. Saying "not a string" there would be technically
 * true and practically useless.
 */
function stringField({ document, field }: { document: ReturnType<typeof parseDocument>; field: string }): {
  readonly present: boolean;
  readonly value: string | undefined;
} {
  const raw = document.get(field);
  if (raw == null) {
    return { present: false, value: undefined };
  }
  return { present: true, value: typeof raw === "string" ? raw : undefined };
}

/**
 * Refuse a `when_to_use:` key, because a skill's front matter has no such field.
 *
 * These verbs used to live in `commands/`, where `when_to_use` was real: the listing appended it to the
 * description, and this gate charged its length against the ceiling. `SKILL.md` has no equivalent. The field
 * is not renamed, not deprecated and not merely ignored by one parser — it is read by nothing, so trigger
 * phrases written there participate in the firing exactly as much as trigger phrases written in the body,
 * which is not at all.
 *
 * That makes it worse than a missing description rather than better: the entry LOOKS like it says when to
 * load, in a field that used to be the right place for it, and the loss is invisible on both hosts. This is
 * the defect class the whole gate exists for, arriving through the door the migration opened.
 *
 * Refused whatever the value is — text, a number, a mapping, an explicit null. There is no shape of it that
 * the listing reads.
 *
 * @param document the parsed front matter
 * @param matter the front-matter block, which is where the declaration is located
 * @param path the repo-relative path, for reporting
 * @returns the issue, or undefined when the key is absent
 */
function checkWhenToUseIsDead({
  document,
  matter,
  path,
}: {
  document: ReturnType<typeof parseDocument>;
  matter: FrontMatter;
  path: string;
}): CommandTriggerIssue | undefined {
  if (!document.has("when_to_use")) {
    return undefined;
  }
  return {
    kind: "when-to-use",
    line: lineOfField({ field: "when_to_use", matter }),
    message:
      "`when_to_use:` is not a field a skill has — the listing reads `description` and nothing else, so " +
      "whatever is written here reaches no model. Fold it into `description` as a `use when …` clause",
    path,
  };
}

/**
 * Check the `description`/`when_to_use` pair once the front matter is known to parse.
 *
 * Split from {@link scanCommandTrigger} so neither function carries both the parse failure modes and the
 * field failure modes, which is what pushes this kind of scanner past the complexity ceiling.
 */
function checkFields({
  document,
  matter,
  path,
}: {
  document: ReturnType<typeof parseDocument>;
  matter: FrontMatter;
  path: string;
}): readonly CommandTriggerIssue[] {
  const line = lineOfField({ field: "description", matter });
  const description = stringField({ document, field: "description" });
  if (!description.present) {
    return [{ kind: "description", line, message: "no `description:` — the skill listing is built from it", path }];
  }
  if (description.value === undefined || description.value.trim().length === 0) {
    return [{ kind: "description", line, message: "`description:` is empty or not a string", path }];
  }
  const dead = checkWhenToUseIsDead({ document, matter, path });
  if (dead !== undefined) {
    return [dead];
  }
  const issues: CommandTriggerIssue[] = [];
  const combined = description.value.length;
  if (combined > LISTING_MAX_CHARS) {
    issues.push({
      kind: "listing-cap",
      line,
      message:
        `description is ${String(combined)} chars, over the ${String(LISTING_MAX_CHARS)} the listing ` +
        "truncates at — whatever falls past that point is invisible to the model, and a `use when …` clause " +
        "written late in a long description is what gets cut first",
      path,
    });
  }
  if (!statesWhenToLoad({ description: description.value })) {
    issues.push({
      kind: "trigger",
      line,
      message:
        "says what the skill IS but never when to load it — add a `use when …` clause to the description, " +
        "carrying the phrases a person actually types. The body cannot do this: it loads only after the " +
        "skill has already been chosen",
      path,
    });
  }
  return issues;
}

/**
 * Check one skill's front matter.
 *
 * Pure: the caller supplies already-read text. Where findings are INDEPENDENT it reports all of them — every
 * YAML error rather than only the earliest, and the listing-cap and trigger findings together — so one run
 * tells you everything to fix.
 *
 * THREE states end the scan early, and in each what follows is unknowable rather than merely untidy:
 *
 * - front matter that will not parse, because there is no document to read a field out of;
 * - a `description` that is missing, empty or not a string, because every remaining check is about that
 *   string's CONTENT. "You also have no trigger clause" is noise when the answer is that the description has
 *   to exist first;
 * - a `when_to_use` key at all, because it is dead metadata that makes the entry LOOK like it says when to
 *   load. Reporting the cap and the trigger clause alongside it would bury the one finding that explains the
 *   other two.
 *
 * Both are deliberate, and pinned by tests, so neither reads as the stop-at-first behaviour ruled out above.
 *
 * @param content the skill file's text
 * @param path the repo-relative path, for reporting
 * @returns one issue per defect, in discovery order
 */
export function scanCommandTrigger({
  content,
  path,
}: {
  content: string;
  path: string;
}): readonly CommandTriggerIssue[] {
  const matter = frontMatterOf({ content });
  if (matter === undefined) {
    return [{ kind: "frontmatter", line: 1, message: "no `---` front matter block at the top of the file", path }];
  }
  const document = parseDocument(matter.text, { strict: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    return document.errors.map((failure) => ({
      kind: "yaml" as const,
      line: matter.firstFieldLine,
      message: `front matter is not valid YAML — ${failure.message.split("\n")[0]}${colonSpaceHint({ failure: failure.message })}`,
      path,
    }));
  }
  return checkFields({ document, matter, path });
}

/**
 * Check every skill, print each issue, and return an exit code.
 *
 * @returns 0 when every skill's front matter is usable, else 1
 */
export function runCommandTrigger(): number {
  let root: string;
  let listing: readonly string[];
  try {
    root = repoRootOf({ importMetaUrl: import.meta.url });
    listing = workingTreeFilesOf({ root });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("command-trigger: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const paths = listing.filter((path) => /^skills\/[^/]+\/SKILL\.md$/.test(path));
  const { hits, unreadable, scanned } = scanTextFiles<CommandTriggerIssue>({
    paths,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanCommandTrigger({ content, path }),
  });
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}  ${hit.message}\n`);
  }
  // Fails closed on an empty selection too: a typo in the path filter would otherwise report a confident
  // clean over nothing at all, which is the shape every other ratchet here was hardened against.
  const complete = reportScanIntegrity({
    label: "command-trigger",
    scanned,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  if (hits.length === 0 && complete) {
    process.stdout.write(`command-trigger: clean (${String(scanned)} skill(s) scanned)\n`);
    return 0;
  }
  if (hits.length > 0) {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "command-trigger" }),
        detail: `${String(hits.length)} skill(s) the skill listing cannot use properly`,
      })}\n`,
    );
  }
  return 1;
}
