/**
 * The read, count and append every judgement of a held row shares (`./draftJudgementRun.ts`): which row it names,
 * which card landings it judged, and whether the line it appended is the one the register now reads.
 */
import { logger } from "../../../lib/logger.js";
import { liveCutOf } from "../../../outbound/slack/draftLiveCut.js";
import { foldSlackDraftLog, parseSlackDraftLog, skippedLinesTouching } from "../../../outbound/slack/draftLog.js";
import { type SlackDraftEvent, type SlackDraftItem, slackDraftById } from "../../../outbound/slack/draftRegister.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../exitCodes.js";
import type { SlackDraftDeps } from "./draftRun.js";

/** The edges a judgement touches: the register, read, appended to once and read back, the landings, and the clock. */
export type JudgementDeps = Pick<
  SlackDraftDeps,
  "appendEvent" | "lockRegister" | "nowIso" | "out" | "readLandedDrafts" | "readLog"
>;

/**
 * How many card-landing ledger rows a judgement judged, read before it appends: a landing written past them is words
 * it never saw, whatever instant the owner spoke them at, so it stays owed. When the landings do not read, a
 * judgement OF THE OWNER'S WORDS — an approve, or a hold for the not-a-yes reason or `meaning-changed` — is refused:
 * uncounted, it would fall back on instants and answer a yes written after it but decided before it. A blocking hold
 * judges none of the owner's words, so it goes on uncounted.
 *
 * @param answers whether the judgement answers the owner's words, so it must know which ones it read
 * @param id the row being judged, named in the refusal
 * @returns the count to record, none when a blocking hold could not read it, or the refusal already logged
 */
export function landingsJudged({
  answers,
  deps,
  home,
  id,
}: {
  answers: boolean;
  deps: JudgementDeps;
  home: string;
  id: string;
}): { readonly kind: "counted"; readonly landingsRead?: number } | { readonly kind: "refused" } {
  const log = parseSlackDraftLog({ lines: deps.readLog({ home }) });
  const landed = deps.readLandedDrafts({ home, items: foldSlackDraftLog({ log }), skipped: log.skipped });
  if (landed.kind === "read") {
    return { kind: "counted", landingsRead: landed.ledgerRows };
  }
  if (!answers) {
    return { kind: "counted" };
  }
  logger.error({
    msg:
      `the card landings could not be read (${landed.why}), so which of the owner's words this judgement of ${id} answers is ` +
      "unknown. Repair that read (the tick refuses on an unreadable one too), then judge it. Nothing was recorded.",
  });
  return { kind: "refused" };
}

/**
 * The held row a judgement names, or the exit for why it cannot be judged. A register line this build cannot read that
 * names the row refuses: the row's state is then unknown, and a judgement over it could land on a park nobody sees.
 *
 * @param id the row the judgement names
 * @returns the held row, or the exit code already explained
 */
export function heldRow({
  deps,
  home,
  id,
}: {
  deps: JudgementDeps;
  home: string;
  id: string;
}): { readonly kind: "row"; readonly item: SlackDraftItem } | { readonly kind: "exit"; readonly code: number } {
  const log = parseSlackDraftLog({ lines: deps.readLog({ home }) });
  const unsure = skippedLinesTouching({ id, log });
  if (unsure.length > 0) {
    logger.error({
      msg:
        `${id}: ${String(unsure.length)} register line(s) naming it do not read on this build, so its state is unknown ` +
        "and nothing was recorded. Rebuild this seat on current main (`slopweaver dev build`) and re-run this.",
    });
    return { code: EXIT_ERROR, kind: "exit" };
  }
  const found = slackDraftById({ id, items: foldSlackDraftLog({ log }), mustBeHeld: true });
  if (found.isErr()) {
    logger.error({ msg: found.error.message });
    return { code: EXIT_EXPECTED_EMPTY, kind: "exit" };
  }
  return { item: found.value, kind: "row" };
}

/**
 * Append one judgement and read it back, or say why it does not stand. The register lock (`./draftRegisterLock.ts`)
 * keeps every judging verb out of the gap between the read and the append, but a release appends after its Slack send
 * without it, so one landing there leaves the line journalled where the fold ignores it; the read-back is what keeps
 * the exit honest.
 *
 * @param event the approve or hold to append
 * @returns whether the register now reads this judgement as the row's latest
 */
export function appendJudgement({
  deps,
  event,
  home,
}: {
  deps: JudgementDeps;
  event: SlackDraftEvent;
  home: string;
}): boolean {
  const appended = deps.appendEvent({ event, home });
  if (appended.isErr()) {
    logger.error({ msg: `${appended.error.message} — nothing was recorded; the row is as it was.` });
    return false;
  }
  const after = foldSlackDraftLog({ log: parseSlackDraftLog({ lines: deps.readLog({ home }) }) });
  const row = after.find((item) => item.id === event.id);
  if (row === undefined || !judgementStands({ event, row })) {
    logger.error({ msg: movedMessage({ after, id: event.id }) });
    return false;
  }
  return true;
}

/**
 * Why a judgement does not stand, naming the cut it is now owed on: a row re-cut meanwhile hands it to the cut its drop
 * note leads to, which is named with what it lacks when the dropped row carried the owner's yes.
 *
 * @param after the register as folded after the append
 * @param id the row the judgement named
 * @returns the error line
 */
export function movedMessage({ after, id }: { after: readonly SlackDraftItem[]; id: string }): string {
  const cut = liveCutOf({ id, items: after });
  if (cut === undefined) {
    return `${id} is gone from the register, so this judgement does not stand. List what is held: \`slopweaver slack draft list\`.`;
  }
  const named = cut.superseded.length === 0 ? cut.live : cut.superseded[0]!;
  const moved = `${id} moved (${named.state}) before this judgement landed, so the register does not read it.`;
  const standing = cut.live;
  if (standing.id === id || standing.state !== "held") {
    return `${moved} Read it again (\`slopweaver slack draft show ${id}\`) and judge it as it stands.`;
  }
  const lacks =
    named.draft.approval !== undefined &&
    standing.draft.approval === undefined &&
    standing.draft.meaningChanged === undefined;
  const owes = lacks ? ", which carries neither the owner's yes nor a --meaning-changed" : "";
  return (
    `${moved} The cut that stands is ${standing.id}${owes}. Judge that one: read it (\`slopweaver slack draft show ` +
    `${standing.id}\`), then \`slopweaver slack draft approve ${standing.id} --anchor "<anchor of the owner's yes>"\` or ` +
    `\`slopweaver slack draft hold ${standing.id} --reason <reason> --why "<why>"\`.`
  );
}

/**
 * Whether the folded row carries exactly this judgement as its latest — its instant AND its words, since a concurrent
 * judgement can share the millisecond. A blocking hold keeps the instant of the judgement it sits
 * over, so a hold stands by its own instant.
 */
function judgementStands({ event, row }: { event: SlackDraftEvent; row: SlackDraftItem }): boolean {
  if (row.state !== "held") {
    return false;
  }
  if (event.kind === "held") {
    return (
      row.hold !== undefined &&
      row.hold.atIso === event.tsIso &&
      row.hold.reason === event.reason &&
      row.hold.why === event.why
    );
  }
  if (event.kind === "approved") {
    const approval = row.draft.approval;
    return (
      row.judgedIso === event.tsIso &&
      row.hold === undefined &&
      approval !== undefined &&
      approval.anchor === event.approval.anchor &&
      approval.atIso === event.approval.atIso &&
      approval.heard === event.approval.heard
    );
  }
  return false;
}
