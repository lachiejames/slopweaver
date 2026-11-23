/**
 * The push→pull bridge: a websocket delivers frames by CALLING you, and the listener loop wants to AWAIT
 * them one at a time. This holds the few lines that convert one into the other.
 *
 * It is its own module for a testability reason rather than a tidiness one. A queue that buffers a burst,
 * blocks when empty, resumes when a frame arrives, and terminates exactly once when the socket closes has
 * four real behaviours and no I/O at all — so it can be unit-tested with a plain async loop, leaving
 * `./wire.ts` a websocket adapter with no logic in it to get wrong.
 *
 * Deliberately single-consumer: one listener drains one socket. A second concurrent consumer would race on
 * the same buffer, and nothing here pretends otherwise.
 */

/** A bounded-lifetime stream of text frames: pushed by the socket, pulled by the listener. */
export interface FrameQueue {
  /** Buffer one frame. Ignored after the queue has ended — a frame arriving post-close cannot be handled. */
  push(args: { text: string }): void;
  /** End the stream, exactly once: the FIRST reason wins, since it is the one that caused the others. */
  end(args: { why: string }): void;
  /**
   * End the stream DESTRUCTIVELY: unlike {@link end}, any frame already buffered is thrown away rather than
   * drained, and counted through {@link discarded} alongside frames that arrive afterward. The first end
   * reason still wins — a queue already ended by `end` or an earlier `cancel` keeps that reason.
   *
   * This exists for the deadline path only: a clock winner cannot let an already-open connection go on
   * draining whatever Slack had already buffered, because that is exactly the "no output" window `end`'s own
   * graceful drain protects for `--once`. Ordinary `--once` behaviour must keep using `end`.
   */
  cancel(args: { why: string }): void;
  /** The frames, in arrival order. Returns when the queue ends and the buffer is drained. */
  frames(): AsyncIterable<string>;
  /** Why the stream ended, or undefined while it is still live. */
  endedBecause(): string | undefined;
  /**
   * How many frames were pushed AFTER the queue ended, and therefore never reached anybody — PLUS, since
   * {@link cancel} exists, every frame a cancellation threw away that `end` would have drained.
   *
   * MEASURED, because the assumption was wrong in both directions and the wrong half is the dangerous one.
   * Frames already buffered when `end` is called are NOT lost — `frames()` shifts the buffer before it checks
   * `ended`, so a burst that arrived before `--once` closed still drains in full. What is lost is a frame that
   * arrives after: `push` no-ops, and until this counter existed it did so in total silence.
   *
   * That is precisely the `--once` window. The listener closes the socket the moment one mention is handled,
   * and a second tag already on the wire lands here with nothing to receive it and no acknowledgement going
   * back — so Slack redelivers into a connection that has just closed, and the tag is simply gone. A lost tag
   * must produce a number; this is the number.
   */
  discarded(): number;
}

/**
 * A fresh, empty frame queue.
 *
 * @returns the queue
 */
export function createFrameQueue(): FrameQueue {
  const pending: string[] = [];
  let ended: string | undefined;
  let lost = 0;
  let wake: (() => void) | undefined;
  // The waiter is cleared BEFORE it is called, so a frame pushed from inside the resumed consumer cannot
  // resolve an already-settled promise and be dropped.
  const nudge = (): void => {
    const waiting = wake;
    wake = undefined;
    if (waiting !== undefined) {
      waiting();
    }
  };
  // The FIRST reason wins (`FrameQueue.end`).
  const endOnce = ({ why }: { why: string }): void => {
    if (ended !== undefined) {
      return;
    }
    ended = why;
  };
  return {
    cancel: ({ why }) => {
      lost += pending.length;
      pending.length = 0;
      endOnce({ why });
      nudge();
    },
    discarded: () => lost,
    end: ({ why }) => {
      endOnce({ why });
      nudge();
    },
    endedBecause: () => ended,
    frames: async function* frames(): AsyncIterable<string> {
      for (;;) {
        const next = pending.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (ended !== undefined) {
          return;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
    push: ({ text }) => {
      if (ended !== undefined) {
        // The one place a frame is genuinely thrown away. Counted rather than ignored — see `discarded`.
        lost += 1;
        return;
      }
      pending.push(text);
      nudge();
    },
  };
}
