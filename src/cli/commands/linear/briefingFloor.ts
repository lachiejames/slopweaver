/**
 * The evidence floor of `slopweaver linear briefing build`: which sibling bundle's `applied-all.json` certifies a
 * full apply, the instant that moves the floor to, and the earlier briefings a new one carries forward. Pure; the
 * shell (`./briefingRun.ts`) reads the sibling bundles and hands their text in.
 */
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { safeJsonParse } from "../../../lib/safeJson.js";
import { type LinearBriefingBundle, planLinearBriefingBundle } from "../../../outbound/linear/briefingPlan.js";
import { linearBriefingFormSchema } from "../../../outbound/linear/briefingSchema.js";
import type { LinearBriefingForm } from "../../../outbound/linear/briefingTypes.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";
import { parseLinearForm } from "./formParse.js";

/**
 * A numbered form file, as opposed to anything else a person put in `forms/`. A position pads to two digits and
 * grows past them at the 100th proposal, and a one-digit name is no file this verb wrote, so ANY digit count.
 */
export const NUMBERED_FORM = /^\d+-[a-z0-9-]+\.json$/;

/** The record a fully landed apply-all leaves in its bundle; the ONLY thing that moves the floor. */
export const APPLIED_ALL_FILE = "applied-all.json";

/**
 * One witness per step, keyed by the step's form file: a partial apply has a step with nothing to name. Each is
 * the Linear URL that step's write printed.
 *
 * The residue, stated: `build` reaches no provider, so it cannot read a witness back. A session that writes a
 * Linear URL for a step that never landed still moves the floor. What this closes is the honest mistake — a
 * record written after a partial apply names what landed, and the missing step refuses it.
 */
const appliedAllSchema = z.object({
  asOfIso: z.iso.datetime({ offset: true }),
  witnesses: z.record(z.string(), z.url({ hostname: /^linear\.app$/, protocol: /^https$/ })),
});

/** The two bundle files a record is checked against; only the fields the check reads. */
const bundleBriefingSchema = z.object({ asOfIso: z.iso.datetime({ offset: true }) });
const bundleApplySchema = z.object({ items: z.array(z.object({ steps: z.array(z.object({ file: z.string() })) })) });

/** A sibling bundle's record, judged against the bundle it claims was applied in full. */
export type AppliedRecordVerdict =
  | { readonly kind: "applied"; readonly asOfIso: string }
  | { readonly kind: "refused"; readonly problems: readonly string[] };

/** Parse one bundle file's JSON text against its schema, or `undefined` when it is absent or not that shape. */
function parsedBundleFile<T>({
  raw,
  schema,
  label,
}: {
  raw: string | undefined;
  schema: z.ZodType<T>;
  label: string;
}): T | undefined {
  if (raw === undefined) {
    return undefined;
  }
  try {
    const parsed = schema.safeParse(safeJsonParse({ label, text: raw }));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** A list of step files as prose, saying so when it is empty. */
function stepListText({ files }: { files: readonly string[] }): string {
  if (files.length === 0) {
    return "no step";
  }
  return files.join(", ");
}

/**
 * The bundle a sibling's own `briefing.json` implies, re-planned from the form at the bundle's own directory rather
 * than read from `apply.json` or `forms/`, or `undefined` when it is not a briefing this verb accepts.
 */
function impliedBundle({
  briefing,
  bundleDir,
}: {
  briefing: string | undefined;
  bundleDir: string;
}): LinearBriefingBundle | undefined {
  if (briefing === undefined) {
    return undefined;
  }
  const form = parseLinearForm({ raw: briefing, schema: linearBriefingFormSchema });
  if (form.isErr()) {
    return undefined;
  }
  return planLinearBriefingBundle({ form: form.value, outDir: bundleDir });
}

/**
 * Where `apply.json` or `forms/` departs from the bundle its briefing implies. `build` writes both from the one
 * plan, so any difference — a step trimmed, emptied, repeated, a command retargeted, a form's payload changed on
 * either side, a numbered form `build` would have removed — is a hand edit, or a bundle moved since it was built; either way it certifies nothing.
 */
function planProblems({
  apply,
  forms,
  implied,
  planned,
}: {
  apply: string;
  forms: Readonly<Record<string, string | undefined>>;
  implied: LinearBriefingBundle;
  planned: readonly string[];
}): readonly string[] {
  const impliedFiles = implied.items.flatMap((item) => item.steps.map((step) => step.file));
  if (planned.join("\n") !== impliedFiles.join("\n")) {
    return [
      `its apply.json plans ${stepListText({ files: planned })}, but its briefing.json implies ${stepListText({ files: impliedFiles })}`,
    ];
  }
  if (!isDeepStrictEqual(safeJsonParse({ label: "apply.json", text: apply }), { items: implied.items })) {
    return ["its apply.json's steps differ from the ones its briefing.json plans at this bundle's directory"];
  }
  const drifted = implied.files.filter((file) => forms[file.name] !== file.contents).map((file) => file.name);
  if (drifted.length > 0) {
    return [`its form file(s) differ from the writes its briefing.json plans: ${drifted.join(", ")}`];
  }
  const plannedNames = new Set(implied.files.map((file) => file.name));
  const extra = Object.keys(forms).filter(
    (name) => !plannedNames.has(name) && NUMBERED_FORM.test(name.slice("forms/".length)),
  );
  if (extra.length > 0) {
    return [`its forms/ holds numbered form(s) its briefing.json never planned: ${extra.join(", ")}`];
  }
  return [];
}

/** One line per bundle file that could not be read as the shape a certificate is judged against. */
function unreadableProblems({
  forms,
  implied,
  plan,
  record,
}: {
  forms: unknown;
  implied: unknown;
  plan: unknown;
  record: unknown;
}): readonly string[] {
  return [
    ...(record === undefined ? ["it is not { asOfIso, witnesses: { <form file>: <url> } }"] : []),
    ...(plan === undefined ? ["its bundle has no readable apply.json"] : []),
    ...(implied === undefined ? ["its bundle has no readable briefing.json"] : []),
    ...(forms === undefined ? ["its bundle's forms/ cannot be listed"] : []),
  ];
}

/**
 * Judge one `applied-all.json` against its own bundle. It moves the floor only when it records the bundle's own
 * `asOfIso`, its `apply.json` and every form in `forms/` are exactly what its `briefing.json` implies at this
 * directory, and it names a witness for EVERY step and no other — so neither a partly applied briefing naming the
 * writes that did land, nor a single file of the bundle edited so that a write changes, can certify a briefing whose
 * proposals never all reached Linear.
 *
 * @param applied the record's JSON text
 * @param apply the bundle's `apply.json` text, or `undefined` when it has none
 * @param briefing the bundle's `briefing.json` text, or `undefined` when it has none
 * @param bundleDir the bundle's absolute directory, which every step command it planned names its form by
 * @param forms every file under the bundle's `forms/`, keyed `forms/<name>` as a step names it, with its text or
 *   `undefined` when it could not be read; the whole map is `undefined` when `forms/` could not be listed
 * @returns the instant it moves the floor to, or every problem found
 */
export function appliedRecordVerdict({
  applied,
  apply,
  briefing,
  bundleDir,
  forms,
}: {
  applied: string;
  apply: string | undefined;
  briefing: string | undefined;
  bundleDir: string;
  forms: Readonly<Record<string, string | undefined>> | undefined;
}): AppliedRecordVerdict {
  const record = parsedBundleFile({ label: APPLIED_ALL_FILE, raw: applied, schema: appliedAllSchema });
  const plan = parsedBundleFile({ label: "apply.json", raw: apply, schema: bundleApplySchema });
  const composed = parsedBundleFile({ label: "briefing.json", raw: briefing, schema: bundleBriefingSchema });
  const implied = impliedBundle({ briefing, bundleDir });
  if (
    record === undefined ||
    apply === undefined ||
    plan === undefined ||
    composed === undefined ||
    implied === undefined ||
    forms === undefined
  ) {
    return { kind: "refused", problems: unreadableProblems({ forms, implied, plan, record }) };
  }
  // The briefing is what they were shown, so its own re-plan is the list a full apply must witness.
  const impliedFiles = implied.items.flatMap((item) => item.steps.map((step) => step.file));
  const named = Object.keys(record.witnesses);
  const unwitnessed = impliedFiles.filter((file) => !named.includes(file));
  const unplanned = named.filter((file) => !impliedFiles.includes(file));
  const problems = [
    ...planProblems({
      apply,
      forms,
      implied,
      planned: plan.items.flatMap((item) => item.steps.map((step) => step.file)),
    }),
    ...(record.asOfIso === composed.asOfIso
      ? []
      : [`it records asOfIso ${record.asOfIso}, but its briefing is as of ${composed.asOfIso}`]),
    ...(unwitnessed.length === 0
      ? []
      : [`no witness for ${String(unwitnessed.length)} step(s): ${unwitnessed.join(", ")}`]),
    ...(unplanned.length === 0 ? [] : [`it witnesses step(s) the briefing never planned: ${unplanned.join(", ")}`]),
  ];
  if (problems.length > 0) {
    return { kind: "refused", problems };
  }
  return { asOfIso: record.asOfIso, kind: "applied" };
}

/**
 * The evidence floor: the newest instant a briefing was applied in full, or `null` when none ever was, which
 * means the whole corpus is read. A held or partly applied briefing writes no record, so it never moves this.
 *
 * @param applied the `asOfIso` of every sibling bundle's `applied-all.json`
 * @returns the floor a new briefing's `evidenceSinceIso` must equal
 */
export function briefingFloor({ applied }: { applied: readonly string[] }): string | null {
  let floor: string | null = null;
  for (const iso of applied) {
    if (floor === null || compareInstants({ a: iso, b: floor }) > 0) {
      floor = iso;
    }
  }
  return floor;
}

/** The fraction digits past the millisecond, which `Date.parse` drops. An offset is whole minutes, so never in them. */
function subMillisecondDigits({ iso }: { iso: string }): string {
  const fraction = /T\d{2}:\d{2}:\d{2}\.(\d+)/.exec(iso);
  if (fraction === null) {
    return "";
  }
  return fraction[1]!.slice(3);
}

/**
 * Order two ISO instants at their full written precision: `Date.parse` truncates to the millisecond, so two
 * sub-millisecond instants would tie and the older text could win. One instant written two ways (two offsets)
 * orders by its text, so the floor never depends on the order the directory listed its bundles in.
 *
 * @param a one ISO-8601 instant
 * @param b the other
 * @returns positive when `a` is later, negative when earlier, `0` only for identical text
 */
export function compareInstants({ a, b }: { a: string; b: string }): number {
  const millis = Date.parse(a) - Date.parse(b);
  if (millis !== 0) {
    return millis;
  }
  const aDigits = subMillisecondDigits({ iso: a });
  const bDigits = subMillisecondDigits({ iso: b });
  const width = Math.max(aDigits.length, bDigits.length);
  const sub = aDigits.padEnd(width, "0").localeCompare(bDigits.padEnd(width, "0"));
  if (sub !== 0) {
    return sub;
  }
  if (a === b) {
    return 0;
  }
  return a > b ? 1 : -1;
}

/**
 * The earlier briefings this one carries forward: every sibling bundle composed after the floor that no full
 * apply certified — held, missed, or partly applied — named so they can see what today's briefing re-proposes. A
 * bundle with no readable `briefing.json` (a build interrupted mid-write) has no instant to place against the
 * floor, so it is always named, and says so, rather than silently left out.
 *
 * @param floor what {@link briefingFloor} derived
 * @param unapplied every sibling bundle with no certifying record, and its `briefing.json` text if it has one
 * @returns their directory names, sorted
 */
export function heldSinceFloor({
  floor,
  unapplied,
}: {
  floor: string | null;
  unapplied: readonly { name: string; briefing: string | undefined }[];
}): readonly string[] {
  const named: string[] = [];
  for (const bundle of unapplied) {
    const composed = parsedBundleFile({ label: "briefing.json", raw: bundle.briefing, schema: bundleBriefingSchema });
    if (composed === undefined) {
      named.push(`${bundle.name} (no readable briefing.json)`);
      continue;
    }
    // At the floor counts: a held briefing composed at the very instant another was applied never shared its yes.
    if (floor === null || compareInstants({ a: composed.asOfIso, b: floor }) >= 0) {
      named.push(bundle.name);
    }
  }
  return named.toSorted();
}

/**
 * Refuse a briefing whose `evidenceSinceIso` is not the floor the bundles on disk derive, so no caller can move
 * the floor past evidence a held briefing still owes them.
 *
 * @param form the validated briefing
 * @param floor what {@link briefingFloor} derived
 * @returns the refusal, or `undefined` when the briefing reads from exactly the floor
 */
export function floorRefusal({
  form,
  floor,
}: {
  form: LinearBriefingForm;
  floor: string | null;
}): LinearVerbError | undefined {
  // Exact text, not the same instant: the floor is copied from the record, never re-spelled.
  if (form.evidenceSinceIso === floor) {
    return undefined;
  }
  const expected =
    floor === null
      ? "null: no bundle beside this one certifies a full apply, so the whole corpus is read"
      : `"${floor}", the asOfIso of the newest applied-all.json beside this bundle`;
  return LinearVerbErrors.formInvalid({
    issues: [
      {
        message: `evidenceSinceIso must be ${expected} — only a fully landed apply-all moves the floor`,
        path: ["evidenceSinceIso"],
      },
    ],
  });
}
