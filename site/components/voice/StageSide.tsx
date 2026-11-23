"use client";

/**
 * The stage's left column: the orb, what it is doing in words, the activity line, and the notes a call can carry. The
 * voice's layout: the orb on the left and a wider conversation history on the right using the full height, which
 * gives the orb more space to be expressive.
 *
 * **No live caption under the orb.** What is being said now is the foot of the history on the right
 * (`site/lib/voiceTranscript.ts`), and that is where the owner reads it; a caption on the left is clutter, and
 * dropping it leaves more room for the tray.
 *
 * **A tray takes the left half while one is open**: the orb shrinks to a small indicator at the column's top, still the press that moves the call to
 * the corner, and the tray fills the rest; the conversation on the right never moves. **The activity line** names what
 * the voice is consulting (`voiceStageActivity.ts`), compact by default and expandable to the decision a card needs and
 * a larger picture.
 */
import { type ReactElement, useRef } from "react";

import { heldNote } from "../../lib/consoleHold";
import { MOOD_WORDS, type OrbFace } from "../../lib/orbMood";
import type { PresenceId } from "../../lib/orbPresence";
import type { VoiceStatus } from "../../lib/voiceActivity";
import type { OrbBacking, OrbBackingOpacity } from "../../lib/voiceStage";
import { type Consultation } from "../../lib/voiceStageActivity";
import { PlainWhy } from "../console/RawFold";
import { BadgeGlyph, OrbBackdrop } from "./orbParts";
import { StageOrb } from "./StageOrb";
import { useStageOrbFlight } from "./useOrbFlight";
import type { VoiceState } from "./voiceContext";

/** A note in the column's flow: a held navigation, a failure. Never over anything. */
const NOTE = "m-0 rounded-[10px] border border-solid border-border bg-card px-[0.8rem] py-[0.5rem] text-[0.82rem]";

/** The column with no tray: everything centred under the orb, the column's height. */
const COLUMN = "grid min-h-0 content-center justify-items-center gap-[clamp(0.5rem,1.6vh,1.1rem)]";

/**
 * The column with a tray open: the small orb and its words in a row at the top, the activity line under them, and
 * the tray taking the height left, so it scrolls inside itself and never pushes a note off the stage.
 */
const COLUMN_WITH_TRAY = "flex min-h-0 min-w-0 flex-col gap-[clamp(0.5rem,1.6vh,1.1rem)]";

/** The orb at its full size, the column's centre. */
const ORB_FULL = "w-[min(46vh,40vw,30rem)] max-md:w-[min(34vh,70vw)]";

/** The orb as the small indicator above an open tray. */
const ORB_SMALL = "w-[4.5rem]";

/**
 * The left column.
 *
 * @param voice the console voice's state
 * @param face the mood and badge the orb wears
 * @param status the status, already resolved
 * @param presence what fills the orb
 * @param backing what the corner orb sits on, which this orb shows only as it grows out of the corner
 * @param backingOpacity how strongly the owner has that backing drawn, so it leaves the corner at their strength
 * @param consultation what the voice is consulting, when the activity line shows
 * @param previews whether the activity line may draw a picture
 * @param tray the tray open in this column, `null` with none, which leaves the orb its full size
 * @param onCollapse moves to the corner
 * @returns the column
 */
export function StageSide({
  voice,
  face,
  status,
  presence,
  backing,
  backingOpacity,
  consultation,
  previews,
  tray,
  onCollapse,
}: {
  voice: VoiceState;
  face: OrbFace;
  status: VoiceStatus;
  presence: PresenceId;
  backing: OrbBacking;
  backingOpacity: OrbBackingOpacity;
  consultation: Consultation | undefined;
  previews: boolean;
  tray: ReactElement | null;
  onCollapse: () => void;
}): ReactElement {
  let reading = MOOD_WORDS[face.mood];
  if (face.badge !== undefined) {
    reading = MOOD_WORDS[face.badge];
  }
  const said = status.detail;
  const showDetail = said !== undefined && !said.startsWith(status.headline);
  const orbBox = useRef<HTMLButtonElement>(null);
  const flying = useRef<HTMLSpanElement>(null);
  useStageOrbFlight({ box: orbBox, moving: flying });
  let column = COLUMN;
  let orbSize = ORB_FULL;
  if (tray !== null) {
    column = COLUMN_WITH_TRAY;
    orbSize = ORB_SMALL;
  }
  const words = (
    <p className="m-0 flex min-h-[1.6rem] items-center gap-[0.55rem] text-[0.78rem] tracking-[0.14em] text-foreground uppercase">
      {face.badge === undefined ? null : (
        <span aria-hidden="true" className="text-[1rem] tracking-normal">
          <BadgeGlyph badge={face.badge} size="size-[1.05rem]" />
        </span>
      )}
      {reading}
    </p>
  );
  let detail: ReactElement | null = null;
  if (status.why !== undefined) {
    // A session error: its plain line, the raw message folded beneath, so not truncated.
    detail = (
      <div className="m-0 max-w-[34rem] min-w-0 text-[0.82rem] text-muted-foreground">
        <PlainWhy why={status.why} />
      </div>
    );
  } else if (showDetail) {
    detail = <p className="m-0 max-w-[34rem] min-w-0 truncate text-[0.82rem] text-muted-foreground">{said}</p>;
  }
  // Not clipped: the orb flies in from the corner, and the particles flow a little past their box.
  const orb = (
    <button
      ref={orbBox}
      type="button"
      className={`relative aspect-square shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-primary ${orbSize}`}
      aria-label="move the voice to the corner (the call continues)"
      title="move the voice to the corner (the call continues)"
      onClick={onCollapse}
    >
      <span ref={flying} aria-hidden="true" className="pointer-events-none absolute inset-0">
        {/* The corner's disc, seen only as this orb grows out of the corner: at rest the enlarged view has none. */}
        <OrbBackdrop shown={false} pressable={false} backing={backing} opacity={backingOpacity} />
        {/* Refined: at this size a plain lit point grows into a disc (`swarmDetail.ts`). */}
        <StageOrb presence={presence} detail="refined" />
      </span>
    </button>
  );
  // One tree whether or not a tray is open, only its classes changing, so the orb is the same button throughout and
  // its flight measures the box it shrank to: with no tray each wrapper is `contents`, its children the column's own.
  let row = "contents";
  let beside = "contents";
  let under = "-mt-2";
  if (tray !== null) {
    row = "flex min-w-0 items-center gap-[0.9rem]";
    beside = "grid min-w-0 gap-[0.1rem]";
    under = "";
  }
  return (
    <div className={column} data-tray-open={tray === null ? undefined : ""}>
      <div className={row}>
        {orb}
        <div className={beside}>
          {words}
          {detail === null ? null : <div className={under}>{detail}</div>}
        </div>
      </div>
      {consultation === undefined ? null : <ActivityLine consultation={consultation} previews={previews} />}
      {tray === null ? null : <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)]">{tray}</div>}
      {voice.held === undefined ? null : (
        <p className={NOTE}>
          {heldNote({ href: voice.held, origin: window.location.origin })}{" "}
          <button type="button" className="cursor-pointer underline" onClick={voice.stop}>
            hang up and open it
          </button>
        </p>
      )}
      {voice.phase === "error" && voice.failure !== undefined ? (
        <div className={`${NOTE} border-[oklch(0.68_0.18_25)]`}>
          <PlainWhy why={voice.failure} />
        </div>
      ) : null}
    </div>
  );
}

/** The compact line naming what the voice is consulting; it opens to the decision and a larger picture. */
function ActivityLine({ consultation, previews }: { consultation: Consultation; previews: boolean }): ReactElement {
  let picture: string | undefined;
  if (previews) {
    picture = consultation.picture;
  }
  const more = consultation.decision !== undefined || picture !== undefined;
  const line = (
    <span className="flex min-w-0 items-center gap-[0.55rem]">
      {picture === undefined ? (
        <span aria-hidden="true" className="size-[0.45rem] shrink-0 animate-pulse rounded-full bg-(--v-ring)" />
      ) : (
        <img src={picture} alt="" className="h-7 w-11 shrink-0 rounded-[5px] object-cover" />
      )}
      <span className="shrink-0 text-muted-foreground">{consultation.doing}</span>
      {consultation.subject === undefined ? null : <span className="truncate">{consultation.subject}</span>}
    </span>
  );
  const frame =
    "w-full max-w-[34rem] rounded-[10px] border border-solid border-border bg-(--c-card) px-[0.7rem] py-[0.4rem] text-[0.8rem]";
  if (!more) {
    return (
      <p aria-live="polite" className={`m-0 ${frame}`}>
        {line}
      </p>
    );
  }
  return (
    <details className={frame}>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden" aria-live="polite">
        {line}
      </summary>
      <div className="mt-[0.45rem] grid gap-[0.45rem]">
        {consultation.decision === undefined ? null : (
          <p className="m-0 text-[0.82rem] leading-[1.45]">{consultation.decision}</p>
        )}
        {picture === undefined ? null : (
          <img src={picture} alt="what the voice is looking at" className="w-full rounded-[6px]" />
        )}
      </div>
    </details>
  );
}
