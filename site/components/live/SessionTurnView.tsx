"use client";

import type { DynamicToolUIPart, UIMessage } from "ai";
import { ChevronDownIcon, WrenchIcon } from "lucide-react";
import { type ReactElement, type ReactNode, useState } from "react";

import { CodeBlock } from "@/components/ai-elements/code-block";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader, ToolOutput } from "@/components/ai-elements/tool";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { partOffsetOf, turnMessages } from "@/lib/sessionTurn";
import {
  adoptRuns,
  callOpen,
  type FoldChoice,
  type Folds,
  groupTurnParts,
  NO_FOLDS,
  pressFolds,
  runOpen,
  type ToolGroupRow,
} from "@/lib/toolGroup";

import { ReadingIndicator } from "../console/ReadingIndicator";
import { StaleMark } from "../console/StaleMark";
import { type SessionTurnViewState, useSessionTurn } from "./SessionTurnViewRead";
import { EarlierTurns, TurnStamp } from "./SessionTurnViewStamp";
import { SLIDE_ASIDE_STICKY, SLIDE_BODY_SESSION } from "./SlideOver";

export type { SessionTurnViewState } from "./SessionTurnViewRead";

/**
 * How many turns the view opens on: the latest and the one before it. One turn is far too
 * little to read a session by, and the owner wants to read these views instead of the cmux pane.
 */
const OPENING_TURNS = 2;

/**
 * One tool call: its name and state as the header, its input and result behind the fold. Whether the fold is
 * open is its run's to decide ({@link ToolGroup}), so a reader's press survives the run growing around it.
 *
 * @returns the call
 */
function ToolCall({
  part,
  open,
  onOpenChange,
}: {
  part: DynamicToolUIPart;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}): ReactElement {
  const cut = part.toolMetadata?.["truncated"] === true;
  const input = typeof part.input === "string" ? part.input : "";
  return (
    <Tool onOpenChange={onOpenChange} open={open}>
      <ToolHeader
        state={part.state}
        title={cut ? `${part.toolName} (cut to its cap)` : part.toolName}
        toolName={part.toolName}
        type="dynamic-tool"
      />
      <ToolContent>
        <CodeBlock code={input} language="json" />
        <ToolOutput errorText={part.errorText} output={part.output} />
      </ToolContent>
    </Tool>
  );
}

/** The two presses a fold can report, each naming what it was made on. */
interface FoldPresses {
  /**
   * A press on one call. `wholeRun` says the call is its run's only one, so the press is on the run as well: a
   * call joining it later must find that press, not an older one on the run.
   */
  readonly onCall: (press: {
    readonly callId: string;
    readonly choice: FoldChoice;
    readonly wholeRun: boolean;
  }) => void;
  readonly onRun: (press: { readonly callIds: readonly string[]; readonly choice: FoldChoice }) => void;
}

/**
 * A run of tool calls as one row: what the run did in a line, and its calls behind the fold in the order the
 * session made them. A run of one call is drawn as that call alone; when a second call joins it on a later
 * read, the call the reader opened stays open and so does the run around it; a run the part budget cuts back to
 * one call is drawn as that call, which the reader's newer press — on it or on the run — still decides, and a
 * press on a run's only call is a press on the run, so a call joining it later cannot revive an older one. A
 * failed call, and the run holding it, open themselves and reopen for a failure the reader has not yet seen
 * ({@link foldOpen}).
 *
 * @returns the row
 */
function ToolGroup({
  group,
  folds,
  presses,
}: {
  group: ToolGroupRow;
  folds: Folds;
  presses: FoldPresses;
}): ReactElement {
  const failedIds = group.failed.map((tool) => tool.toolCallId);
  const call = ({ tool, wholeRun }: { tool: DynamicToolUIPart; wholeRun: boolean }): ReactElement => {
    const failed = tool.state === "output-error" ? [tool.toolCallId] : [];
    return (
      <ToolCall
        key={tool.toolCallId}
        onOpenChange={(next) => {
          presses.onCall({ callId: tool.toolCallId, choice: { open: next, seen: new Set(failed) }, wholeRun });
        }}
        open={callOpen({ folds, tool, wholeRun })}
        part={tool}
      />
    );
  };
  if (group.tools.length === 1) {
    return call({ tool: group.tools[0], wholeRun: true });
  }
  const open = runOpen({ folds, group });
  const status: string[] = [];
  if (group.running > 0) {
    status.push(`${String(group.running)} running`);
  }
  if (failedIds.length > 0) {
    status.push(`${String(failedIds.length)} failed`);
  }
  return (
    <div className="not-prose mb-4 w-full" role="group" aria-label="Tool activity">
      <Collapsible
        className="group/tools rounded-md border"
        onOpenChange={(next) => {
          presses.onRun({
            callIds: group.tools.map((tool) => tool.toolCallId),
            choice: { open: next, seen: new Set(failedIds) },
          });
        }}
        open={open}
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 p-3 text-left">
          <span className="flex items-center gap-2 text-sm">
            <WrenchIcon className={group.running > 0 ? "size-4 animate-pulse" : "size-4 text-muted-foreground"} />
            <span className="font-medium">{group.summary}</span>
            {status.length > 0 && <span className="text-muted-foreground text-xs">{status.join(" · ")}</span>}
          </span>
          <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]/tools:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 px-3 pb-1">
          {group.tools.map((tool) => call({ tool, wholeRun: false }))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/**
 * One message's parts, in order, each run of tool calls folded into one group and each part keyed by its
 * position in the whole turn.
 *
 * @returns the message
 */
function TurnMessage({
  message,
  folds,
  presses,
}: {
  message: UIMessage;
  folds: Folds;
  presses: FoldPresses;
}): ReactElement {
  return (
    <Message from={message.role}>
      <MessageContent>
        {groupTurnParts({ offset: partOffsetOf({ message }), parts: message.parts }).map((row) => {
          const key = `${message.id}:${row.key}`;
          if (row.kind === "tool-group") {
            return <ToolGroup key={key} folds={folds} group={row} presses={presses} />;
          }
          const { part } = row;
          if (part.type === "text") {
            return <MessageResponse key={key}>{part.text}</MessageResponse>;
          }
          if (part.type === "reasoning") {
            return (
              <Reasoning key={key} defaultOpen={false}>
                <ReasoningTrigger />
                <ReasoningContent>{part.text}</ReasoningContent>
              </Reasoning>
            );
          }
          return null;
        })}
      </MessageContent>
    </Message>
  );
}

/**
 * Every run of tool calls the messages draw, as its calls' ids.
 *
 * @returns one list of call ids per run, in session order
 */
function runsOf({ messages }: { messages: readonly UIMessage[] }): string[][] {
  return messages.flatMap((message) =>
    groupTurnParts({ offset: partOffsetOf({ message }), parts: message.parts }).flatMap((row) =>
      row.kind === "tool-group" ? [row.tools.map((tool) => tool.toolCallId)] : [],
    ),
  );
}

/**
 * One session's latest turn, read once and drawn with AI Elements, with an optional column of facts beside it drawn
 * off the SAME read — so a goal shown beside a transcript can never come from a different one.
 *
 * @param id the agent CLI's session id
 * @param renderSidebar draws the column beside the transcript, given the read's state; absent, the transcript stands
 *   alone as the full-page `/fleet/session/[id]` view draws it
 * @returns the view
 */
export function SessionTurnView({
  id,
  renderSidebar,
}: {
  id: string;
  renderSidebar?: (options: { readonly state: SessionTurnViewState }) => ReactNode;
}): ReactElement {
  const [turns, setTurns] = useState(OPENING_TURNS);
  const state = useSessionTurn({ id, turns });
  const transcript = <TurnTranscript onMore={setTurns} state={state} turns={turns} />;
  if (renderSidebar === undefined) {
    return transcript;
  }
  return (
    <div className={SLIDE_BODY_SESSION}>
      <div className="min-w-0">{transcript}</div>
      <aside className={SLIDE_ASIDE_STICKY} aria-label="session properties">
        {renderSidebar({ state })}
      </aside>
    </div>
  );
}

/**
 * The transcript itself. Each read copies every run's newest press onto the calls it now holds ({@link adoptRuns}),
 * adjusting the held folds during render so the read is never drawn with a press its surviving calls cannot see.
 *
 * @returns the transcript, or a spinner while it loads, or a staleness mark whose hover says why it could not be read
 */
function TurnTranscript({
  state,
  turns,
  onMore,
}: {
  state: SessionTurnViewState;
  turns: number;
  onMore: (next: number) => void;
}): ReactElement {
  const [folds, setFolds] = useState<Folds>(NO_FOLDS);
  const presses: FoldPresses = {
    onCall: ({ callId, choice, wholeRun }) => {
      setFolds((held) => pressFolds({ calls: [callId], choice, folds: held, runs: wholeRun ? [callId] : [] }));
    },
    onRun: ({ callIds, choice }) => {
      setFolds((held) => pressFolds({ calls: [], choice, folds: held, runs: callIds }));
    },
  };
  if (state.phase === "loading") {
    return <ReadingIndicator label="Reading the session's latest turn" block />;
  }
  if (state.phase === "not-measured") {
    return <StaleMark facts={[{ subject: "The session's transcript", why: state.why }]} block />;
  }
  const messages = turnMessages({ turn: state.turn });
  const drawn = adoptRuns({ folds, runs: runsOf({ messages }) });
  if (drawn !== folds) {
    setFolds(drawn);
  }
  return (
    <section className="flex h-[calc(100vh-12rem)] flex-col gap-2">
      <TurnStamp observedAtIso={state.observedAtIso} stale={state.stale} turn={state.turn} />
      <EarlierTurns onMore={onMore} turn={state.turn} turns={turns} />
      <Conversation className="min-h-0 flex-1 rounded-md border">
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState description="the transcript read holds no turn yet" title="Nothing to show" />
          )}
          {messages.map((message) => (
            <TurnMessage folds={drawn} key={message.id} message={message} presses={presses} />
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </section>
  );
}
