/**
 * The top of the voice's stage: what it is doing and on which page, and the way out alone in the corner. Split from
 * `VoiceStage.tsx` to keep it under the line cap.
 */
import type { ReactElement } from "react";

import type { StageRailControl } from "../../lib/stageRail";
import { voiceSeesWords } from "../../lib/talkContext";
import type { VoiceStatus } from "../../lib/voiceActivity";
import { TooltipProvider } from "../ui/tooltip";
import { NUDGE_COPY } from "./orbParts";
import { StageCornerControl } from "./StageControls";
import type { VoiceState } from "./voiceContext";

/**
 * The top of the stage: what it is doing and on which page, and the way out alone in the corner.
 *
 * @returns the header
 */
export function StageHeader({
  voice,
  status,
  preview,
  corner,
  onCollapse,
}: {
  voice: VoiceState;
  status: VoiceStatus;
  preview: string | undefined;
  corner: StageRailControl;
  onCollapse: () => void;
}): ReactElement {
  const sees = voiceSeesWords({ pageTitle: voice.pageTitle, sharing: voice.sharing, sight: voice.screenSight });
  let age = "";
  if (status.seconds !== undefined) {
    age = ` · ${String(status.seconds)}s`;
  }
  let where = sees.label;
  if (preview !== undefined) {
    where = `preview: ${preview}`;
  }
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
      <div className="grid gap-[0.15rem]">
        <p className="m-0 flex items-center gap-[0.5rem] text-[0.95rem]">
          <span aria-hidden="true" className="size-[0.5rem] shrink-0 rounded-full bg-(--v-ring)" />
          <span aria-live="polite">{status.headline}</span>
          <span className="text-muted-foreground tabular-nums">{age}</span>
        </p>
        <p className="m-0 text-[0.78rem] text-muted-foreground" title={sees.detail}>
          {where}
        </p>
        {status.nudge === undefined ? null : (
          <button
            type="button"
            className="cursor-pointer justify-self-start border-0 bg-transparent p-0 text-[0.8rem] text-primary underline"
            title={NUDGE_COPY[status.nudge].title}
            onClick={voice.nudge}
          >
            {NUDGE_COPY[status.nudge].label}
          </button>
        )}
      </div>
      <TooltipProvider>
        <StageCornerControl control={corner} onCollapse={onCollapse} />
      </TooltipProvider>
    </header>
  );
}
