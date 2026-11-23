/**
 * THE NOTIFICATION — one banner, composed from what arrived, capped by a schema that REFUSES.
 *
 * Rule 7 is the whole design here: a message the bot sends is concise by default, and **shape is enforced by
 * the SCHEMA, never by review** — a form caps what appears above the fold and refuses a violation rather
 * than truncating one. A notification is nothing BUT above the fold, so the cap is the message.
 *
 * ## Why refusing beats letting macOS truncate
 *
 * macOS clips a long body silently and with no ellipsis of its own in every position, so an over-long line
 * arrives as a sentence that stops. That is the exact failure rule 7 names — a wall of text wearing a
 * banner's clothes — and the fix is the one the briefing form already uses: build it short or do not build it.
 *
 * ## One notification, never N
 *
 * Three arrivals are one banner naming the top one and the count, not three banners. The detail is in the
 * floating note (`../note/panel.ts`) and in the register, which is progressive disclosure on a surface with
 * room for exactly one line.
 *
 * Pure: subjects in, an argv out. No I/O, no clock.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type HandStepError, HandStepErrors } from "../errors.js";
import type { PushSubject, PushSubjectKind } from "./select.js";

/** The banner's caps. Measured against Notification Center's own line widths at the default alert size. */
const TITLE_CAP = 40;
const SUBTITLE_CAP = 60;
const BODY_CAP = 120;

/** The three lines a banner carries. */
export interface PushNotice {
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
}

/**
 * The title one arrival takes — the owner's own words for each case, not a label.
 *
 * @param kind which of the three it is
 * @returns the title
 */
function titleFor({ kind }: { kind: PushSubjectKind }): string {
  switch (kind) {
    case "sign-in":
      return "A live thing is blocked";
    case "go-ahead":
      return "Something needs your go-ahead";
    case "hand-step":
      return "One step needs your hand";
  }
}

/**
 * The second line one arrival takes — what to actually do.
 *
 * A hand step says where it is: on screen when this pass drew or kept its note, otherwise in the menu bar's
 * list — the note did not come up, or the top arrival is not a hand step with a note of its own.
 *
 * @param kind which of the three it is
 * @param noteShown whether the top arrival's own note is on screen after this pass
 * @returns the line
 */
function callFor({ kind, noteShown }: { kind: PushSubjectKind; noteShown: boolean }): string {
  switch (kind) {
    case "sign-in":
      return "Come sign in";
    case "go-ahead":
      return "Say yes or no";
    case "hand-step":
      return noteShown ? "The note is on screen, top right" : "It is in the menu bar list";
  }
}

/**
 * Cut one line to its cap at a word boundary, never mid-word and never with an ellipsis.
 *
 * Used ONLY on a headline the register already capped at 120 or 200 characters — never to rescue a line that
 * failed {@link buildPushNotice}'s own check. The distinction is the one rule 7 draws: a composed line that
 * is too long is a defect and is refused, while quoting a valid field onto a narrower surface is a cut, and
 * this is the cut.
 *
 * @param text the line to fit
 * @param cap the ceiling
 * @returns the text, at or under the cap
 */
export function fitLine({ text, cap }: { text: string; cap: number }): string {
  const trimmed = text.trim();
  if (trimmed.length <= cap) {
    return trimmed;
  }
  const cut = trimmed.slice(0, cap);
  const boundary = cut.lastIndexOf(" ");
  if (boundary <= 0) {
    return cut;
  }
  return cut.slice(0, boundary);
}

/**
 * The banner for one pass of the lane.
 *
 * @param arrived what is new since the last recorded pass, in the order the lane shows it
 * @param outstandingCount how many things are waiting on the owner in total
 * @param noteShown whether the top arrival's own note is on screen after this pass
 * @returns the notice, or the refusal when a line came out past its cap
 */
export function buildPushNotice({
  arrived,
  outstandingCount,
  noteShown,
}: {
  arrived: readonly PushSubject[];
  outstandingCount: number;
  noteShown: boolean;
}): Result<PushNotice, HandStepError> {
  const top = arrived[0];
  if (top === undefined) {
    return err(
      HandStepErrors.invalidField({ field: "arrived", why: "is empty, and a banner with nothing new in it is a nag" }),
    );
  }
  const more = arrived.length - 1;
  const title = more === 0 ? titleFor({ kind: top.kind }) : `${String(arrived.length)} things need your hand`;
  const subtitle = fitLine({ cap: SUBTITLE_CAP, text: top.headline });
  const tail = outstandingCount > arrived.length ? ` · ${String(outstandingCount)} waiting in all` : "";
  const body = `${callFor({ kind: top.kind, noteShown })}${tail}`;
  return checkedNotice({ body, subtitle, title });
}

/**
 * Check every line against its own cap, refusing rather than trimming.
 *
 * @param title the first line
 * @param subtitle the second
 * @param body the third
 * @returns the notice, or the first line that is too long
 */
function checkedNotice({
  title,
  subtitle,
  body,
}: {
  title: string;
  subtitle: string;
  body: string;
}): Result<PushNotice, HandStepError> {
  const lines: readonly { readonly field: string; readonly value: string; readonly cap: number }[] = [
    { cap: TITLE_CAP, field: "title", value: title },
    { cap: SUBTITLE_CAP, field: "subtitle", value: subtitle },
    { cap: BODY_CAP, field: "body", value: body },
  ];
  for (const line of lines) {
    if (line.value.trim().length === 0) {
      return err(HandStepErrors.invalidField({ field: line.field, why: "came out empty" }));
    }
    if (line.value.length > line.cap) {
      return err(
        HandStepErrors.invalidField({
          field: line.field,
          why: `is ${String(line.value.length)} characters and the banner's cap is ${String(line.cap)} — it is refused rather than truncated, because macOS clips a long line silently and the owner reads a sentence that stops`,
        }),
      );
    }
  }
  return ok({ body, subtitle, title });
}
