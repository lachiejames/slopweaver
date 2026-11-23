"use client";

/**
 * The notes `VoiceWidget.tsx` draws beside the orb whose content is their own: a meeting the owner is late for, and the triage
 * pass's two buttons. Each takes the widget's frosted note look as `className`, and each carries
 * `data-overlay-interactive`, which is what the desktop shell's overlay hit-tests, as on every drawn piece of the widget.
 */
import type { ReactElement } from "react";

import { type MeetingNotice, meetingBriefingHref } from "../../lib/meetingDue";
import type { TriageClockReport, TriageCommand } from "../../lib/triageBridge";

/**
 * A meeting of the owner's starting now, drawn even with the card open: a meeting the owner is late for outranks the layout. The join
 * link opens in the owner's browser — the overlay hands every outside link to the shell (`desktop/src/main.ts`, `openOutside`)
 * — and the briefing, a console page, opens in the app's viewer in a new tab; it leaves the pill up, since the owner still
 * has to join.
 *
 * @param meeting the meeting the voice cut in about, if any
 * @param dismiss takes the pill down
 * @param className the frosted note's look, the widget's own
 * @returns the pill, or `null` with no meeting due
 */
export function MeetingNote({
  meeting,
  dismiss,
  className,
}: {
  meeting: MeetingNotice | undefined;
  dismiss: () => void;
  className: string;
}): ReactElement | null {
  if (meeting === undefined) {
    return null;
  }
  const briefingHref = meetingBriefingHref({ notice: meeting });
  return (
    <p className={className} data-overlay-interactive="">
      {meeting.title}{" "}
      <a href={meeting.joinUrl} target="_blank" rel="noreferrer" className="font-semibold underline" onClick={dismiss}>
        Join meeting
      </a>{" "}
      {briefingHref === undefined ? null : (
        <>
          <a href={briefingHref} target="_blank" rel="noreferrer" className="font-semibold underline">
            Open briefing
          </a>{" "}
        </>
      )}
      <button type="button" className="cursor-pointer text-muted-foreground underline" onClick={dismiss}>
        dismiss
      </button>
    </p>
  );
}

/**
 * While a triage pass runs, the owner's two clicks in place of words: pause or resume the
 * card clock, and end triage. Nothing is drawn while triage is off, and the countdown itself is beside the menu
 * bar item, never here.
 *
 * @param clock where the pass and its clock stand
 * @param press runs one command against the pass
 * @param className the frosted note's look, the widget's own
 * @returns the note, or `null` while triage is off
 */
export function TriageNote({
  clock,
  press,
  className,
}: {
  clock: TriageClockReport;
  press: (input: { readonly command: TriageCommand }) => void;
  className: string;
}): ReactElement | null {
  if (!clock.on) {
    return null;
  }
  const paused = clock.phase === "paused";
  return (
    <p className={className} data-overlay-interactive="" aria-label="triage">
      Triage{" "}
      <button
        type="button"
        className="cursor-pointer font-semibold underline"
        onClick={() => {
          press({ command: paused ? "resume" : "pause" });
        }}
      >
        {paused ? "Resume timer" : "Pause timer"}
      </button>{" "}
      <button
        type="button"
        className="cursor-pointer text-muted-foreground underline"
        onClick={() => {
          press({ command: "off" });
        }}
      >
        Turn triage off
      </button>
    </p>
  );
}
