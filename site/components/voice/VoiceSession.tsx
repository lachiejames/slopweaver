"use client";

/**
 * The call's session details tray: what the voice looked up and ran this call, opened from its own button on the
 * card's bar or the stage's bottom bar, above the corner's bar or in the stage's left half — one tray at a time
 * (`site/lib/callTrays.ts`). It is a separate tray that pops out with the extra details, the tool calls, a kind of
 * session viewer, reached from the call rather than the fleet page.
 *
 * It is drawn on the fleet session card's own parts (`../live/SessionTurnView.tsx`), never a copy of them, so it
 * behaves the same: it opens at the bottom and follows it, holds the owner's place
 * once they scroll up, and offers the round button back down — AI Elements' `Conversation` and
 * `ConversationScrollButton`. Each call is a `Tool`, its result folded until the owner opens it.
 * The rows are `site/lib/voiceSessionView.ts`'s; this file only draws them.
 *
 * Under the rows, folded, every relay the call made, the earlier calls' transcripts and the call's plan settings
 * (`CallPlanSettings.tsx`): the record and controls live in the call widget, not on a Talk & voice page. Each is one
 * closed line until the owner opens it, so the tray still leads on what the voice looked up.
 */
import type { DynamicToolUIPart } from "ai";
import type { ReactElement } from "react";

import { CodeBlock } from "@/components/ai-elements/code-block";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Tool, ToolContent, ToolHeader, ToolOutput } from "@/components/ai-elements/tool";

import type { DeviceReading } from "../../lib/audioDevices";
import { messengerStatusWords } from "../../lib/messengerMode";
import { relaySummary } from "../../lib/talkContext";
import {
  shownToolOutputOf,
  type ToolCallShown,
  type VoiceSessionRow,
  type VoiceSessionRowState,
  voiceSessionRows,
} from "../../lib/voiceSessionView";
import { PlainWhy } from "../console/RawFold";
import { StaleMark } from "../console/StaleMark";
import { ReadMark, ReadStandIn } from "../live/LiveMarks";
import { readTalkCalls, type TalkCallRow } from "../live/readTalkCalls";
import { useLive } from "../live/useLive";
import { CallPlanSettings } from "./CallPlanSettings";
import type { RelayLine, RelayReplay, VoiceState } from "./voiceContext";

/** The AI Elements state each row's badge wears: the words a session card shows for the same thing. */
const PART_STATE: Record<VoiceSessionRowState, DynamicToolUIPart["state"]> = {
  done: "output-available",
  refused: "output-error",
  running: "input-available",
};

/**
 * The session tray.
 *
 * @param voice the console voice's state
 * @param onDevices opens the mic and speaker picks, which live in the microphone and speaker tray
 * @returns the tray
 */
export function VoiceSession({ voice, onDevices }: { voice: VoiceState; onDevices: () => void }): ReactElement {
  const rows = voiceSessionRows({ inFlight: voice.inFlight, tools: voice.tools });
  const { status } = voice;
  return (
    <section aria-label="what the voice did this call" className="flex min-h-0 flex-col gap-[0.4rem] py-2">
      <div className="grid gap-[0.15rem] text-[0.72rem] text-muted-foreground [&_p]:m-0">
        <p className="truncate">
          <span className="text-foreground">
            {messengerStatusWords({ headline: status.headline, phase: status.phase, seconds: status.seconds })}
          </span>
          {voice.live === undefined ? null : (
            <span>
              {" "}
              · {voice.live.model} → {voice.live.backendModel}
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {voice.live === undefined ? null : (
            <div className="min-w-0 flex-1">
              <MicLine reading={voice.audio.mic} />
            </div>
          )}
          <button
            type="button"
            className="ml-auto shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[0.72rem] text-primary underline"
            onClick={onDevices}
          >
            mic and speaker
          </button>
        </div>
      </div>
      <Conversation className="min-h-0 flex-1 rounded-md border">
        <ConversationContent className="gap-0 p-2">
          {rows.length === 0 ? (
            <ConversationEmptyState
              title="Nothing looked up yet"
              description="Every lookup the voice makes this call lands here, newest at the bottom."
            />
          ) : (
            rows.map((row) => <SessionRow key={row.key} row={row} />)
          )}
        </ConversationContent>
        <ConversationScrollButton className="bottom-2" />
      </Conversation>
      <Relays relays={voice.relays} />
      <EarlierCalls />
      <details className="shrink-0 text-[0.75rem]">
        <summary className="cursor-pointer text-muted-foreground">call settings: voice, model and plan</summary>
        <div className="max-h-[16rem] overflow-y-auto pt-2">
          <CallPlanSettings voice={voice} />
        </div>
      </details>
    </section>
  );
}

/**
 * Every relay this call attempted, newest last, folded behind a count of how each ended — what the voice passed on,
 * what it heard, and what it read back. The record lives in the widget, not on a Talk & voice page.
 */
function Relays({ relays }: { relays: readonly RelayLine[] }): ReactElement | null {
  if (relays.length === 0) {
    return null;
  }
  return (
    <details className="shrink-0 text-[0.75rem]">
      <summary className="cursor-pointer text-muted-foreground">
        relays: {relaySummary({ outcomes: relays.map((relay) => relay.outcome) })}
      </summary>
      <ol className="mt-2 grid max-h-[12rem] list-none gap-2 overflow-y-auto p-0">
        {relays.map((relay, index) => (
          <li
            key={`${String(index)}:${String(relay.turnId)}`}
            data-outcome={relay.outcome}
            className="rounded-md border border-l-4 border-l-warning px-2 py-1.5 data-[outcome=relayed]:border-l-success"
          >
            <RelayDetail relay={relay} />
            {relay.about === "" ? null : <p className="m-0 text-muted-foreground">about {relay.about}</p>}
            {relay.heard === "" ? null : (
              <blockquote className="my-1 border-l-2 pl-2 text-muted-foreground">{relay.heard}</blockquote>
            )}
            <p className="m-0 text-muted-foreground">the voice's reading: {relay.say}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * The earlier calls as they were written down while they ran (`slopweaver talk calls`), read once on mount and folded
 * behind how many there are, so a call that dropped is still readable after the voice window that held it went away.
 * A dropped one reads "no end recorded".
 */
function EarlierCalls(): ReactElement {
  const state = useLive({ read: readTalkCalls, slug: "talk-calls" });
  if (state.phase !== "ready") {
    return (
      <div className="shrink-0 text-[0.75rem]">
        <ReadStandIn state={state} subject="the earlier calls" />
      </div>
    );
  }
  const { calls, unreadable } = state.value;
  if (calls.length === 0 && unreadable.length === 0) {
    return (
      <p className="m-0 shrink-0 text-[0.75rem] text-muted-foreground">
        No earlier call has been written down yet. <ReadMark state={state} subject="the earlier calls" />
      </p>
    );
  }
  return (
    <details className="sw-tw shrink-0 text-[0.75rem]">
      <summary className="cursor-pointer text-muted-foreground">
        earlier calls: {String(calls.length)} <ReadMark state={state} subject="the earlier calls" />
        {unreadable.length > 0 && (
          <StaleMark facts={unreadable.map((why) => ({ subject: "an earlier call's file", why }))} />
        )}
      </summary>
      <ol className="mt-2 grid max-h-[12rem] list-none gap-2 overflow-y-auto p-0">
        {calls.map((call) => (
          <EarlierCall key={call.callId} call={call} />
        ))}
      </ol>
    </details>
  );
}

/** One earlier call, folded behind when it opened and how it ended; "(cut off)" marks speech the call dropped in. */
function EarlierCall({ call }: { call: TalkCallRow }): ReactElement {
  return (
    <li className="rounded-md border px-2 py-1.5">
      <details>
        <summary className="cursor-pointer">
          <span className="tabular-nums">{call.openedIso}</span> · {call.end}
          {call.relays === 0 ? null : <span className="text-muted-foreground"> · {String(call.relays)} relay(s)</span>}
        </summary>
        <ol className="mt-2 grid list-none gap-1 p-0">
          {call.lines.map((line) => (
            <li key={line.id} className="whitespace-pre-wrap">
              <b>{line.who === "owner" ? "you" : "voice"}:</b> {line.text}
              {line.final ? null : <span className="text-warning"> (cut off)</span>}
            </li>
          ))}
        </ol>
      </details>
    </li>
  );
}

/**
 * The microphone the live call is on, or — warning-coloured — why that is not where the owner would expect it. The warning is
 * our own sentence; a refused switch's caught reason is said plainly under it, the browser's message folded.
 */
function MicLine({ reading }: { reading: DeviceReading }): ReactElement {
  const { warning, warningWhy } = reading;
  let said = reading.words;
  if (warning !== undefined) {
    said = `(${warning})`;
  }
  return (
    <div
      className="text-muted-foreground data-[warning=true]:text-warning"
      data-warning={warning === undefined ? "false" : "true"}
    >
      <p className="truncate">mic {said}</p>
      {warningWhy === undefined ? null : <PlainWhy why={warningWhy} />}
    </div>
  );
}

/** The relay outcomes whose detail is a refusal or a caught message, never one of our own sentences. */
const RELAY_FAILED: ReadonlySet<RelayLine["outcome"]> = new Set(["refused", "unknown"]);

/**
 * A relay's detail: said plainly with its raw message folded when the relay was refused or ended unknown, and as itself
 * otherwise — a sending, delivered or gate-shut line is our own sentence, which the plain reading would only call a
 * technical error (steer 7).
 */
function RelayDetail({ relay }: { relay: RelayLine }): ReactElement {
  // A retry's first refusal, carried apart from the line's own sentence, folded under it whatever the line came to.
  const { firstRefusal } = relay;
  const first = firstRefusal === undefined ? null : <PlainWhy why={firstRefusal} />;
  const replayed = relay.replay === undefined ? null : <ReplayLine replay={relay.replay} />;
  if (RELAY_FAILED.has(relay.outcome)) {
    return (
      <div className="m-0">
        <b>{relay.outcome}</b>: <PlainWhy why={relay.detail} />
        {first}
        {replayed}
      </div>
    );
  }
  return (
    <div className="m-0">
      <b>{relay.outcome}</b>: {relay.detail}
      {first}
      {replayed}
    </div>
  );
}

/** A discuss-first question's relay posted again first: our line for it, and its caught message folded when it threw. */
function ReplayLine({ replay }: { replay: RelayReplay }): ReactElement {
  const { said, why } = replay;
  return (
    <div className="text-muted-foreground">
      {said}
      {why === undefined ? null : <PlainWhy why={why} />}
    </div>
  );
}

/**
 * A tool row's detail: a refused call's reason said plainly with its raw message folded, a finished call's detail as
 * itself, since it reports what the call came to rather than a failure (steer 7).
 */
function SessionDetail({ row }: { row: VoiceSessionRow }): ReactElement | null {
  if (row.detail === "") {
    return null;
  }
  if (row.state === "refused") {
    return (
      <div className="[overflow-wrap:anywhere]">
        <PlainWhy why={row.detail} />
      </div>
    );
  }
  return <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{row.detail}</p>;
}

/**
 * A call's two halves, the way a fleet card draws a Claude Code tool call (`SessionTurnView.tsx`'s `ToolCall`): what it
 * was asked, then what the model was handed back — under "Error" for a refused call, whose answer is its refusal.
 */
function ShownCall({ shown, refused }: { shown: ToolCallShown; refused: boolean }): ReactElement {
  const { errorText, output } = shownToolOutputOf({ output: shown.output, refused });
  return (
    <>
      <CodeBlock code={shown.input} language="json" />
      <ToolOutput errorText={errorText} output={output} />
    </>
  );
}

/** One call: its name and state as the header, what it came to behind the fold, closed until the owner opens it. */
/** The address a read opened: a link, or plain words when it names a page the console no longer has. */
function OpenedLine({ opened, links }: { opened: string; links: boolean }): ReactElement {
  if (!links) {
    return <p className="[overflow-wrap:anywhere]">{opened}</p>;
  }
  return (
    <p className="[overflow-wrap:anywhere]">
      <a href={opened} target="_blank" rel="noreferrer">
        {opened}
      </a>
    </p>
  );
}

function SessionRow({ row }: { row: VoiceSessionRow }): ReactElement {
  let title = row.title;
  if (row.stale) {
    title = `${row.title} · no update`;
  }
  return (
    <Tool className="mb-2" data-stale={row.stale ? "true" : "false"}>
      <ToolHeader
        className="p-2 text-left [&_span]:break-all"
        state={PART_STATE[row.state]}
        title={title}
        toolName={row.title}
        type="dynamic-tool"
      />
      <ToolContent className="grid gap-1 p-2 pt-0 text-[0.78rem] [&_p]:m-0">
        <SessionDetail row={row} />
        {row.shown === undefined ? null : <ShownCall shown={row.shown} refused={row.state === "refused"} />}
        {row.timing === "" ? null : <p className="text-muted-foreground tabular-nums">{row.timing}</p>}
        {row.opened === undefined ? null : <OpenedLine opened={row.opened} links={row.openedLinks} />}
      </ToolContent>
    </Tool>
  );
}
