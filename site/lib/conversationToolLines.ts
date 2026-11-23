/**
 * What becomes of the tool lines on screen as a conversation opens, spoken or typed.
 *
 * The tool lines are the conversation's own record of what it looked up: the messenger band credits a read off them
 * (`messengerReadsOf`, `./messengerBand.ts`) and the session tray lists them as every lookup this call. A FRESH
 * conversation starts with none, so a thread the last one read is never claimed as read by this one. A CARRYING open
 * keeps them: a voice reconnect or rollover, and a typed conversation re-opened once because the server let its thread
 * go (`useTypedTalk.ts`'s `gone` retry), are the same conversation to the owner.
 *
 * Pure. The state's owner is `site/components/voice/VoiceProvider.tsx`; both opens reach it through
 * `site/components/voice/useConversationOpened.ts`.
 */

/**
 * The tool lines a conversation opening keeps.
 *
 * @param carrying whether this open carries the conversation on rather than starting a new one
 * @param lines the tool lines on screen as it opens, oldest first
 * @returns the lines kept: all of them on a carrying open, none on a fresh one
 */
export function conversationToolLinesOnOpen<Line>({
  carrying,
  lines,
}: {
  carrying: boolean;
  lines: readonly Line[];
}): readonly Line[] {
  if (carrying) {
    return lines;
  }
  return [];
}
