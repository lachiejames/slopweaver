/**
 * The exact BYTES `slopweaver handover register` writes — front-matter, body, and the slug the file is
 * named for.
 *
 * Split from {@link ./askRowRun.js} (the file-size ratchet, step 5), which now holds only the flag
 * resolution and the filesystem half. The seam is purity: everything here is a string in and a string out,
 * so a test of what a row LOOKS like needs no temp directory, while everything left in `askRowRun.ts`
 * touches the disk or the environment. `./askRowArgs.ts` and `./settleRowRun.ts` are the two earlier cuts
 * along the same line.
 */

import { askDoneCommand } from "../../../handover/askDoneCommand.js";
import { type AskExampleSet, askExampleFrontMatter } from "../../../handover/askExamples.js";
import { type AskShape, type AskStakes, askOptionsBlock } from "../../../handover/askShape.js";
import { ASK_HEADING } from "../../../handover/briefPaths.js";
import { encodeFlatScalar } from "../../../handover/flatScalarCodec.js";
import { type HisWordsRecord, hisWordsFields } from "../../../handover/hisWords.js";
import type { RegisterProvenance } from "../../../handover/registerProvenance.js";
import { summaryScalar } from "../../../handover/summaryCap.js";
import type { StatedWorkspace } from "../../../handover/workspace.js";

/** The longest a generated slug runs, in words — enough to be recognisable on the board, short enough to type. */
const SLUG_WORDS = 8;

/**
 * A slug from the ask's own words: lowercase, hyphenated, first {@link SLUG_WORDS} words.
 *
 * @param ask the ask as the owner said it
 * @returns a kebab-case slug, or the empty string when the ask carries no word characters at all
 */
export function slugFromAsk({ ask }: { ask: string }): string {
  return ask
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, SLUG_WORDS)
    .join("-");
}

/**
 * The whole ask-row file, front-matter and body.
 *
 * `status: ready` because an unsettled ask IS runnable — someone can pick it up and turn it into work right
 * now, which is the entire point of putting it on this board rather than in a note. `doneWhen` and
 * `artifact: null` are the two fields `register-hygiene` would otherwise redden somebody else's push over;
 * `doneWhen` carries the owner's reply-since check when the anchor is a Slack message link, and is empty otherwise.
 *
 * @param ask the ask as the owner said it
 * @param slug the row's slug
 * @param askedIso when the owner said it
 * @param anchor where the owner said it, absent when nobody recorded one
 * @param priority the band it ranks in, absent to take the ask default
 * @param repo the repository the ask is about, absent when it is not about one
 * @param branch the head branch the row is about, absent when it is not about one. DECLARED rather than
 *   inferred: it is the exact signal the landing read joins a row to an open pull request by, and the exact
 *   signal a team-facing door matches a finding row by (`../../../handover/findingGate.ts`)
 * @param finding the observing session and the evidence, when a session registered this from what it saw
 *   rather than from the owner's words — absent for the owner's own ask
 * @param dispatch whether this row is WORK a seat picks up rather than anything waiting on the owner's word. It
 *   writes no front-matter of its own — there is nothing downstream that has to recover the fact, and a
 *   fourth discriminator would reach the board enum in `../../../store/schema/board.ts` — but it does decide
 *   the body's heading, because an ask heading over a machine-composed landing brief is the exact false
 *   attribution the finding body was split out to end
 * @param shape the problem, the options with their trade-offs and the lean (`../../../handover/askShape.ts`),
 *   absent when the row was registered with none — a `--finding` or `--dispatch` row being the ordinary
 *   case, since there is nothing for the owner to pick on either
 * @param checkedIso when this verb ran, written as `stillRealIso` beside the stakes so the card can age
 *   the still-real check — the register's own clock, never a caller's
 * @param hisWords what the owner said at `anchor`, read off its record at registration (`../../../handover/hisWords.ts`),
 *   or why it would not read; absent when the anchor names no record of the owner's words
 * @param provenance the session that registered the row and the run it held (`../../../handover/registerProvenance.ts`),
 *   each written only when established; absent from a caller that has none to give
 * @param bearsOn one line saying how the owner's quoted words bear on the question, drawn after every quote on the
 *   card as why it is in front of the owner — absent when the session gave none
 * @param examples the concrete scenes the card leads with, or the one line saying why the row has none —
 *   absent on a row that heads no card of the owner's
 * @param workspace whose work the row is and why (`./registerWorkspace.ts`), written as `workspace:` and
 *   `workspaceBecause:` — absent when the caller stated none, which leaves the row a finding the self Queue view draws
 * @returns the file's exact bytes
 */
export function askRowText({
  ask,
  dispatch,
  finding,
  shape,
  slug,
  ...front
}: {
  ask: string;
  slug: string;
  askedIso: string;
  anchor: string | undefined;
  priority: string | undefined;
  repo: string | undefined;
  branch: string | undefined;
  finding: { readonly observedBy: string; readonly evidence: readonly string[] } | undefined;
  dispatch: boolean;
  shape: AskShape | undefined;
  checkedIso: string;
  hisWords?: HisWordsRecord | undefined;
  provenance?: RegisterProvenance | undefined;
  bearsOn?: string | undefined;
  examples?: AskExampleSet | undefined;
  workspace?: StatedWorkspace | undefined;
}): string {
  const lines = [
    // Every field but `dispatch`, which only the body reads.
    ...frontMatter({ ask, finding, shape, slug, ...front }),
    "",
    `# ${ask}`,
    "",
    ...rowBody({ ask, dispatch, finding, slug }),
    "",
    ...(shape === undefined ? [] : shapeBody({ shape })),
    "## How this ends",
    "",
    "`slopweaver handover settle " +
      slug +
      " --as filed|answered|declined --witness <value>`. A row a talk relay " +
      "registered with a hand card open also passes `--card done|recut|kept` — the verb names the card when it does.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * The front-matter block, `---` to `---` — every key a board reader parses, and nothing a human reads.
 *
 * Its own function because it is the one place {@link encodeFlatScalar} has to be applied without exception: a
 * field added to the list below and interpolated bare reopens the injection class, and having the whole
 * block in one short body is what makes that visible in a diff.
 */
function frontMatter({
  ask,
  slug,
  askedIso,
  anchor,
  priority,
  repo,
  branch,
  finding,
  shape,
  checkedIso,
  hisWords,
  provenance,
  bearsOn,
  examples,
  workspace,
}: {
  ask: string;
  slug: string;
  askedIso: string;
  anchor: string | undefined;
  priority: string | undefined;
  repo: string | undefined;
  branch: string | undefined;
  finding: { readonly observedBy: string; readonly evidence: readonly string[] } | undefined;
  shape: AskShape | undefined;
  checkedIso: string;
  hisWords?: HisWordsRecord | undefined;
  provenance?: RegisterProvenance | undefined;
  bearsOn?: string | undefined;
  examples?: AskExampleSet | undefined;
  workspace?: StatedWorkspace | undefined;
}): readonly string[] {
  return [
    "---",
    `slug: ${encodeFlatScalar({ value: slug })}`,
    "kind: ask",
    `summary: ${summaryScalar({ summary: ask })}`,
    "status: ready",
    `askedIso: ${encodeFlatScalar({ value: askedIso })}`,
    ...(anchor === undefined ? [] : [`anchor: ${encodeFlatScalar({ value: anchor })}`]),
    // Whole or absent, like the shape below — `../../../handover/hisWords.ts` reads a partial group as a defect.
    ...(hisWords === undefined ? [] : hisWordsFields({ record: hisWords }).map(({ key, value }) => `${key}: ${value}`)),
    ...provenanceKeys({ provenance }),
    ...(bearsOn === undefined ? [] : [`bearsOn: ${JSON.stringify(bearsOn)}`]),
    ...(priority === undefined ? [] : [`priority: ${encodeFlatScalar({ value: priority })}`]),
    ...(repo === undefined ? [] : [`repo: ${encodeFlatScalar({ value: repo })}`]),
    ...(branch === undefined ? [] : [`branch: ${encodeFlatScalar({ value: branch })}`]),
    ...workspaceKeys({ workspace }),
    ...findingKeys({ finding }),
    ...shapeKeys({ checkedIso, shape }),
    ...exampleKeys({ examples }),
    "blockedBy: []",
    "artifact: null",
    ...doneWhenKeys({ anchor }),
    "---",
  ];
}

/**
 * The row's workspace keys: the pair `handover set-workspace` writes, spelt the same way, so a row placed at birth
 * reads like one placed later — or none.
 */
function workspaceKeys({ workspace }: { workspace: StatedWorkspace | undefined }): readonly string[] {
  if (workspace === undefined) {
    return [];
  }
  return [
    `workspace: ${encodeFlatScalar({ value: workspace.workspace })}`,
    `workspaceBecause: ${JSON.stringify(workspace.because)}`,
  ];
}

/**
 * The row's shape keys — problem, lean, stakes and options — WHOLE or absent, never partial:
 * `../../../handover/askRow.ts`'s `shapeProblems` reports a partial as a board defect, and this is the writer that
 * must never create one.
 */
function shapeKeys({ shape, checkedIso }: { shape: AskShape | undefined; checkedIso: string }): readonly string[] {
  if (shape === undefined) {
    return [];
  }
  return [
    `problem: ${JSON.stringify(shape.problem)}`,
    `lean: ${JSON.stringify(shape.lean)}`,
    ...stakesKeys({ checkedIso, stakes: shape.stakes }),
    askOptionsBlock(shape),
  ];
}

/**
 * The scenes the card leads with, or why the row has none — through the one writer `handover example` shares —
 * else no key at all.
 */
function exampleKeys({ examples }: { examples: AskExampleSet | undefined }): readonly string[] {
  if (examples === undefined) {
    return [];
  }
  return askExampleFrontMatter({ set: examples }).set.map(({ key, value }) => `${key}: ${value}`);
}

/**
 * The row's done-check: the owner's reply after the Slack message it is anchored to, when the anchor is one
 * (`../../../handover/askDoneCommand.ts`), else none — an ask anchored anywhere else is done when the owner rules on
 * it or it is settled, and the card says exactly that.
 */
function doneWhenKeys({ anchor }: { anchor: string | undefined }): readonly string[] {
  const command = askDoneCommand({ anchor });
  if (command === undefined) {
    return ["doneWhen: []"];
  }
  return ["doneWhen:", `  - command: ${JSON.stringify(command)}`];
}

/** A finding row's origin keys: who observed it and from what, every value a flat scalar. */
function findingKeys({
  finding,
}: {
  finding: { readonly observedBy: string; readonly evidence: readonly string[] } | undefined;
}): readonly string[] {
  if (finding === undefined) {
    return [];
  }
  return [
    "origin: finding",
    `observedBy: ${encodeFlatScalar({ value: finding.observedBy })}`,
    `evidence: [${finding.evidence.map((item) => encodeFlatScalar({ value: item })).join(", ")}]`,
  ];
}

/**
 * Who wrote the row down, so a card with no anchor still names where it came from — each key only when known,
 * and each value through {@link encodeFlatScalar}, since the session id is read from the environment.
 */
function provenanceKeys({ provenance }: { provenance: RegisterProvenance | undefined }): readonly string[] {
  return [
    ...(provenance?.registeredBy === undefined
      ? []
      : [`registeredBy: ${encodeFlatScalar({ value: provenance.registeredBy })}`]),
    ...(provenance?.registeredRun === undefined
      ? []
      : [`registeredRun: ${encodeFlatScalar({ value: provenance.registeredRun })}`]),
  ];
}

/**
 * The stakes' front-matter keys, and the instant their still-real check was made — whole or absent, like the
 * shape they sit beside.
 *
 * @param checkedIso the verb's own clock, never a typed date
 * @returns the four key lines, or none for a row that states no stakes
 */
function stakesKeys({ stakes, checkedIso }: { stakes: AskStakes | undefined; checkedIso: string }): readonly string[] {
  if (stakes === undefined) {
    return [];
  }
  return [
    `risk: ${JSON.stringify(stakes.risk)}`,
    `blastRadius: ${JSON.stringify(stakes.blastRadius)}`,
    `stillReal: ${JSON.stringify(stakes.stillReal)}`,
    `stillRealIso: ${encodeFlatScalar({ value: checkedIso })}`,
  ];
}

/**
 * Which body a row carries — the one thing about it that says where it CAME FROM, in a reader's own words.
 *
 * Three arms rather than a heading with a variable in it, because each says something different and one of
 * them names a verb. Written as `if`s that return: `no-nested-ternaries` refuses the alternative, and a
 * heading picked by an expression is how the owner-ask heading ended up over a row nobody asked for.
 */
function rowBody({
  ask,
  dispatch,
  finding,
  slug,
}: {
  ask: string;
  dispatch: boolean;
  finding: { readonly observedBy: string; readonly evidence: readonly string[] } | undefined;
  slug: string;
}): readonly string[] {
  if (finding !== undefined) {
    return findingBody({ ask, finding, slug });
  }
  if (dispatch) {
    return dispatchBody({ ask });
  }
  return [ASK_HEADING, "", ask];
}

/**
 * The body of a dispatch row — the brief a seat acts on, and the sentence saying nothing here waits on the owner.
 *
 * The second half earns its place because the row is otherwise indistinguishable from the owner's own ask on the
 * board: same `kind: ask`, same ranking, same settlement. A reader who opens it should learn in one line
 * that the pull request is already the owner's and already team-facing, so clearing it is the fleet's own work
 * (`AGENTS.md` rule 10) rather than something to card the owner about.
 */
function dispatchBody({ ask }: { ask: string }): readonly string[] {
  return [
    "## Work to dispatch",
    "",
    ask,
    "",
    "Registered as work a seat picks up, not as a question: nobody is waiting on the owner's word here, so this row",
    "carries no problem, options or lean. It is not a finding either — no team-facing door holds on it.",
  ];
}

/**
 * The shape as the doc's own markdown — the same three fields the front-matter carries, written where a
 * reader who opened the file will actually see them.
 *
 * Not a second source of the fact: the front-matter is what every board reader parses, and this is the same
 * strings rendered once. A reader opening a row the owner has been asked to decide should not have to read YAML.
 */
function shapeBody({ shape }: { shape: AskShape }): readonly string[] {
  return [
    "## The problem",
    "",
    shape.problem,
    "",
    "## Options",
    "",
    ...shape.options.map((option) => `- **${option.letter}** — ${option.option}. _Trade-off:_ ${option.tradeoff}`),
    "",
    "## The lean",
    "",
    `${shape.lean} (this session's recommendation, in the owner's voice — not the owner's word.)`,
    "",
    ...(shape.stakes === undefined
      ? []
      : [
          "## The stakes",
          "",
          `- **Risk** — ${shape.stakes.risk}`,
          `- **Blast radius** — ${shape.stakes.blastRadius}`,
          `- **Still real** — ${shape.stakes.stillReal}`,
          "",
        ]),
  ];
}

/**
 * The body of a finding row — what was OBSERVED, by whom, from what, and the one thing that must happen
 * before it reaches a teammate. Deliberately not headed with the owner-ask heading: that heading on a row nobody
 * asked for is a false attribution.
 */
function findingBody({
  ask,
  finding,
  slug,
}: {
  ask: string;
  finding: { readonly observedBy: string; readonly evidence: readonly string[] };
  slug: string;
}): readonly string[] {
  return [
    "## What was observed",
    "",
    ask,
    "",
    "## Where this came from",
    "",
    // Same `encodeFlatScalar` as the front-matter, for the same reason one step further down: a newline inside a
    // code span breaks the span, and one inside a bullet authors a bullet nobody wrote. The body cannot
    // author a KEY — it sits after the closing `---` — so this is legibility rather than the injection
    // property, and it keeps one spelling of a value across the two places a row prints it.
    `A fleet finding, not something the owner asked for. Observed by session \`${encodeFlatScalar({ value: finding.observedBy })}\` from:`,
    "",
    ...finding.evidence.map((item) => `- ${encodeFlatScalar({ value: item })}`),
    "",
    "Presenting the finding to the owner is useful; a pull request on a team-reviewed base or a review ask is",
    "REFUSED until the owner's ruling is on this row:",
    "",
    "`slopweaver handover rule " + slug + ' --anchor <where the owner said it> --words "<the owner\'s words>"`.',
  ];
}
