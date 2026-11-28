/**
 * A human-editable markdown+frontmatter representation of a C3 {@link PrFormDraft} — the AUTHORING format, not the
 * GitHub body format.
 *
 * `./render.ts`/`./parse.ts` convert a form to and from the exact bytes GitHub stores: one-line HTML blocks, derived
 * badges and hovers, built to be byte-exact and machine-parseable. Nobody should hand-author that. This module is
 * the other direction: a plain markdown file a person can open, pull the current description into, edit surgically,
 * and push back.
 *
 * The short structured fields are YAML frontmatter: title, routing, draft, when and by whom the problem was seen (or
 * why it was not), whether anything on screen changes, and the ranked risk items, whose fields are plain sentences a
 * badge hover carries. Everything a reader reads as prose is a `## ` section, in the order the description shows it:
 * Explainer, Proof of the problem, Proof of the solution, Checks, Not checked and why, Re-run.
 *
 * A key for something a C3 description no longer publishes (an origin, a grade, a gold anchor, a reviewer table,
 * Codex review leftovers, a write stamp) is refused BY NAME, so a file pulled before C3 says where its job went.
 *
 * ## Why a hand-rolled grammar rather than a markdown library
 *
 * There is no markdown-parsing dependency anywhere in this repository, and adding one would still need its output
 * filtered down to the form's run kinds. So this grammar only ever recognises exactly what the form can represent,
 * and DECLINES everything else rather than guessing at it.
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import {
  cell,
  declined,
  parseCheckBullets,
  parseRerunBlocks,
  parseUncheckedLines,
  renderCheckBullets,
  renderRerunBlocks,
  renderUncheckedLines,
} from "./authoringGrammar.js";
import { renderContent } from "./authoringInline.js";
import { parseProofSlot, renderProofSlotLines } from "./authoringProofSlot.js";
import { splitSections } from "./authoringSkeleton.js";
import { withholdingCredentialLines } from "./descriptionWords.js";
import { WORST_KINDS } from "./schema.js";
import type { PrFormDraft, ProblemSeen, RiskItem } from "./types.js";
import { prFormWriteSchema } from "./writeSchema.js";

/** The outcome of turning an authoring file back into a draft. */
export type AuthoringFileParse = Result<{ readonly form: PrFormDraft; readonly pulledBodyHash?: string }>;

/** The frontmatter keys this format recognises. Anything else is a refused typo, not a silent drop. */
const FRONTMATTER_KEYS = [
  "title",
  "target",
  "draft",
  "problem-seen",
  "visual-proof",
  "risk",
  "pulled-body-hash",
] as const;

/** Frontmatter keys a pre-C3 file carried, each refused with where its job went. */
const RETIRED_KEYS: Readonly<Record<string, string>> = {
  "gold-anchor": "a description publishes no gold anchor",
  origin: "a description publishes no origin",
  review: "a description publishes no grade",
  "review-leftovers": "Codex review leftovers are a landing-gate finding, acknowledged with --reason",
  reviewers: "there is no reviewer table",
  "written-on": "no byte of a C3 description depends on the day it is written",
};

/** One risk item as frontmatter: its check, or why it was not checked. */
function riskEntryOf({ item }: { item: RiskItem }): Record<string, unknown> {
  const check = item.check.kind === "checked" ? { check: item.check.check } : { unchecked: item.check.why };
  return { kind: item.worstKind, worst: item.worst, ...check };
}

/** The Checks section's text, or undefined when there is no check of either kind. */
function checksSectionOf({ form }: { form: PrFormDraft }): string | undefined {
  const { checks, checkGroups } = form;
  if (checkGroups === undefined) {
    return checks.length === 0 ? undefined : renderCheckBullets({ checkGroups: [], checks });
  }
  if (checks.length === 0 && checkGroups.length === 0) {
    return undefined;
  }
  return renderCheckBullets({ checkGroups, checks });
}

/** The seen state as frontmatter. */
function seenEntryOf({ seen }: { seen: ProblemSeen }): Record<string, unknown> {
  return seen.kind === "seen" ? { by: seen.by, on: seen.on, what: seen.what } : { "not-seen": seen.why };
}

/**
 * Render a draft as an editable markdown+frontmatter file.
 *
 * @param form the draft to render
 * @param pulledBodyHash the live body's digest at the moment of a `--pull`, or undefined for a fresh
 *   `--file-example` template that has nothing live to compare against
 * @returns the file's exact text
 */
export function renderAuthoringFile({
  form,
  pulledBodyHash,
}: {
  form: PrFormDraft;
  pulledBodyHash?: string | undefined;
}): string {
  const sections: readonly (readonly [string, string | undefined])[] = [
    ["Explainer", renderContent({ content: form.explainer })],
    ["Proof of the problem", renderProofSlotLines({ slot: form.problemProof })],
    ["Proof of the solution", renderProofSlotLines({ slot: form.solutionProof })],
    ["Checks", checksSectionOf({ form })],
    [
      "Not checked, and why",
      form.notChecked.length === 0 ? undefined : renderUncheckedLines({ items: form.notChecked }),
    ],
    ["Re-run", form.rerun.length === 0 ? undefined : renderRerunBlocks({ items: form.rerun })],
  ];
  const body = sections.flatMap(([name, text]) => (text === undefined ? [] : [`## ${name}\n${text}`]));
  const frontmatter = stringifyYaml({
    title: form.title,
    target: form.target,
    draft: form.draft,
    "problem-seen": seenEntryOf({ seen: form.problemSeen }),
    "visual-proof": form.visualProof,
    risk: form.risk.items.map((item) => riskEntryOf({ item })),
    ...(pulledBodyHash === undefined ? {} : { "pulled-body-hash": pulledBodyHash }),
  });
  return `---\n${frontmatter}---\n\n${body.join("\n\n")}\n`;
}

/** A decline, so the many failure sites below stay one line each. */
function no({ error }: { error: string }): Result<never> {
  return err([error]);
}

/** The frontmatter block's raw text and the markdown body after it, or a decline naming why. */
function splitFrontmatter({
  text,
}: {
  text: string;
}): { readonly frontmatter: string; readonly body: string } | { readonly error: string } {
  const normalised = text.replace(/\r\n/g, "\n");
  if (!normalised.startsWith("---\n")) {
    return { error: "the file must start with a `---` YAML frontmatter block" };
  }
  const end = normalised.indexOf("\n---", 4);
  if (end < 0) {
    return { error: "the frontmatter's opening `---` has no matching closing `---`" };
  }
  const afterFence = normalised.slice(end + 4);
  const bodyAt = afterFence.startsWith("\n") ? 1 : 0;
  if (afterFence.length > 0 && bodyAt === 0) {
    return { error: "the frontmatter's closing `---` must be alone on its line" };
  }
  return { body: afterFence.slice(bodyAt), frontmatter: normalised.slice(4, end) };
}

/** The frontmatter, decoded and checked for a retired or unrecognised (probably mistyped) key. */
function decodeFrontmatter({
  frontmatter,
}: {
  frontmatter: string;
}): { readonly value: Readonly<Record<string, unknown>> } | { readonly error: string } {
  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatter);
  } catch (cause) {
    return { error: `the frontmatter is not valid YAML: ${cause instanceof Error ? cause.message : "unparseable"}` };
  }
  if (!isRecord(parsed)) {
    return { error: "the frontmatter must be a YAML mapping (key: value pairs)" };
  }
  const retired = Object.keys(parsed).filter((key) => key in RETIRED_KEYS);
  if (retired.length > 0) {
    const reasons = retired.map((key) => `${key} (${RETIRED_KEYS[key]!})`).join("; ");
    return { error: `retired frontmatter field(s), not part of a C3 description: ${reasons}. Remove them` };
  }
  const known: readonly string[] = FRONTMATTER_KEYS;
  const foreign = Object.keys(parsed).filter((key) => !known.includes(key));
  if (foreign.length > 0) {
    return {
      error:
        `unknown frontmatter field(s): ${foreign.join(", ")} — REFUSED, not ignored. ` +
        `this format's frontmatter fields are: ${known.join(", ")}`,
    };
  }
  return { value: parsed };
}

/** `problem-seen` as the form's field: `{ on, by, what }` or `{ not-seen: <why> }`. */
function problemSeenOf({ value }: { value: unknown }): Record<string, unknown> | { readonly error: string } {
  const shape = {
    error:
      'problem-seen is required: a mapping "on: <YYYY-MM-DD>, by: owner|agent|unrecorded, what: <what was seen>", ' +
      'or "not-seen: <why it was not seen yet>"',
  };
  if (!isRecord(value)) {
    return shape;
  }
  const notSeen = value["not-seen"];
  if (notSeen !== undefined) {
    return Object.keys(value).length === 1 ? { kind: "not-seen", why: notSeen } : shape;
  }
  const keys = Object.keys(value).toSorted().join(",");
  return keys === "by,on,what" ? { by: value["by"], kind: "seen", on: value["on"], what: value["what"] } : shape;
}

/** One frontmatter risk entry as the form's item. */
function riskItemOf({ entry, index }: { entry: unknown; index: number }): Record<string, unknown> | { error: string } {
  const shape = {
    error:
      `risk item ${String(index + 1)} is a mapping "kind: <${WORST_KINDS.join("|")}>, worst: <worst case>" plus ` +
      'either "check: <what checked it>" or "unchecked: <why nothing did>". The kind sets the level: high when the ' +
      "worst case loses or leaks data or changes something off this machine, medium when something that worked " +
      "breaks, low when only tests, docs or dev tooling can",
  };
  if (!isRecord(entry)) {
    return shape;
  }
  const keys = Object.keys(entry).toSorted().join(",");
  if (keys === "check,kind,worst") {
    return { check: { check: entry["check"], kind: "checked" }, worst: entry["worst"], worstKind: entry["kind"] };
  }
  if (keys === "kind,unchecked,worst") {
    return {
      check: { kind: "unchecked", why: entry["unchecked"] },
      worst: entry["worst"],
      worstKind: entry["kind"],
    };
  }
  return shape;
}

/** The frontmatter `risk` list as the form's section. */
function riskOf({ value }: { value: unknown }): Record<string, unknown> | { readonly error: string } {
  if (!Array.isArray(value)) {
    return { error: "risk is required: a YAML list of ranked risk items, the most urgent first" };
  }
  const items: Record<string, unknown>[] = [];
  for (const [index, entry] of value.entries()) {
    const item = riskItemOf({ entry, index });
    if (declined(item)) {
      return item;
    }
    items.push(item);
  }
  return { items };
}

/** One optional section, parsed when present; absent, the empty list. */
function listSection({
  sections,
  name,
  parse,
}: {
  sections: ReadonlyMap<string, string>;
  name: string;
  parse: (input: { source: string }) => readonly unknown[] | { readonly error: string };
}): readonly unknown[] | { readonly error: string } {
  const source = sections.get(name);
  return source === undefined ? [] : parse({ source });
}

/** The zod-candidate object for the whole draft, built from frontmatter plus the parsed sections. */
function candidateFrom({
  fm,
  sections,
}: {
  fm: Readonly<Record<string, unknown>>;
  sections: ReadonlyMap<string, string>;
}): Record<string, unknown> | { readonly error: string } {
  const checksSource = sections.get("Checks");
  const checkLists =
    checksSource === undefined ? { checkGroups: [], checks: [] } : parseCheckBullets({ source: checksSource });
  if (declined(checkLists)) {
    return checkLists;
  }
  const parts = {
    checks: checkLists.checks,
    explainer: cell({ source: sections.get("Explainer")!, where: "## Explainer" }),
    notChecked: listSection({ name: "Not checked, and why", parse: parseUncheckedLines, sections }),
    problemProof: parseProofSlot({ section: "Proof of the problem", source: sections.get("Proof of the problem")! }),
    problemSeen: problemSeenOf({ value: fm["problem-seen"] }),
    rerun: listSection({ name: "Re-run", parse: parseRerunBlocks, sections }),
    risk: riskOf({ value: fm["risk"] }),
    solutionProof: parseProofSlot({ section: "Proof of the solution", source: sections.get("Proof of the solution")! }),
  };
  const failed = Object.values(parts).find(declined);
  if (failed !== undefined) {
    return failed;
  }
  return {
    ...parts,
    ...(checkLists.checkGroups.length === 0 ? {} : { checkGroups: checkLists.checkGroups }),
    ...(fm["draft"] === undefined ? {} : { draft: fm["draft"] }),
    target: fm["target"],
    title: fm["title"],
    visualProof: fm["visual-proof"],
  };
}

/**
 * Parse an editable markdown+frontmatter file back into a draft.
 *
 * The candidate built from the file is run through {@link prFormWriteSchema} exactly as a decoded `--form` JSON object
 * is — the same gate, so a file that would produce an invalid form is refused with the same `path: message` shape,
 * not a second error dialect.
 *
 * A decline is printed to the terminal, and the schema's own refusal of a stray backtick quotes the run it found, so
 * a decline line that would quote a credential shape prints the withheld line instead.
 *
 * @param source the file's raw text
 * @returns the recovered draft (plus a pulled-body digest, when the file carries one), or every reason parsing
 *   declined
 */
export function parseAuthoringFile({ source }: { source: string }): AuthoringFileParse {
  return decodeAuthoringFile({ source }).mapErr((lines) => withholdingCredentialLines({ lines }));
}

/** {@link parseAuthoringFile}'s decode, its declines as the grammar and schema word them. */
function decodeAuthoringFile({ source }: { source: string }): AuthoringFileParse {
  const split = splitFrontmatter({ text: source });
  if ("error" in split) {
    return no(split);
  }
  const frontmatter = decodeFrontmatter({ frontmatter: split.frontmatter });
  if ("error" in frontmatter) {
    return no(frontmatter);
  }
  const fm = frontmatter.value;
  const sections = splitSections({ body: split.body });
  if ("error" in sections) {
    return no(sections);
  }
  const candidate = candidateFrom({ fm, sections });
  if (declined(candidate)) {
    return no(candidate);
  }
  const decoded = prFormWriteSchema.safeParse(candidate);
  if (!decoded.success) {
    return err(
      decoded.error.issues.map((issue) => {
        const path = issue.path.map((p) => String(p)).join(".");
        return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
      }),
    );
  }
  const pulledBodyHash = typeof fm["pulled-body-hash"] === "string" ? fm["pulled-body-hash"] : undefined;
  return ok({ form: decoded.data, ...(pulledBodyHash === undefined ? {} : { pulledBodyHash }) });
}
