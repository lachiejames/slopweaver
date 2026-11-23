/**
 * The POST step of a pass (`./pass.ts`): every arrival a measured monitor folded becomes a recorded card, a held row
 * or a refusal, one subject at a time and in order.
 *
 * Split from `./pass.ts` along the seam the module overview already names — READ, POST, SETTLE — so the pass reads
 * as ordering while each step's I/O sits beside its own rules. Every way a card SETTLES is `./passSettle.ts`.
 */
import type { NoteLevel } from "../hand/note/panel.js";
import type { HandStep } from "../hand/step.js";
import { appendHandRow, type PostingAdmission } from "../hand/store.js";
import { err, ok, type Result } from "../lib/result.js";

import { buildArrival } from "./card.js";
import type { PassAction } from "./passSettle.js";
import { type MonitorDefinition, occurrenceBase } from "./registry.js";
import type { MonitorSubject } from "./types.js";

/**
 * Raise one newly posted step's floating note: `ok` with a phrase saying what the note did (drew, or was already
 * up), `err` with why it could not come up. Injected so the pass stays free of the macOS launch, and so a test
 * passes a plain function that records the step. `level` is the monitor's own {@link monitorNoteLevel}.
 */
export type NoteRaiser = (options: { step: HandStep; level: NoteLevel }) => Result<string, string>;

/**
 * The window level a monitor's floating note draws at: its declared `noteLevel`, or the ordinary level every
 * other note shares when it declares none.
 *
 * @param definition the monitor speaking
 * @returns the level its note draws at
 */
export function monitorNoteLevel({ definition }: { definition: MonitorDefinition }): NoteLevel {
  if (definition.noteLevel === undefined) {
    return "ordinary";
  }
  return definition.noteLevel;
}

/**
 * Open one newly posted step's page on the owner's screen — the sign-in a monitor's card asks for, so the window is already
 * up when the note says to sign in there (`../hand/runnableLiteral.ts`): `ok` with a phrase saying what opened, `err`
 * with why it could not. Injected for {@link NoteRaiser}'s reasons; never called for a re-raise or without `fire`.
 */
export type PageOpener = (options: { url: string }) => Promise<Result<string, string>>;

/**
 * Every arrived subject's row, in the order the fold produced them: a held subject's `held` row, or what posting
 * its card did.
 *
 * @param arrived the subjects the fold found newly arrived
 * @param monitorId the monitor that read them, named on a held row
 * @param definition the monitor speaking
 * @param consoleBase the console origin every card's own link opens on
 * @param postedIds every posted step id, open or settled, the pass read before deciding — a card posted beside an
 *   occurrence it never saw is refused
 * @returns one subject's rows after another
 */
export async function arrivalActions({
  arrived,
  monitorId,
  definition,
  consoleBase,
  fire,
  home,
  nowIso,
  postedIds,
  openPage,
  postedBy,
  raiseNote,
}: {
  arrived: readonly MonitorSubject[];
  monitorId: string;
  definition: MonitorDefinition;
  consoleBase: string;
  fire: boolean;
  home: string;
  nowIso: string;
  postedIds: readonly string[];
  openPage: PageOpener;
  postedBy: string;
  raiseNote: NoteRaiser;
}): Promise<PassAction[]> {
  const seenPosted = new Set(postedIds);
  const arrivals: PassAction[] = [];
  for (const subject of arrived) {
    // A held subject posts nothing and says why; an open card for it stands, since it is still read and so never
    // departs.
    if (subject.delivery?.kind === "hold") {
      arrivals.push({ detail: subject.delivery.why, kind: "held", monitorId, stepId: definition.id });
      continue;
    }
    arrivals.push(
      ...(await postArrival({
        consoleBase,
        definition,
        fire,
        home,
        nowIso,
        openPage,
        postedBy,
        raiseNote,
        seenPosted,
        subject,
      })),
    );
  }
  return arrivals;
}

/**
 * Post ONE arrived subject's card, or say why it could not be.
 *
 * Four things can stop a card, and each answers a `refused` row naming the monitor and the subject rather
 * than throwing: the monitor's own compose cap, the register's own gates (`fleetActorPhrase`, the
 * second-sentence refusal), and the append itself. A floating monitor's note failing after the append is a
 * fifth `refused` row beside the posting, never a lost step. Rule 6 is why none of them is silent.
 *
 * @param definition the monitor speaking
 * @param subject the thing it is speaking about
 * @param home the state home the register lives under
 * @param nowIso the instant to record
 * @param postedBy which session is running the pass
 * @param fire false decides and writes nothing
 * @param raiseNote draws a floating monitor's note once its step is recorded
 * @param openPage opens the subject's page once its card is known to build, before the card is recorded
 * @param consoleBase the console origin every card's own link opens on
 * @param seenPosted every posted step id this pass read before deciding, which a card it posts may follow
 * @returns what happened — the posting, the page's row when one opens, then the note's own row when the monitor floats
 */
async function postArrival({
  definition,
  subject,
  home,
  nowIso,
  postedBy,
  fire,
  raiseNote,
  openPage,
  consoleBase,
  seenPosted,
}: {
  definition: MonitorDefinition;
  subject: MonitorSubject;
  home: string;
  nowIso: string;
  postedBy: string;
  fire: boolean;
  raiseNote: NoteRaiser;
  openPage: PageOpener;
  consoleBase: string;
  seenPosted: ReadonlySet<string>;
}): Promise<readonly PassAction[]> {
  const monitorId = definition.id;
  const buildOf =
    ({ shown }: { shown: MonitorSubject }): OccurrenceBuild =>
    ({ occurrence }) =>
      buildArrival({ address: { consoleBase, occurrence }, definition, nowIso, postedBy, subject: shown });
  const built = buildOf({ shown: subject })({ occurrence: 1 });
  if (built.isErr()) {
    return [{ detail: built.error.detail, kind: "refused", monitorId, stepId: built.error.stepId }];
  }
  if (!fire) {
    return [{ detail: `would post: ${built.value.what}`, kind: "posted", monitorId, stepId: built.value.id }];
  }
  const { opened, shown } = await openFirst({ openPage, subject });
  const recorded = await appendOccurrence({ build: buildOf({ shown }), home, nowIso, seenPosted });
  if (recorded.isErr()) {
    return [{ detail: recorded.error.detail, kind: "refused", monitorId, stepId: recorded.error.stepId }];
  }
  const step = recorded.value;
  const stepId = step.id;
  const posted: PassAction = { detail: step.what, kind: "posted", monitorId, stepId };
  const page = pageRows({ monitorId, opened, stepId });
  if (definition.floats !== true) {
    return [posted, ...page];
  }
  // AFTER the append, never before: the record is the half that cannot be retried, the note the half that can.
  const note = raiseNote({ level: monitorNoteLevel({ definition }), step });
  if (note.isErr()) {
    return [
      posted,
      ...page,
      { detail: `the floating note did not come up: ${note.error}`, kind: "refused", monitorId, stepId },
    ];
  }
  return [posted, ...page, { detail: note.value, kind: "noted", monitorId, stepId }];
}

/**
 * Open the subject's page BEFORE its card is recorded, so the window is up when the note says to sign in there, and
 * answer the subject the card should speak about: one whose page would not open loses `opens`, so its card never
 * claims a window that is not on the owner's screen. A card the append then refuses leaves an open sign-in page and no note,
 * which is the cheaper of the two wrongs.
 *
 * @param subject the arrived subject
 * @param openPage the injected opener
 * @returns what the opener said, or `undefined` when the subject carries no page; and the subject to post
 */
async function openFirst({ subject, openPage }: { subject: MonitorSubject; openPage: PageOpener }): Promise<{
  opened: Result<string, string> | undefined;
  shown: MonitorSubject;
}> {
  if (subject.opens === undefined) {
    return { opened: undefined, shown: subject };
  }
  const opened = await openPage({ url: subject.opens });
  return { opened, shown: opened.isErr() ? { ...subject, opens: undefined } : subject };
}

/**
 * The page's row beside a posting — nothing when the subject carried none. A page that would not open is a `refused`
 * row, never a lost step: the card still posts, saying only which sign-in.
 *
 * @param opened what the opener said
 * @param monitorId the monitor speaking
 * @param stepId the step recorded
 * @returns the page's row, or none
 */
function pageRows({
  opened,
  monitorId,
  stepId,
}: {
  opened: Result<string, string> | undefined;
  monitorId: string;
  stepId: string;
}): readonly PassAction[] {
  if (opened === undefined) {
    return [];
  }
  if (opened.isErr()) {
    return [{ detail: `the page did not open: ${opened.error}`, kind: "refused", monitorId, stepId }];
  }
  return [{ detail: opened.value, kind: "noted", monitorId, stepId }];
}

/** Why one arrival was not recorded, naming the occurrence id it stopped at. */
type OccurrenceRefusal = { readonly detail: string; readonly stepId: string };

/** One arrival built for one occurrence of its id — `buildArrival` with every other input already bound. */
type OccurrenceBuild = (options: { occurrence: number }) => Result<HandStep, OccurrenceRefusal>;

/**
 * Record one step under the first occurrence id the register has not already spent.
 *
 * Each occurrence is BUILT for its own id rather than renamed after the fact, because the card's link opens that
 * id (`./card.ts`'s `buildArrival`): a `.2` renamed from the base would open the base card, settled long ago.
 *
 * No cap: every spent id is a row already in the register, so the walk ends one past the last of them. A cap
 * would leave the subject's next recurrence with no card at all.
 *
 * ## A card a racing pass recorded is never doubled
 *
 * The pass only posts a subject with no open card in its own read, so ANY occurrence of this card that read never
 * saw was recorded by another pass since — the keep-alive and the supervisor tick both fire, and a slow one may be
 * overtaken on the fired-pass lease (`./firedPassLock.ts`). Settled since counts too: the owner's Done can close the racer's
 * card before this append, and a guard over open cards alone would post the next occurrence.
 * Judged under the register's lock, at the append itself, so no interleaving gets past it: the later append is
 * refused, and with it the second note. An occurrence the read DID see is the subject's own
 * earlier card — a returning leftover, or one the owner closed — which this posting follows.
 *
 * @param build the arrival, built for one occurrence
 * @param home the state home the register lives under
 * @param nowIso the instant to record
 * @param seenPosted every posted step id, open or settled, in the register read the pass decided on
 * @returns the step as recorded, or the refusal naming the occurrence id it stopped at
 */
async function appendOccurrence({
  build,
  home,
  nowIso,
  seenPosted,
}: {
  build: OccurrenceBuild;
  home: string;
  nowIso: string;
  seenPosted: ReadonlySet<string>;
}): Promise<Result<HandStep, OccurrenceRefusal>> {
  let base: string | undefined;
  const admitPosting: PostingAdmission = ({ posted }) => {
    const raced = posted.find((id) => occurrenceBase({ id }) === base && !seenPosted.has(id));
    if (raced === undefined) {
      return undefined;
    }
    return `another monitor pass recorded ${raced} after this pass read the register, and that card answers this subject — no second card or note`;
  };
  for (let occurrence = 1; ; occurrence += 1) {
    const candidate = build({ occurrence });
    if (candidate.isErr()) {
      return err(candidate.error);
    }
    base = occurrenceBase({ id: candidate.value.id });
    const written = await appendHandRow({ admitPosting, home, nowIso, row: { kind: "posted", step: candidate.value } });
    // `appended: false` is a byte-identical earlier posting under this id — spent all the same, because the
    // caller only posts a subject with no open card.
    if (written.isOk() && written.value.appended) {
      return ok(candidate.value);
    }
    if (written.isErr() && written.error.code !== "STEP_ID_CONFLICT") {
      return err({ detail: written.error.message, stepId: candidate.value.id });
    }
  }
}
