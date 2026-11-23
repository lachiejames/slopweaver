/**
 * Plan one briefing's BUNDLE: the provider form each proposed write is sent as, the exact command that sends it
 * (and its dry run), and the `## On the owner's word` section the card's doc carries. Pure — `linear briefing build`
 * writes what this returns and nothing else.
 *
 * The commands are DERIVED from each write's `kind`, never carried in the form, so a briefing cannot smuggle a
 * command a reviewer would have to read: the only verbs it can name are the four Linear doors below.
 */
import type { LinearBriefingForm, LinearBriefingProposal, LinearBriefingWrite } from "./briefingTypes.js";

/**
 * One form file the bundle writes, relative to the bundle directory.
 *
 * @internal
 */
export interface LinearBriefingFile {
  readonly name: string;
  readonly contents: string;
}

/**
 * One write inside an item, in the order it must run.
 *
 * @internal
 */
export interface LinearBriefingStep {
  /** What this step does, as the owner's answer would name it: `comment`, `move`, `relation` or `project-update`. */
  readonly label: string;
  /** The form file it sends, relative to the bundle directory. */
  readonly file: string;
  readonly apply: string;
  readonly dryRun: string;
}

/**
 * One proposal's place in the bundle.
 *
 * @internal
 */
export interface LinearBriefingItemPlan {
  readonly id: string;
  readonly confidence: LinearBriefingProposal["confidence"];
  readonly kind: LinearBriefingWrite["kind"];
  readonly steps: readonly LinearBriefingStep[];
}

/** Everything `linear briefing build` writes beside the page. */
export interface LinearBriefingBundle {
  readonly files: readonly LinearBriefingFile[];
  readonly items: readonly LinearBriefingItemPlan[];
  readonly onOwnerWord: string;
}

/** One step before its paths are known: the label, the verb's argv head, and the form it sends. */
interface StepDraft {
  readonly label: string;
  readonly verb: string;
  readonly form: unknown;
}

/** The fields-only update a move sends, which only ever names the issue by its id. */
function moveVerb({ issueId }: { issueId: string }): string {
  return `slopweaver linear issue update --fields-only --issue-id ${shellQuote({ text: issueId })}`;
}

/** The steps one write runs, in order. A superseded item comments first, so the reason lands before the close. */
function stepDrafts({ write }: { write: LinearBriefingWrite }): readonly StepDraft[] {
  switch (write.kind) {
    case "comment":
      return [{ form: write.comment, label: "comment", verb: "slopweaver linear comment create" }];
    case "state-change":
    case "stale-to-backlog":
      return [{ form: write.update, label: "move", verb: moveVerb({ issueId: write.issueId }) }];
    case "project-update":
      return [{ form: write.update, label: "project-update", verb: "slopweaver linear project-update create" }];
    case "superseded": {
      const steps: StepDraft[] = [{ form: write.comment, label: "comment", verb: "slopweaver linear comment create" }];
      if (write.relation !== undefined) {
        steps.push({ form: write.relation, label: "relation", verb: "slopweaver linear relation create" });
      }
      if (write.close !== undefined) {
        steps.push({ form: write.close.update, label: "move", verb: moveVerb({ issueId: write.close.issueId }) });
      }
      return steps;
    }
    default: {
      const unreachable: never = write;
      return unreachable;
    }
  }
}

/** POSIX single-quoting, so a path or id is one word whatever it holds. */
function shellQuote({ text }: { text: string }): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * The proposals in the order the page and the card read them: every obvious one, then every less obvious one,
 * each group in the order the session composed it.
 *
 * @param proposals the validated proposals
 * @returns the same proposals, high confidence first
 */
export function orderedProposals({
  proposals,
}: {
  proposals: readonly LinearBriefingProposal[];
}): readonly LinearBriefingProposal[] {
  return [
    ...proposals.filter((proposal) => proposal.confidence === "high"),
    ...proposals.filter((proposal) => proposal.confidence === "low"),
  ];
}

/** Two digits, so the files sort in the order they apply. */
function position({ index }: { index: number }): string {
  return String(index + 1).padStart(2, "0");
}

/** One item's bullet in the doc section: its id, its rank, and each step's command. */
function itemLines({ item }: { item: LinearBriefingItemPlan }): readonly string[] {
  return [`- \`${item.id}\` (${item.confidence}, ${item.kind})`, ...item.steps.map((step) => `  - \`${step.apply}\``)];
}

/** The ids of a set of items, as the owner's answer would list them. */
function idList({ items }: { items: readonly LinearBriefingItemPlan[] }): string {
  if (items.length === 0) {
    return "none";
  }
  return items.map((item) => `\`${item.id}\``).join(", ");
}

/** The `## On the owner's word` section, mapping each of the card's four options to the exact commands. */
function onOwnerWordSection({ asOfIso, items }: { asOfIso: string; items: readonly LinearBriefingItemPlan[] }): string {
  const high = items.filter((item) => item.confidence === "high");
  return [
    "## On the owner's word",
    "",
    "Run an item's steps in order, each only once the one before it printed `created` or `updated`. A refusal " +
      "or an indeterminate write STOPS that item: read its target live (`slopweaver linear read <url>`) before " +
      "anything else, and never re-run it blind. Re-run each step's dry run first if the target moved since " +
      "this briefing.",
    "",
    "Every item, high confidence first:",
    "",
    ...items.flatMap((item) => itemLines({ item })),
    "",
    `- **apply all** — every item above, in order: ${idList({ items })}.`,
    `- **apply the high-confidence ones** — ${idList({ items: high })}; nothing else.`,
    "- **apply the items named** — exactly the ids in the answer, in the order above; nothing else.",
    "- **hold** — nothing is written. Tomorrow's briefing recomputes every one of these from live Linear.",
    "",
    "Settle `--as answered --witness <every URL the writes printed>` once each chosen write landed; a hold " +
      "settles `--as declined`. Only an apply-all whose every write landed and was read back live moves the " +
      `next briefing's evidence floor, to this briefing's \`asOfIso\`: \`${asOfIso}\`.`,
    "",
  ].join("\n");
}

/**
 * Plan the bundle for one validated briefing.
 *
 * @param form the validated briefing
 * @param outDir the ABSOLUTE bundle directory each command names its form by, so a command runs from anywhere
 * @returns every form file, every item's ordered steps, and the doc section mapping the owner's answer to them
 */
export function planLinearBriefingBundle({
  form,
  outDir,
}: {
  form: LinearBriefingForm;
  outDir: string;
}): LinearBriefingBundle {
  const files: LinearBriefingFile[] = [];
  const items = orderedProposals({ proposals: form.proposals }).map((proposal, index): LinearBriefingItemPlan => {
    const steps = stepDrafts({ write: proposal.write }).map((draft): LinearBriefingStep => {
      const file = `forms/${position({ index })}-${proposal.id}-${draft.label}.json`;
      files.push({ contents: `${JSON.stringify(draft.form, null, 2)}\n`, name: file });
      const source = shellQuote({ text: `${outDir}/${file}` });
      return {
        apply: `${draft.verb} --form - < ${source}`,
        dryRun: `${draft.verb} --form - --dry-run < ${source}`,
        file,
        label: draft.label,
      };
    });
    return { confidence: proposal.confidence, id: proposal.id, kind: proposal.write.kind, steps };
  });
  return { files, items, onOwnerWord: onOwnerWordSection({ asOfIso: form.asOfIso, items }) };
}
