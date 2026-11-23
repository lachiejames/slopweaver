"use client";

/**
 * What the conversation on now shows of its own work — its tool lines and what the voice is consulting — and the one
 * act that resets them as a conversation opens, shared by a voice call (`VoiceProvider.tsx`'s `openCall`) and a typed
 * conversation (`useTypedTalk.ts`'s `heldOrOpened`), so the two can never disagree on what a fresh one starts without.
 *
 * Every open is a new plan child, so what the last one was consulting is gone either way. A fresh open also drops the
 * tool lines (`site/lib/conversationToolLines.ts`) and the draft-edit card, which does not outlive a conversation
 * (`./draftEditRun.ts`); a carrying open — a reconnect, a rollover, a typed conversation's one `gone` re-open — keeps
 * both, being the same conversation to the owner.
 */
import { type Dispatch, type SetStateAction, useCallback, useState } from "react";

import { conversationToolLinesOnOpen } from "../../lib/conversationToolLines";
import type { Consultation } from "../../lib/voiceStageActivity";
import { clearDraftEdit } from "./draftEditRun";
import type { ToolLine } from "./voiceContext";

/** The conversation's work on screen, its setters, and the act an open calls. */
export interface ConversationWork {
  /** What the voice is consulting now, for the stage's activity line (`site/lib/voiceStageActivity.ts`). */
  readonly consultation: Consultation | undefined;
  readonly setConsultation: Dispatch<SetStateAction<Consultation | undefined>>;
  /** The conversation's tool lines, oldest first: what the messenger band and the session tray read. */
  readonly tools: readonly ToolLine[];
  readonly setTools: Dispatch<SetStateAction<readonly ToolLine[]>>;
  /**
   * Called synchronously as a call or typed conversation opens, before anything it opens can write a tool line:
   * `carrying` for a reconnect, a rollover or a typed `gone` re-open, never for a new conversation.
   */
  readonly conversationOpened: (input: { carrying: boolean }) => void;
}

/**
 * The conversation's work on screen, empty until a conversation writes some.
 *
 * @returns its consultation and tool lines, their setters, and the act an open calls, stable across renders
 */
export function useConversationWork(): ConversationWork {
  const [consultation, setConsultation] = useState<Consultation | undefined>(undefined);
  const [tools, setTools] = useState<readonly ToolLine[]>([]);
  const conversationOpened = useCallback(({ carrying }: { carrying: boolean }): void => {
    setConsultation(undefined);
    // The functional form, so a line the new conversation writes after this is appended to what it kept.
    setTools((lines) => conversationToolLinesOnOpen({ carrying, lines }));
    if (!carrying) {
      clearDraftEdit();
    }
  }, []);
  return { consultation, conversationOpened, setConsultation, setTools, tools };
}
