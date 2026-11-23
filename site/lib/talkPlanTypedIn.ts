/**
 * The owner's typed turn during a live call: what they paste or type into the Messenger box mid-call reaches the voice as their
 * own `user` text, never wrapped in a server line. The owner pastes a Slack thread link into the box often, so it needs
 * a way to be sent. `PlanCall.typeIn` (`./talkPlanCall.ts`) hands each one to {@link TypedInTurns}, which holds
 * the turn's state and order; its own file so the call stays under the line cap.
 *
 * Whether a `user` `thread/realtime/appendText` makes the voice answer on its own is the session's to show, so the
 * call watches `PLAN_CALL_LIMITS.typedInKickMs` (`./planCallContract.ts`): the voice speaking a WORD or a Codex turn
 * starting is the answer under way, and only silence gets {@link TYPED_IN_KICK_TEXT}, a `developer` line that quotes
 * none of the owner's words — their text stays at `user` priority, where their spoken words are.
 *
 * A file the owner attached (`./messengerAttachment.ts`'s `[Attached: …]` line) is owed, whatever the voice said, until a
 * `file_read` of its own path arrives or the session takes one {@link TYPED_IN_ATTACHMENT_KICK_TEXT} for it. A
 * wordless "." from the voice is not an answer, or the kick never goes and nothing reads the file.
 */
import { PLAN_CALL_LIMITS, type PlanTypedInOutcome } from "./planCallContract";
import { fateOf, type RpcOutcome } from "./talkPlanProtocol";
import type { CallClock } from "./talkPlanStart";

/**
 * What the voice reads when the owner's typed turn met silence: answer it, read a Slack link through the door, and read a file
 * they attached (`./messengerAttachment.ts`) with `file_read`.
 */
export const TYPED_IN_KICK_TEXT =
  "The owner just typed the user message above into the console during this call. Answer it now as their turn. If it " +
  "carries a Slack message link, hand it to the thinking model to read the whole thread with slack_open, then say " +
  "what it says; never ask them to say or paste the link again. If it carries an [Attached: …] line, hand it to the " +
  "thinking model to read that file with file_read, then answer from what it holds.";

/** What the voice reads when a file the owner attached had not been read by the window's end, whatever it said meanwhile. */
export const TYPED_IN_ATTACHMENT_KICK_TEXT =
  "The owner attached a file in the user message above and it has not been read yet. Hand it to the thinking model to " +
  "read that exact path with file_read now, then answer from what it holds; never ask them to send it again.";

/**
 * One attachment line as `messengerAttachmentLine` (`./messengerAttachment.ts`) writes it: the name and the path are
 * each a JSON string literal, and the path is captured whole, quotes included.
 */
const ATTACHMENT_LINE =
  /\[Attached: "(?:[^"\\]|\\.)*", [^"\]]*, saved at ("(?:[^"\\]|\\.)*")\. Read it with file_read\.\]/gu;

/**
 * Parse a JSON value, `undefined` when it is not JSON.
 *
 * @param text the JSON text, one line or one tool call's arguments
 * @returns the value, or `undefined`
 */
function parsedJson({ text }: { text: string }): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The path of each file one typed message attached, in order.
 *
 * @param text the owner's typed words
 * @returns every attachment line's saved path, none in words that only mention attaching
 */
export function attachmentPathsOf({ text }: { text: string }): readonly string[] {
  return [...text.matchAll(ATTACHMENT_LINE)].flatMap((match) => {
    const quoted = match.at(1);
    if (quoted === undefined) {
      return [];
    }
    const path = parsedJson({ text: quoted });
    return typeof path === "string" ? [path] : [];
  });
}

/**
 * The path a `file_read` call asked for.
 *
 * @param args the call's arguments, as the JSON string the page's executor parses
 * @returns its `path`, or `undefined` when it carries none
 */
export function fileReadPathOf({ args }: { args: string }): string | undefined {
  const parsed = parsedJson({ text: args });
  if (typeof parsed !== "object" || parsed === null || !("path" in parsed)) {
    return undefined;
  }
  const path: unknown = parsed.path;
  return typeof path === "string" ? path : undefined;
}

/**
 * Whether a voice transcript carries a word: a letter or a digit in any script. A bare "." or a breath is not an
 * answer to anything.
 *
 * @param text the transcript's text or delta, absent when the event carried none
 * @returns `true` when it holds at least one letter or digit
 */
export function voiceWorded({ text }: { text: string | undefined }): boolean {
  return text !== undefined && /[\p{L}\p{N}]/u.test(text);
}

/**
 * Whether the owner's typed turn still needs the kick once `PLAN_CALL_LIMITS.typedInKickMs` has passed: the call is up and
 * an attachment they sent is still unread, or neither a worded voice line nor a Codex turn has moved since the session
 * took it. An unread attachment is due even while a Codex turn runs: the window is the only retry it gets.
 *
 * @param takenMs when the session took the owner's turn
 * @param ended the call has ended
 * @param voiceWordAtMs when the voice last said a word
 * @param runningTurns Codex turns running now
 * @param turnEndedAtMs when a Codex turn last ended
 * @param unreadAttachments files the owner attached that no `file_read` has answered yet
 * @returns `true` when the voice must be told to answer the owner
 */
export function typedInKickDue({
  takenMs,
  ended,
  voiceWordAtMs,
  runningTurns,
  turnEndedAtMs,
  unreadAttachments,
}: {
  takenMs: number;
  ended: boolean;
  voiceWordAtMs: number | undefined;
  runningTurns: number;
  turnEndedAtMs: number | undefined;
  unreadAttachments: number;
}): boolean {
  if (ended) {
    return false;
  }
  if (unreadAttachments > 0) {
    return true;
  }
  if (runningTurns > 0) {
    return false;
  }
  // Strictly after: in the owner's words' own millisecond the voice cannot have answered them yet.
  const spoke = voiceWordAtMs !== undefined && voiceWordAtMs > takenMs;
  const worked = turnEndedAtMs !== undefined && turnEndedAtMs > takenMs;
  return !spoke && !worked;
}

/** What {@link TypedInTurns} needs of the call it serves. */
export interface TypedInCall {
  readonly clock: CallClock;
  /** Why another of the call's own writes holds the owner's turn off, judged with `writing` as the owner's own write in flight. */
  readonly refusal: (input: { writing: boolean }) => string | undefined;
  /** Writes the owner's words into the session as `user` text. */
  readonly append: (input: { text: string }) => Promise<RpcOutcome>;
  /** The session took it, or may have: stamp the floor and stream the `typed-in` event. */
  readonly taken: (input: { messageId: string; text: string; takenMs: number }) => void;
  /** The call's state at the window's end, for {@link typedInKickDue}. */
  readonly moved: () => {
    ended: boolean;
    runningTurns: number;
    turnEndedAtMs: number | undefined;
  };
  /**
   * Hands the voice a developer line, naming why for the call's provenance, answering why not when the session did not
   * take it.
   */
  readonly kick: (input: { text: string; why: string }) => Promise<string | undefined>;
  /** Says a kick the session would not take. */
  readonly failed: (input: { message: string }) => void;
}

/**
 * One call's typed turns: each message id handed over once, claimed before the write since one that timed out may
 * still have landed; the owner's next message held only while one is being written; and each taken turn's kick window,
 * which a later message replaces, so the voice is kicked once, at the end of the newest.
 */
export class TypedInTurns {
  private readonly call: TypedInCall;
  /** Each message id claimed, with its one write. */
  private readonly claimed = new Map<string, Promise<PlanTypedInOutcome>>();
  /** Each message id already streamed back as the owner's turn. */
  private readonly streamed = new Set<string>();
  /** The owner's message being written now, if one is. */
  private writing: { readonly messageId: string; readonly text: string } | undefined = undefined;
  /** A window's kick is being written now. */
  private kicking = false;
  private windows = 0;
  private waiting: number | undefined = undefined;
  /** The write {@link TypedInTurns.take} has out, which a window ending meanwhile waits on. */
  private inFlight: Promise<PlanTypedInOutcome> | undefined = undefined;
  /** When the voice last said a word, never a wordless line. */
  private voiceWordAtMs: number | undefined = undefined;
  /**
   * The path of each file the owner attached that neither a `file_read` of it nor a taken attachment kick has answered; it
   * outlives a replaced window.
   */
  private readonly unreadPaths: string[] = [];
  /**
   * Each `file_read` path that arrived while the owner's message was still being written and answered nothing owed yet: the
   * session can read the attachment before the append's reply lands, so the write settles them once its paths are owed.
   */
  private readonly readWhileWriting: string[] = [];

  /**
   * Serve one call.
   *
   * @param call what the turns need of it
   */
  constructor({ call }: { call: TypedInCall }) {
    this.call = call;
  }

  /**
   * Whether the owner's typed turn holds the call's floor: one is being written, or its kick window runs.
   *
   * @returns `true` while no line of the call's own may go in between the owner's words and the voice's answer
   */
  holding(): boolean {
    return this.writing !== undefined || this.waiting !== undefined;
  }

  /**
   * The call is ending: a message still being written may already be in the voice's context, so it streams back as the owner's
   * turn now, before the call's close, which is the last thing a page reads of it. Its write then settles `unsure`.
   */
  stop(): void {
    if (this.writing !== undefined) {
      this.stream({ ...this.writing, takenMs: this.call.clock.nowMs() });
    }
  }

  /**
   * The voice is calling a tool while the owner's message is still being written: it may be acting on their words already, so
   * they stream back as the owner's turn now, before the page runs the call. Without this the page could judge the call on a
   * record that lacks them — a menu bar "It's triage time." refused as no ask because the session's tool call beat
   * the append's reply. The write still settles as it would have; the owner's turn streams once.
   * A `file_read` of exactly an attachment's saved path answers it; a read of any other file answers none.
   * The path is matched as written, so the same file spelt another way kicks once more, never less.
   *
   * @param tool the dynamic tool the session called
   * @param args its arguments, as the JSON string the page's executor parses
   */
  toolCallArrived({ tool, args }: { tool: string; args: string }): void {
    if (this.writing !== undefined) {
      this.stream({ ...this.writing, takenMs: this.call.clock.nowMs() });
    }
    if (tool !== "file_read") {
      return;
    }
    const path = fileReadPathOf({ args });
    if (path === undefined) {
      return;
    }
    const unmatched = this.settle({ paths: [path] });
    if (this.writing !== undefined) {
      this.readWhileWriting.push(...unmatched);
    }
  }

  /**
   * Settle owed attachments: each path given answers one owed entry of exactly that path, if one is still owed.
   *
   * @param paths the paths read, or covered by a kick the session took
   * @returns each path given that answered nothing owed
   */
  private settle({ paths }: { paths: readonly string[] }): readonly string[] {
    const unmatched: string[] = [];
    for (const path of paths) {
      const at = this.unreadPaths.indexOf(path);
      if (at >= 0) {
        this.unreadPaths.splice(at, 1);
      } else {
        unmatched.push(path);
      }
    }
    return unmatched;
  }

  /**
   * The voice was transcribed: a line carrying a word stamps when it last spoke, a wordless one ("." alone) does not.
   *
   * @param text the transcript's text or delta, absent when the event carried none
   */
  voiceTranscribed({ text }: { text: string | undefined }): void {
    if (voiceWorded({ text })) {
      this.voiceWordAtMs = this.call.clock.nowMs();
    }
  }

  /**
   * Stream one message back as the owner's turn, once per message id, however many of the write's endings reach it.
   *
   * @param messageId the page's id for the message
   * @param text the owner's words
   * @param takenMs when the session took it, or may have
   */
  private stream({ messageId, text, takenMs }: { messageId: string; text: string; takenMs: number }): void {
    if (this.streamed.has(messageId)) {
      return;
    }
    this.streamed.add(messageId);
    this.call.taken({ messageId, takenMs, text });
  }

  /**
   * Hand one message to the voice.
   *
   * @param messageId the page's id for the message, which is handed over once
   * @param text the owner's words, already bounded by the route
   * @returns whether the session took it now, had already, or why not — `unsure` when it may have; a retry is told
   *   what the first write came to
   */
  async take({ messageId, text }: { messageId: string; text: string }): Promise<PlanTypedInOutcome> {
    const earlier = this.claimed.get(messageId);
    if (earlier !== undefined) {
      // A retry is never written again, and is told what the first write came to: `already` only once it landed, so
      // a page never reads a write that failed, or may not have landed, as one that did.
      const first = await earlier;
      return first.kind === "sent" ? { kind: "already" } : first;
    }
    // The owner's own write out, or a kick's, holds the owner's next message off; a running window alone does not.
    const refusal = this.call.refusal({ writing: this.writing !== undefined || this.kicking });
    if (refusal !== undefined) {
      return { kind: "refused", reason: refusal };
    }
    this.writing = { messageId, text };
    const handing = this.hand({ messageId, text });
    this.claimed.set(messageId, handing);
    this.inFlight = handing;
    return handing;
  }

  /**
   * Write one claimed message and settle what it leaves: the owner's turn streamed back when it may have landed, and a new
   * kick window, superseding any running, when it did.
   *
   * @param messageId the page's id for the message
   * @param text the owner's words
   * @returns what {@link TypedInTurns.take} answers
   */
  private async hand({ messageId, text }: { messageId: string; text: string }): Promise<PlanTypedInOutcome> {
    let handed: RpcOutcome;
    const earlyReads: string[] = [];
    try {
      handed = await this.call.append({ text });
    } finally {
      // A write that threw frees the floor too, or every later line of the call's would wait on it. Its
      // early reads go with it, so they never answer a later attachment at the same path.
      this.writing = undefined;
      earlyReads.push(...this.readWhileWriting.splice(0));
    }
    if (handed.kind === "timeout") {
      // Unanswered is not unwritten: it may be in the voice's context, so the holding window takes it as the owner's turn,
      // once. It opens no kick window of its own: alone, a line telling the voice to answer "the message above" may
      // point at nothing. An earlier message's window still running keeps its kick, which now points at the newest
      // message there is, and asks only that the voice answer the owner.
      this.stream({ messageId, takenMs: this.call.clock.nowMs(), text });
    }
    if (handed.kind !== "result") {
      const reason = `the voice was not handed the owner's message: ${fateOf({ outcome: handed })}`;
      return handed.kind === "error" ? { kind: "failed", reason } : { kind: "unsure", reason };
    }
    const takenMs = this.call.clock.nowMs();
    // Only a write that landed owes a read: a refused, failed or unanswered one leaves no phantom attachment.
    this.unreadPaths.push(...attachmentPathsOf({ text }));
    this.settle({ paths: earlyReads });
    this.windows += 1;
    const window = this.windows;
    this.waiting = window;
    this.stream({ messageId, takenMs, text });
    this.call.clock.after({ ms: PLAN_CALL_LIMITS.typedInKickMs, run: () => void this.windowEnds({ takenMs, window }) });
    return { kind: "sent" };
  }

  /**
   * A kick window's end: the floor is free again, and the voice is handed {@link TYPED_IN_KICK_TEXT} when nothing
   * answered the owner's turn. A window a later message replaced does nothing; that message's own window ends it. One ending
   * while a later message is still being written waits for that write first: the kick would land after the owner's newer
   * words, and once they land their window replaces this one.
   *
   * @param takenMs when the session took the turn
   * @param window which turn's window this is
   */
  private async windowEnds({ takenMs, window }: { takenMs: number; window: number }): Promise<void> {
    try {
      if (this.writing !== undefined) {
        // A later write that throws is its own take's to answer; this window still ends, and frees the floor.
        await this.inFlight?.catch(() => undefined);
      }
      if (this.waiting !== window) {
        return;
      }
      const { voiceWordAtMs } = this;
      const owed = [...this.unreadPaths];
      const unreadAttachments = owed.length;
      if (!typedInKickDue({ ...this.call.moved(), takenMs, unreadAttachments, voiceWordAtMs })) {
        return;
      }
      this.kicking = true;
      let fate: string | undefined;
      try {
        const kick =
          unreadAttachments > 0
            ? {
                text: TYPED_IN_ATTACHMENT_KICK_TEXT,
                why: "the owner attached a file in the call and it had not been read",
              }
            : {
                text: TYPED_IN_KICK_TEXT,
                why: "the owner typed a message into the call and the voice had not answered it",
              };
        fate = await this.call.kick(kick);
      } catch (cause) {
        // A kick write that throws, before its promise or in it, is said like one the session refused, never left
        // to reject unheard.
        fate = cause instanceof Error ? cause.message : String(cause);
      } finally {
        this.kicking = false;
      }
      if (fate !== undefined) {
        this.call.failed({ message: `the voice was not asked to answer the owner's message: ${fate}` });
        return;
      }
      // Each attachment is asked about once: a taken kick settles what it covered, so a later plain message of the owner's
      // is never answered with a line about a file "in the message above". A failed one keeps them.
      this.settle({ paths: owed });
    } finally {
      if (this.waiting === window) {
        this.waiting = undefined;
      }
    }
  }
}
