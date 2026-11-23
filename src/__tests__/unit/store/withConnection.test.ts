import { describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import { withStoreConnection } from "../../../store/withConnection.js";

interface Rows {
  readonly close: () => Promise<void>;
}

const unavailable = ({ cause, doing }: { cause: unknown; doing: string }): string =>
  `could not ${doing}: ${cause instanceof Error ? cause.message : "unknown"}`;

/** A connection that records whether it was closed, and rejects its close when told to. */
function connection({ closeRejects }: { closeRejects: boolean }): { closed: string[]; rows: Rows } {
  const closed: string[] = [];
  return {
    closed,
    rows: {
      close: () => {
        closed.push("closed");
        return closeRejects ? Promise.reject(new Error("close broke")) : Promise.resolve();
      },
    },
  };
}

async function run({
  body,
  closeRejects = false,
  connect,
}: {
  body: (rows: Rows) => Promise<Result<number, string>>;
  closeRejects?: boolean;
  connect?: () => Promise<Result<Rows, string>>;
}): Promise<{ answer: Result<number, string>; closed: string[] }> {
  const opened = connection({ closeRejects });
  let open = (): Promise<Result<Rows, string>> => Promise.resolve(ok(opened.rows));
  if (connect !== undefined) {
    open = connect;
  }
  const answer = await withStoreConnection<Rows, number, string>({ body, connect: open, unavailable });
  return { answer, closed: opened.closed };
}

describe("withStoreConnection", () => {
  it("answers the body's value and closes the connection", async () => {
    const { answer, closed } = await run({ body: () => Promise.resolve(ok(7)) });
    expect(unwrap(answer)).toBe(7);
    expect(closed).toEqual(["closed"]);
  });

  it("answers the connect refusal without running the body", async () => {
    const ran: string[] = [];
    const { answer } = await run({
      body: () => {
        ran.push("body");
        return Promise.resolve(ok(1));
      },
      connect: () => Promise.resolve(err("store down")),
    });
    expect(unwrapErr(answer)).toBe("store down");
    expect(ran).toEqual([]);
  });

  it("turns a rejected connect into the caller's outage refusal", async () => {
    const { answer } = await run({
      body: () => Promise.resolve(ok(1)),
      connect: () => Promise.reject(new Error("refused")),
    });
    expect(unwrapErr(answer)).toBe("could not be opened: refused");
  });

  it("turns a rejected body into the outage refusal and still closes", async () => {
    const { answer, closed } = await run({ body: () => Promise.reject(new Error("boom")) });
    expect(unwrapErr(answer)).toBe("could not finish the operation: boom");
    expect(closed).toEqual(["closed"]);
  });

  it("refuses a success whose close then rejects", async () => {
    const { answer } = await run({ body: () => Promise.resolve(ok(3)), closeRejects: true });
    expect(unwrapErr(answer)).toBe("could not close its connection: close broke");
  });

  it("keeps the body's own refusal when the close then rejects", async () => {
    const { answer } = await run({ body: () => Promise.resolve(err("id taken")), closeRejects: true });
    expect(unwrapErr(answer)).toBe("id taken");
  });
});
