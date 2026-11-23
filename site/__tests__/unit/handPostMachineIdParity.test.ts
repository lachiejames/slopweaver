/*
 * `hand post` refuses exactly the step the Queue's card gate would withhold for a raw machine id.
 *
 * Two decision notes went up with a witness naming a call by its machine id, and the Queue's card gate held both
 * cards, because it refuses a
 * step that names a session, call, talk, turn or run by its machine id. The posting rule
 * (`src/hand/machineIdInProse.ts`, over the leaf `src/hand/cardDrawnProse.ts`) owns which step fields the card draws
 * in prose; this file, in the lane reaching both roots, puts each variant through BOTH: the posting rule's criterion,
 * and the register line as the console reads it (`readHandSteps`) built into its card (`handCard`) and judged by the
 * card gate (`machineIdForm`). A field one refuses and the other draws fails here, so the two lists cannot drift.
 *
 * The fixture's shape is declared here rather than imported from `src/hand/step.ts`, whose imports reach most of
 * `src/` and would pull it into the site's own type-check; the leaf reads a step structurally for the same reason.
 */

import { describe, expect, it } from "vitest";

import { machineIdInCardProse, machineIdInOpenedAsk } from "../../../src/hand/cardDrawnProse";
import { readHandSteps } from "../../components/live/readHandSteps";
import { type HandDecisionRecord, handCard } from "../../lib/handCard";
import { decisionForHand } from "../../lib/handStepAsk";
import { machineIdForm } from "../../lib/machineIdForm";
import { handSource } from "../../lib/queueCardSource";

/** A short hex id named as a call — the shape a witness carries when it cites a machine id. */
const ID = "call a0000019";

/** The posted register line's fields this file sets, as `src/hand/step.ts` `HandStep` writes them. */
interface PostedStep {
  readonly checklist?: readonly { readonly action: string; readonly command: string; readonly find?: string[] }[];
  readonly cites: readonly string[];
  readonly decision?:
    | {
        readonly lean: string;
        readonly options: readonly { readonly letter: string; readonly option: string; readonly tradeoff: string }[];
        readonly problem: string;
        readonly stakes: { readonly blastRadius: string; readonly risk: string; readonly stillReal: string };
      }
    | undefined;
  readonly id: string;
  readonly ifIgnored: string;
  readonly literal: string;
  readonly postedBy: string;
  readonly postedIso: string;
  readonly unaddressed: string;
  readonly unblocks: string;
  readonly url?: string;
  readonly what: string;
  readonly where: string;
  readonly witness: string;
}

/** A posted step whose every field is clean prose, carrying a checklist and a decision so each drawn field exists. */
const CLEAN: PostedStep = {
  checklist: [{ action: "Open the settings page.", command: "open https://example.test", find: ["Client ID"] }],
  cites: ["https://github.com/acme/app/pull/12"],
  decision: {
    lean: "Send it today.",
    options: [
      { letter: "A", option: "Send it.", tradeoff: "The owner reads it today." },
      { letter: "B", option: "Hold it.", tradeoff: "It waits a day." },
    ],
    problem: "The reply is unsent.",
    stakes: { blastRadius: "One thread.", risk: "A late reply.", stillReal: "Checked this morning." },
  },
  id: "send-the-reply",
  ifIgnored: "The thread goes quiet.",
  literal: "a paste",
  postedBy: "the chair",
  postedIso: "2026-11-01T04:39:00.000Z",
  unaddressed: "it happens in the owner's head",
  unblocks: "the reply to the room",
  what: "Pick whether the reply goes today",
  where: "the console",
  witness: "slopweaver hand done send-the-reply",
};

/** One variant: a name, and the step with one field carrying {@link ID}. */
interface Variant {
  readonly name: string;
  readonly step: PostedStep;
}

/** Every field the card draws in prose, each carrying the id — both gates refuse each one. */
const DRAWN: readonly Variant[] = [
  { name: "what", step: { ...CLEAN, what: `Pick whether the reply from ${ID} goes today` } },
  { name: "ifIgnored", step: { ...CLEAN, ifIgnored: `The thread from ${ID} goes quiet.` } },
  { name: "unblocks", step: { ...CLEAN, unblocks: `the reply ${ID} owes` } },
  { name: "unaddressed", step: { ...CLEAN, unaddressed: `it was settled on ${ID}` } },
  { name: "witness", step: { ...CLEAN, witness: `the reply ${ID} asked for is sent` } },
  { name: "checklist action", step: { ...CLEAN, checklist: [{ action: `Open what ${ID} named.`, command: "open" }] } },
  { name: "checklist find", step: { ...CLEAN, checklist: [{ action: "Open it.", command: "open", find: [ID] }] } },
  { name: "decision problem", step: { ...CLEAN, decision: { ...CLEAN.decision!, problem: `${ID} left it unsent.` } } },
  { name: "decision lean", step: { ...CLEAN, decision: { ...CLEAN.decision!, lean: `Send what ${ID} said.` } } },
  {
    name: "decision option",
    step: {
      ...CLEAN,
      decision: {
        ...CLEAN.decision!,
        options: [{ letter: "A", option: `Send ${ID}'s cut.`, tradeoff: "Today." }, CLEAN.decision!.options[1]],
      },
    },
  },
  {
    name: "decision stakes",
    step: { ...CLEAN, decision: { ...CLEAN.decision!, stakes: { ...CLEAN.decision!.stakes, risk: `${ID} lapses.` } } },
  },
];

/** Every field the card draws as an address or a copy block, each carrying the id — both gates allow each one. */
const UNDRAWN: readonly Variant[] = [
  { name: "where", step: { ...CLEAN, where: `the window ${ID} opened` } },
  { name: "literal", step: { ...CLEAN, literal: `resume ${ID}` } },
  { name: "cites", step: { ...CLEAN, cites: [`https://example.test/${ID.replace(" ", "/")}`] } },
  { name: "checklist command", step: { ...CLEAN, checklist: [{ action: "Run it.", command: `resume ${ID}` }] } },
  { name: "witness behind a URL", step: { ...CLEAN, witness: "https://example.test/call/a0000019 is answered" } },
  {
    name: "decision beside an incident's proof link",
    step: {
      ...CLEAN,
      decision: { ...CLEAN.decision!, stakes: { ...CLEAN.decision!.stakes, stillReal: `${ID} saw it recover.` } },
      url: "https://app.datadoghq.com/dashboard/api",
    },
  },
];

/**
 * Whether the Queue would withhold the step's card: the register line read as the console reads it, built, judged.
 *
 * @returns true when the card gate refuses it
 */
function queueWithholds({ step }: { step: PostedStep }): boolean {
  const read = readHandSteps([step])!;
  expect(read.length).toBe(1);
  const drawn = read[0];
  expect(drawn.unreadable).toBe(undefined);
  const { card } = handCard({ decision: decisionForHand({ linked: undefined, step: drawn }), step: drawn });
  return machineIdForm({ card, source: handSource({ rows: [], step: drawn }) }).kind === "refused";
}

/**
 * Whether `hand post` refuses the step for a machine id — the criterion its posting rule turns into the refusal.
 *
 * @returns true when the posting rule refuses it
 */
function postRefuses({ step }: { step: PostedStep }): boolean {
  return machineIdInCardProse({ step }) !== undefined;
}

/** A clean step with no decision of its own, opening a shaped ask. */
const OPENS_ASK: PostedStep = {
  ...CLEAN,
  decision: undefined,
  url: "http://localhost:3000/queue?open=ask%3Arelease-reply",
};

/** The opened ask's shape as the Queue joins it, every field clean. */
const ASK: HandDecisionRecord = {
  blastRadius: "One thread.",
  lean: "Send it today.",
  options: [
    { letter: "A", option: "Send it.", tradeoff: "The owner reads it today." },
    { letter: "B", option: "Hold it.", tradeoff: "It waits a day." },
  ],
  problem: "The release reply is unsent.",
  risk: "A late reply.",
  slug: "release-reply",
  stillReal: "Checked this morning.",
  stillRealIso: "2026-11-01T04:00:00.000Z",
  summary: "the release reply",
};

/** One opened-ask variant: a name, and the ask with one field carrying {@link ID}. */
interface AskVariant {
  readonly name: string;
  readonly ask: HandDecisionRecord;
}

/** Every field the card draws off an opened ask, each carrying the id — both gates refuse each one. */
const ASK_DRAWN: readonly AskVariant[] = [
  { ask: { ...ASK, summary: `the reply ${ID} owes` }, name: "summary" },
  { ask: { ...ASK, problem: `${ID} left the release reply unsent` }, name: "problem" },
  { ask: { ...ASK, lean: `Send what ${ID} said.` }, name: "lean" },
  {
    ask: { ...ASK, options: [{ letter: "A", option: `Send ${ID}'s cut.`, tradeoff: "Today." }, ASK.options[1]] },
    name: "option",
  },
  {
    ask: { ...ASK, options: [ASK.options[0], { letter: "B", option: "Hold it.", tradeoff: `${ID} waits.` }] },
    name: "tradeoff",
  },
  { ask: { ...ASK, risk: `${ID} lapses.` }, name: "risk" },
  { ask: { ...ASK, blastRadius: `the thread ${ID} opened` }, name: "blast radius" },
  { ask: { ...ASK, stillReal: `${ID} saw it still stand.` }, name: "still real" },
];

/**
 * Whether the Queue withholds the card of {@link OPENS_ASK} when the ask it opens is `ask`.
 *
 * @returns true when the card gate refuses it
 */
function queueWithholdsOpened({ ask }: { ask: HandDecisionRecord }): boolean {
  const drawn = readHandSteps([OPENS_ASK])![0];
  expect(drawn.unreadable).toBe(undefined);
  const { card } = handCard({ decision: ask, step: drawn });
  return machineIdForm({ card, source: handSource({ rows: [], step: drawn }) }).kind === "refused";
}

/**
 * Whether `hand post` refuses {@link OPENS_ASK} for the ask it opens — the criterion its opened-ask check reads.
 *
 * @returns true when the posting check refuses it
 */
function postRefusesOpened({ ask }: { ask: HandDecisionRecord }): boolean {
  return postRefuses({ step: OPENS_ASK }) || machineIdInOpenedAsk({ ask }) !== undefined;
}

/** Opened asks whose id sits only where the card draws nothing — both gates allow each one. */
const ASK_UNDRAWN: readonly AskVariant[] = [
  { ask: { ...ASK, risk: undefined, stillReal: `${ID} saw it still stand.` }, name: "still real beside no risk" },
  {
    ask: { ...ASK, blastRadius: undefined, stillReal: `${ID} saw it still stand.` },
    name: "still real beside no reach",
  },
];

describe("hand post refuses exactly what the Queue's card gate withholds, for the ask a step opens", () => {
  it("allows an id in a stakes line the card does not draw at both", () => {
    expect(ASK_UNDRAWN.length).toBeGreaterThan(0);
    const verdicts = ASK_UNDRAWN.map(({ name, ask }) => [
      name,
      postRefusesOpened({ ask }),
      queueWithholdsOpened({ ask }),
    ]);
    expect(verdicts).toEqual(ASK_UNDRAWN.map(({ name }) => [name, false, false]));
  });

  it("draws a clean step opening a clean ask through both", () => {
    expect([postRefusesOpened({ ask: ASK }), queueWithholdsOpened({ ask: ASK })]).toEqual([false, false]);
  });

  it("refuses every field the opened ask draws at both", () => {
    expect(ASK_DRAWN.length).toBeGreaterThan(0);
    const verdicts = ASK_DRAWN.map(({ name, ask }) => [
      name,
      postRefusesOpened({ ask }),
      queueWithholdsOpened({ ask }),
    ]);
    expect(verdicts).toEqual(ASK_DRAWN.map(({ name }) => [name, true, true]));
  });
});

describe("hand post refuses exactly what the Queue's card gate withholds", () => {
  it("draws the clean step through both", () => {
    expect([postRefuses({ step: CLEAN }), queueWithholds({ step: CLEAN })]).toEqual([false, false]);
  });

  it("refuses every drawn prose field at both", () => {
    expect(DRAWN.length).toBeGreaterThan(0);
    const verdicts = DRAWN.map(({ name, step }) => [name, postRefuses({ step }), queueWithholds({ step })]);
    expect(verdicts).toEqual(DRAWN.map(({ name }) => [name, true, true]));
  });

  it("allows an id in an address or a copy block at both", () => {
    expect(UNDRAWN.length).toBeGreaterThan(0);
    const verdicts = UNDRAWN.map(({ name, step }) => [name, postRefuses({ step }), queueWithholds({ step })]);
    expect(verdicts).toEqual(UNDRAWN.map(({ name }) => [name, false, false]));
  });
});
