/**
 * Rapid triage's presses: the desktop shell's menu bar and floating-note buttons, which arrive
 * over `DesktopVoiceSeam.triageClock`, and the pause and end buttons beside the orb, which call the press this returns.
 * Each runs in this window's conversation (`./triageCommandRun.ts`). Absent the shell's link — a browser, the console
 * window, an older shell — only the orb's buttons press.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { TriageClockReport, TriageCommand } from "../../lib/triageBridge";
import type { TriageClockLink } from "./desktopVoiceSeam";
import { runTriageCommand } from "./triageCommandRun";
import type { TriageSeams } from "./triageRun";
import { typeIntoLiveCall } from "./typedInClient";
import { useLatest } from "./useLatest";
import type { TriageClockOut } from "./useTriageWalk";
import type { TypedTalk } from "./useTypedTalkSeat";
import type { ToolLine } from "./voiceContext";

/** No pass running: what the orb draws before the walk's first report. */
const TRIAGE_CLOCK_OFF: TriageClockReport = { on: false };

/** The provider's half of the triage clock: where it goes out, and what the orb draws and rings of it. */
export interface TriageClockHeld {
  /** Handed to the walk (`./useTriageWalk.ts`); stable for the provider's life. */
  readonly clockOut: TriageClockOut;
  /** The clock as last reported, for the orb's buttons. */
  readonly triageClock: TriageClockReport;
  /** The chimes owed so far (`VoiceState.triageDings`). */
  readonly triageDings: number;
  /** Whether a voice call is up now, read at the call. */
  readonly callUpNow: () => boolean;
}

/**
 * Hold the triage clock's report and its chimes. A card running out with a voice call up rings nothing here: the
 * server heralds the call's own time-up line, and two chimes for one card is noise.
 *
 * @param link reads the shell's triage link, `undefined` outside the desktop app's voice window
 * @param callUp whether a voice call is up, here or in the other window, this render
 * @returns the clock's seams and state
 */
export function useTriageClockHeld({
  link,
  callUp,
}: {
  link: () => TriageClockLink | undefined;
  callUp: boolean;
}): TriageClockHeld {
  const [triageClock, setTriageClock] = useState<TriageClockReport>(TRIAGE_CLOCK_OFF);
  const [triageDings, setTriageDings] = useState(0);
  const latest = useLatest({ value: { link } });
  // Copied inside the commit, not after paint as `useLatest` does: a press landing between a call coming up and a
  // passive effect would read no call and run the tool behind the call's back.
  const callUpRef = useRef(callUp);
  useLayoutEffect(() => {
    callUpRef.current = callUp;
  });
  const callUpNow = useCallback((): boolean => callUpRef.current, []);
  const clockOut = useMemo(
    (): TriageClockOut => ({
      ding: () => {
        if (!callUpRef.current) {
          setTriageDings((count) => count + 1);
        }
      },
      link: () => latest.current.link(),
      shown: ({ report }) => {
        setTriageClock(report);
      },
    }),
    [latest],
  );
  return { callUpNow, clockOut, triageClock, triageDings };
}

/**
 * Run the shell's triage presses, and hand back the press the orb's buttons make.
 *
 * @param link the shell's triage link, or `undefined` where there is none
 * @param seams the triage pass and the Queue's cards the tools run over
 * @param typed the typed conversation a start goes to off a call
 * @param voiceCallUp reads whether a voice call is up, in this window or the other
 * @param note writes what each press did in the call's log
 * @returns one press, stable for the provider's life
 */
export function useTriageCommands({
  link,
  seams,
  typed,
  voiceCallUp,
  note,
}: {
  link: TriageClockLink | undefined;
  seams: Pick<TriageSeams, "cards" | "triage">;
  typed: Pick<TypedTalk, "send">;
  voiceCallUp: () => boolean;
  note: (input: { line: ToolLine }) => void;
}): (input: { readonly command: TriageCommand }) => void {
  const latest = useLatest({ value: { note, seams, typed, voiceCallUp } });
  // Made once, reading the render's seams at the press, so the shell's subscription and the orb's buttons keep one.
  const [press] = useState(() => ({ command }: { readonly command: TriageCommand }): void => {
    const pressed = async (): Promise<void> => {
      const now = latest.current;
      const pressedMs = Date.now();
      const ran = await runTriageCommand({
        command,
        seams: {
          seams: now.seams,
          sendTyped: ({ text }) => now.typed.send({ text }),
          typeIntoCall: ({ text }) => typeIntoLiveCall({ messageId: crypto.randomUUID(), pressedMs, text }),
          voiceCallUp: now.voiceCallUp,
        },
      });
      const line: ToolLine = {
        detail: ran.detail,
        ms: Date.now() - pressedMs,
        name: "triage_press",
        refused: ran.refused,
        usage: undefined,
      };
      latest.current.note({ line });
    };
    void pressed();
  });
  useEffect(() => {
    if (link === undefined) {
      return undefined;
    }
    return link.onCommand((command) => {
      press({ command });
    });
  }, [link, press]);
  return press;
}
