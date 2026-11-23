"use client";

import type { ReactElement } from "react";

import type { LiveMachineHeld } from "../../lib/liveMachineClient";
import { type LiveMachineView, liveMachineViewOf, type MeterView } from "../../lib/liveMachineView";
import { cn } from "../../lib/utils";
import type { WorkingSessionCard } from "../../lib/workingSessions";
import { useNow } from "../console/QueueSections";
import { ReadingIndicator } from "../console/ReadingIndicator";
import { StaleMark } from "../console/StaleMark";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "../ui/card";
import { FLEET_SWATCH, OTHER_SWATCH } from "./MachineChartsFrame";
import { useLiveMachine } from "./useLiveMachine";

/** The stamp re-ages every second, so "read 2s ago" counts up between reads rather than jumping. */
const AGE_TICK_MS = 1_000;

/** The stamp's dot and words by how fresh the reading is. */
const FRESHNESS_TONE: Readonly<Record<LiveMachineView["freshness"]["tone"], { dot: string; words: string }>> = {
  amber: { dot: "bg-warning", words: "text-warning" },
  live: { dot: "bg-success", words: "text-muted-foreground" },
  stopped: { dot: "bg-destructive", words: "text-destructive" },
};

/** The verdict line's ground by what it says. */
const VERDICT_TONE: Readonly<Record<LiveMachineView["verdict"]["tone"], string>> = {
  held: "border-warning/40 bg-warning/10",
  room: "border-success/40 bg-success/10",
  unread: "border-border bg-muted",
};

/**
 * One meter: its figure out of its total, the bar, and the line under it.
 *
 * @returns the meter
 */
function Meter({ meter }: { meter: MeterView }): ReactElement {
  return (
    <div className="rounded-[10px] border border-border bg-muted/40 px-3 py-2" data-live-meter={meter.label}>
      <div className="text-[0.72rem] tracking-wide text-muted-foreground uppercase">{meter.label}</div>
      <div className="text-[1.4rem] leading-tight font-bold tabular-nums">
        {meter.value} <small className="text-[0.82rem] font-medium text-muted-foreground">{meter.of}</small>
      </div>
      {meter.segments.length > 0 && (
        <div className="mt-1.5 flex h-[0.55rem] overflow-hidden rounded-full bg-muted" aria-hidden="true">
          {meter.segments.map((segment) => (
            <i
              key={segment.tone}
              className={cn("block h-full", segment.tone === "fleet" ? FLEET_SWATCH : OTHER_SWATCH)}
              style={{ width: `${String(segment.pct)}%` }}
            />
          ))}
        </div>
      )}
      <div className="mt-1 text-[0.76rem] text-muted-foreground">{meter.detail}</div>
    </div>
  );
}

/**
 * The live sessions, heaviest first: each titled from the working session card whose transcript it is, and opening
 * that card's panel; a session no card names says its title was not read, never a guess.
 *
 * @returns the table
 */
function SessionTable({
  view,
  cards,
  onOpen,
}: {
  view: LiveMachineView;
  cards: readonly WorkingSessionCard[];
  onOpen: (card: WorkingSessionCard) => void;
}): ReactElement | null {
  if (view.rows.length === 0) {
    return null;
  }
  return (
    <div className="rounded-[10px] border border-border px-3 py-2" data-live-sessions="">
      <table className="w-full text-[0.84rem] tabular-nums">
        <thead>
          <tr className="text-left text-[0.72rem] text-muted-foreground">
            <th className="py-1 font-medium">Session</th>
            <th className="w-[7rem] py-1 font-medium">CPU</th>
            <th className="w-[7rem] py-1 font-medium">Memory</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => {
            const card = cards.find((each) => each.transcriptId === row.sessionId);
            return (
              <tr key={row.sessionId} className="border-t border-border/60" data-live-session={row.sessionId}>
                <td className="py-1">
                  {card === undefined && <span className="text-muted-foreground">title not read</span>}
                  {card !== undefined && (
                    <button
                      type="button"
                      className="cursor-pointer bg-transparent p-0 text-left text-foreground hover:underline"
                      onClick={() => {
                        onOpen(card);
                      }}
                    >
                      {card.title}
                    </button>
                  )}
                </td>
                <td className="py-1">{row.cpu}</td>
                <td className="py-1">{row.memory}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {view.more > 0 && <p className="m-0 mt-1 text-[0.76rem] text-muted-foreground">and {String(view.more)} more</p>}
    </div>
  );
}

/**
 * The block's body once a reading is held, or what stands in its place before one is.
 *
 * @returns the body
 */
function LiveMachineBody({
  held,
  view,
  cards,
  onOpen,
}: {
  held: LiveMachineHeld;
  view: LiveMachineView | undefined;
  cards: readonly WorkingSessionCard[];
  onOpen: (card: WorkingSessionCard) => void;
}): ReactElement {
  if (view === undefined && held.why !== undefined) {
    return <StaleMark facts={[{ subject: "the live machine reading", why: held.why }]} block />;
  }
  if (view === undefined) {
    return <ReadingIndicator label="Reading the machine" block />;
  }
  return (
    <section aria-label="The machine, live" className="grid gap-[0.6rem]" data-live-machine="">
      <p
        className={cn(
          "m-0 rounded-[8px] border px-3 py-2 text-[0.9rem] font-semibold",
          VERDICT_TONE[view.verdict.tone],
        )}
        data-live-verdict={view.verdict.tone}
      >
        {view.verdict.words}{" "}
        <span className="text-[0.76rem] font-normal text-muted-foreground">judged on the reading above</span>
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {view.meters.map((meter) => (
          <Meter key={meter.label} meter={meter} />
        ))}
      </div>
      <SessionTable cards={cards} onOpen={onOpen} view={view} />
    </section>
  );
}

/**
 * The Fleet page's live machine tile: how old the reading is, in its header, then the machine's verdict judged on it,
 * CPU, memory, load and live sessions each out of their total, and the live sessions heaviest first. Read every two
 * seconds by this console's own server (`site/lib/liveMachineRead.ts`) while the tile is mounted and the tab visible.
 *
 * @param cards the working session cards, which title a live session by its transcript id
 * @param onOpen opens a card's session panel
 * @returns the tile
 */
export function LiveMachine({
  cards,
  onOpen,
}: {
  cards: readonly WorkingSessionCard[];
  onOpen: (card: WorkingSessionCard) => void;
}): ReactElement {
  const held = useLiveMachine();
  const nowMs = useNow({ everyMs: AGE_TICK_MS });
  const view = liveMachineViewOf({ held, nowMs });
  return (
    <Card className="gap-3 rounded-[12px] border-solid border-border px-[1.1rem] pt-4 pb-[0.85rem] shadow-none">
      <CardHeader className="items-baseline gap-x-3 gap-y-0 px-0">
        <CardTitle>
          <h3 className="m-0 text-[0.95rem] leading-[1.5] font-bold tracking-[-0.01em]">Machine</h3>
        </CardTitle>
        <CardAction className="row-span-1 self-baseline text-right text-[0.72rem]">
          {view !== undefined && (
            <span
              className={cn("inline-flex items-center gap-1.5", FRESHNESS_TONE[view.freshness.tone].words)}
              data-live-freshness={view.freshness.tone}
            >
              <span
                className={cn("inline-block size-2 rounded-full", FRESHNESS_TONE[view.freshness.tone].dot)}
                aria-hidden="true"
              />
              {view.freshness.words}
            </span>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <LiveMachineBody cards={cards} held={held} onOpen={onOpen} view={view} />
      </CardContent>
    </Card>
  );
}
