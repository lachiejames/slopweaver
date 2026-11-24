/**
 * The CLI exit's pure half and its order over plain seams: which in-flight requests are thread-pool requests, which
 * of the requests in flight when the exit began are still in flight, the one line a stuck exit prints, and that the
 * exit waits for those requests — never for an empty pool — then exits, or names what it holds and ends the
 * process. Over real descriptors and a real `process.exit`: `../../subprocess/lib/threadPoolExit.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  exitWhenThreadPoolQuiet,
  stillInFlight,
  stuckExitLine,
  type ThreadPoolExitSeams,
  threadPoolRequests,
} from "../../../lib/threadPoolExit.js";

/* Stand-ins carrying Node's own class names, which is all the exit reads off a request besides its identity. */
class FSReqCallback {
  readonly standIn = true;
}
class FSReqPromise {
  readonly standIn = true;
}
class GetAddrInfoReqWrap {
  readonly standIn = true;
}
class WriteWrap {
  readonly standIn = true;
}

/**
 * Seams over a scripted request list: each look answers the next entry, the last one repeating, and every sleep
 * advances the clock by the time it asked for.
 */
function scriptedSeams({ looks }: { looks: readonly (readonly object[])[] }): {
  seams: ThreadPoolExitSeams;
  events: string[];
} {
  const events: string[] = [];
  let clock = 0;
  let look = 0;
  const seams: ThreadPoolExitSeams = {
    activeRequests: () => {
      const answer = looks[Math.min(look, looks.length - 1)]!;
      look += 1;
      return answer;
    },
    exit: (code) => {
      events.push(`exit:${String(code)}`);
    },
    kill: () => {
      events.push("kill");
    },
    nowMs: () => clock,
    sleep: ({ ms }) => {
      clock += ms;
      events.push(`sleep:${String(ms)}`);
      return Promise.resolve();
    },
    writeError: ({ line }) => {
      events.push(`stderr:${line}`);
    },
  };
  return { events, seams };
}

describe("threadPoolRequests", () => {
  it("keeps the fs and dns requests, the same objects, and passes over a socket's write", () => {
    const read = new FSReqCallback();
    const lookup = new GetAddrInfoReqWrap();
    const promised = new FSReqPromise();

    expect(threadPoolRequests({ requests: [new WriteWrap(), read, lookup, promised] })).toEqual([
      read,
      lookup,
      promised,
    ]);
  });

  it("answers nothing for an empty list", () => {
    expect(threadPoolRequests({ requests: [] })).toEqual([]);
  });
});

describe("stillInFlight", () => {
  it("keeps only the very requests that were in flight at first, never a newer one of the same kind", () => {
    const first = new FSReqCallback();
    const blocked = new FSReqCallback();
    const next = new FSReqCallback();

    const held = stillInFlight({ current: [next, blocked], initial: [first, blocked] });

    expect(held.length).toBe(1);
    expect(held[0]).toBe(blocked);
  });
});

describe("stuckExitLine", () => {
  it("counts each request kind, says how long it waited and names the verb's own code", () => {
    expect(
      stuckExitLine({ code: 0, pending: ["FSReqCallback", "GetAddrInfoReqWrap", "FSReqCallback"], waitedMs: 10_000 }),
    ).toBe(
      "exit: libuv's thread pool still holds FSReqCallback x2, GetAddrInfoReqWrap x1 after 10s. Node joins that " +
        "pool inside process.exit, so exiting would wait on it forever; ending this process with SIGKILL instead. " +
        "The verb itself answered exit code 0.",
    );
  });
});

describe("exitWhenThreadPoolQuiet", () => {
  it("exits at once with the verb's code when no thread-pool request is in flight", async () => {
    const { events, seams } = scriptedSeams({ looks: [[new WriteWrap()]] });

    await exitWhenThreadPoolQuiet({ code: 3, seams, waitMs: 1_000 });

    expect(events).toEqual(["exit:3"]);
  });

  it("waits out a request that settles, then exits with the verb's code", async () => {
    const read = new FSReqCallback();
    const { events, seams } = scriptedSeams({ looks: [[read], [read], []] });

    await exitWhenThreadPoolQuiet({ code: 0, seams, waitMs: 1_000 });

    expect(events).toEqual(["sleep:25", "sleep:25", "exit:0"]);
  });

  it("exits once the first request settles, though a chain keeps the pool from ever being empty", async () => {
    const { events, seams } = scriptedSeams({
      looks: [[new FSReqCallback()], [new FSReqCallback()], [new FSReqCallback()]],
    });

    await exitWhenThreadPoolQuiet({ code: 0, seams, waitMs: 1_000 });

    expect(events).toEqual(["sleep:25", "exit:0"]);
  });

  it("names a request that outlasts the wait and ends the process without calling exit", async () => {
    const lookup = new GetAddrInfoReqWrap();
    const { events, seams } = scriptedSeams({ looks: [[lookup], [new FSReqCallback(), lookup]] });

    await exitWhenThreadPoolQuiet({ code: 0, seams, waitMs: 50 });

    expect(events).toEqual([
      "sleep:25",
      "sleep:25",
      `stderr:${stuckExitLine({ code: 0, pending: ["GetAddrInfoReqWrap"], waitedMs: 50 })}`,
      "kill",
    ]);
  });
});
