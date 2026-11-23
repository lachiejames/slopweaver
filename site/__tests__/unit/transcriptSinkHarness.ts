/*
 * The call transcript's sink over a plain fake post (a seam, not a mock) whose answers the test releases one at a
 * time, with the call ids, the open line and the readers every scenario uses. Shared by every test file of the sink,
 * so each splits by scenario rather than copying the harness.
 */
import type { CallLine, TalkTranscriptWire } from "../../lib/talkTranscript";
import { createTranscriptSink } from "../../lib/transcriptSink";
import type { TranscriptPostAnswer, TranscriptSink } from "../../lib/transcriptSinkContract";

export const CALL = "a0000041-0000-4000-8000-000000000044";
export const OLD_CALL = "a0000076-0000-4000-8000-000000000083";
export const AT = "2026-09-25T02:30:00.000Z";
export const OPEN: CallLine = { atIso: AT, kind: "open", model: "m", sessionId: "sess", voice: "marin" };
export const STEP = { atIso: AT, event: { attempt: 1, delayMs: 0, kind: "scheduled" }, kind: "reconnect" } as const;

/** What the sink said it lost. */
export type Refused = Parameters<Parameters<typeof createTranscriptSink>[0]["onRefused"]>[0];

/**
 * A sink over a fake post whose answers the test releases one at a time.
 *
 * @returns the sink, every post it made with the function that answers it, and every loss it said
 */
export function harness(): {
  sink: TranscriptSink;
  posts: { wire: TalkTranscriptWire; keepalive: boolean; answer: (input: TranscriptPostAnswer) => void }[];
  refused: Refused[];
} {
  const posts: { wire: TalkTranscriptWire; keepalive: boolean; answer: (input: TranscriptPostAnswer) => void }[] = [];
  const refused: Refused[] = [];
  let minted = 0;
  const sink = createTranscriptSink({
    mintWriteId: () => {
      minted += 1;
      return `w-${String(minted)}`;
    },
    nowIso: () => AT,
    onRefused: (input) => {
      refused.push(input);
    },
    post: ({ wire, keepalive }) =>
      new Promise<TranscriptPostAnswer>((resolve) => {
        posts.push({ answer: resolve, keepalive, wire });
      }),
  });
  return { posts, refused, sink };
}

/**
 * Each segment line's id and the card it names, `undefined` for none.
 *
 * @returns one `id@card` entry per segment line of the post
 */
export const opens = ({ wire }: { wire: TalkTranscriptWire }): string[] =>
  wire.lines.flatMap((line) => (line.kind === "segment" ? [`${line.id}@${String(line.open)}`] : []));

/**
 * Each line's kind, and a segment's text and finality.
 *
 * @returns one entry per line of the post, `text:final` for a segment and the kind for any other
 */
export const shape = ({ wire }: { wire: TalkTranscriptWire }): string[] =>
  wire.lines.map((line) => (line.kind === "segment" ? `${line.text}:${String(line.final)}` : line.kind));

/** Let the fake post's settled answer run its `.then`. */
export const settle = async (): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
};
