/**
 * The conversion of a pre-C3 reading-order description into a C3 draft, with a report of every field that did not
 * carry across and every field a person or a session still has to write.
 *
 * It is the one bridge between the frozen reader in this directory and the C3 form, and it SENDS NOTHING: `github
 * pr update --pull --convert-c3` writes the draft as an authoring file plus this report, and the description changes
 * only when that file is pushed back with `--file`, through every C3 gate. So the conversion may leave a field
 * BLANK where the old body carried nothing to fill it with — the push refuses a blank field by name — and it never
 * invents what was seen, who ran it, or a screenshot's claim.
 *
 * What it drops, and says it dropped: the gold anchor, the review grade, the reviewers table, the Codex leftovers,
 * the origin line, "Why this approach" and "Where to look". None of them is published in C3.
 */
import { canonicalKindOf, plainTextOf } from "../derive.js";
import type {
  Content as C3Content,
  PrFormDraft as C3Draft,
  RiskItem as C3RiskItem,
  WorstKind as C3WorstKind,
  ProofSlot,
  RerunItem,
  UncheckedItem,
} from "../types.js";
import type { BeforeAfter, Content, PrBody, ProofBlock, RiskItem } from "./types.js";

/** A legacy draft's routing fields, which carry across unchanged. */
interface PreC3Shell {
  readonly title: string;
  readonly target: C3Draft["target"];
  readonly draft: boolean;
}

/** The converted draft and the lines a reader of the authoring file needs before pushing it. */
export interface C3Conversion {
  readonly form: C3Draft;
  readonly report: readonly string[];
}

/** Legacy content as C3 content: the inline kinds are the same five. */
function contentOf({ content }: { content: Content }): C3Content {
  return content.map((run) => ({ ...run }));
}

/** One legacy risk item as a C3 one: worst case and check become plain sentences with no closing full stop. */
function riskItemOf({ item }: { item: RiskItem }): C3RiskItem {
  const sentence = ({ content }: { content: Content }): string => plainTextOf({ content }).replace(/\.\s*$/, "");
  const check =
    item.check.kind === "checked"
      ? { check: sentence({ content: item.check.check }), kind: "checked" as const }
      : { kind: "unchecked" as const, why: sentence({ content: item.check.why }) };
  return { check, worst: sentence({ content: item.worst }), worstKind: worstKindOf({ priority: item.priority }) };
}

/**
 * The C3 kind of worst case a legacy priority read as: the level the badge showed (P0 and P1 high, P2 medium, P3
 * and P4 low), then the one kind that implies it. The converted file is the author's to correct before it is pushed.
 */
function worstKindOf({ priority }: { priority: RiskItem["priority"] }): C3WorstKind {
  if (priority <= 1) {
    return canonicalKindOf({ level: "high" });
  }
  if (priority === 2) {
    return canonicalKindOf({ level: "medium" });
  }
  return canonicalKindOf({ level: "low" });
}

/** A Before-and-after side as a proof slot: its first image becomes a screenshot whose claim is left to write. */
function slotOf({ side }: { side: BeforeAfter["problem"] | undefined }): { slot: ProofSlot; image: boolean } {
  const image = side?.evidence.find((run) => run.kind === "image");
  if (image === undefined) {
    return { image: false, slot: { kind: "reason", reason: [] } };
  }
  return {
    image: true,
    slot: { image: { ...image }, kind: "screenshot", proves: [], runBy: "agent" },
  };
}

/** The legacy claims as C3 checks (proven) and "Not checked" items (a gap or a failure). */
function claimsOf({ body }: { body: PrBody }): { checks: readonly C3Content[]; notChecked: readonly UncheckedItem[] } {
  const checks = body.claims
    .filter((claim) => claim.proof.kind === "proven")
    .map((claim) => contentOf({ content: claim.claim }));
  const notChecked = body.claims.flatMap((claim) =>
    claim.proof.kind === "proven"
      ? []
      : [{ check: contentOf({ content: claim.claim }), why: contentOf({ content: claim.proof.why }) }],
  );
  return { checks, notChecked };
}

/** The legacy notes as re-run items: a code block stays a command, a paragraph a note; images and folds do not carry. */
function rerunOf({ notes }: { notes: readonly ProofBlock[] }): { items: readonly RerunItem[]; dropped: number } {
  const items: RerunItem[] = [];
  let dropped = 0;
  for (const block of notes) {
    if (block.kind === "code") {
      items.push({ kind: "command", lang: block.lang, text: block.text });
    } else if (block.kind === "para") {
      items.push({ content: contentOf({ content: block.content }), kind: "note" });
    } else {
      dropped += 1;
    }
  }
  return { dropped, items };
}

/** The report lines for the retired fields the old body carried. */
function droppedLines({ body }: { body: PrBody }): readonly string[] {
  const present: readonly [boolean, string][] = [
    [body.goldAnchor !== undefined, "the gold anchor"],
    [body.review !== undefined, "the review grade"],
    [body.reviewers !== undefined && body.reviewers.length > 0, "the reviewers table"],
    [body.reviewLeftovers !== undefined && body.reviewLeftovers.length > 0, "the Codex review leftovers"],
    [body.origin.length > 0, "the origin line"],
    [body.whyApproach !== undefined && body.whyApproach.length > 0, '"Why this approach"'],
    [body.whereToLook.length > 0, '"Where to look"'],
    [body.failsOnMain !== undefined, '"Fails on main" (re-add its command under ## Re-run if it still matters)'],
    [
      body.clickThrough !== undefined,
      "the click-through (add its screenshot as Proof of the solution if it proves it)",
    ],
  ];
  return present.filter(([is]) => is).map(([, what]) => `dropped: ${what} — a C3 description does not publish it`);
}

/**
 * Convert a legacy reading-order body into a C3 draft and its report.
 *
 * @param body the legacy body, as `./parse.ts` read it
 * @param shell the live title, target and draft state, which carry across unchanged
 * @returns the draft (with blank fields where nothing carried) and one report line per gap
 */
export function convertToC3({ body, shell }: { body: PrBody; shell: PreC3Shell }): C3Conversion {
  const problem = slotOf({ side: body.beforeAfter?.problem });
  const solution = slotOf({ side: body.beforeAfter?.fix });
  const { checks, notChecked } = claimsOf({ body });
  const { notes = [] } = body;
  const rerun = rerunOf({ notes });
  const explainer: C3Content = [
    ...contentOf({ content: body.problem }),
    { kind: "text", text: " " },
    ...contentOf({ content: body.change }),
  ];
  const problemSeen: C3Draft["problemSeen"] =
    body.problemSeen.kind === "seen"
      ? { by: "unrecorded", kind: "seen", on: body.problemSeen.on, what: "" }
      : { kind: "not-seen", why: "" };
  const report = [
    "write: ## Explainer — the old Problem and Change, joined; trim it to 70 words and say what broke, for whom, and what changes",
    body.problemSeen.kind === "seen"
      ? "write: problem-seen.what — what was seen on that day; problem-seen.by stays unrecorded unless the record says who ran it"
      : "write: problem-seen.not-seen — why the problem was not seen on a real run yet",
    problem.image
      ? "write: ## Proof of the problem — the line the screenshot proves, and who ran it"
      : "write: ## Proof of the problem — reason: why there is no screenshot",
    solution.image
      ? "write: ## Proof of the solution — the line the screenshot proves, and who ran it"
      : "write: ## Proof of the solution — reason: why there is no screenshot",
    ...(body.risk.items.length === 0
      ? ["write: risk — at least one ranked item"]
      : ["check: risk kind — each item's kind was read from its old priority's level; set the kind its worst case is"]),
    ...(rerun.dropped > 0
      ? [`dropped: ${String(rerun.dropped)} folded note block(s) — images and folds do not carry into ## Re-run`]
      : []),
    ...droppedLines({ body }),
  ];
  return {
    form: {
      checks,
      draft: shell.draft,
      explainer,
      notChecked,
      problemProof: problem.slot,
      problemSeen,
      rerun: rerun.items,
      risk: { items: body.risk.items.map((item) => riskItemOf({ item })) },
      solutionProof: solution.slot,
      target: shell.target,
      title: shell.title,
      visualProof: problem.image || solution.image ? "screen-change" : "nothing-on-screen",
    },
    report,
  };
}
