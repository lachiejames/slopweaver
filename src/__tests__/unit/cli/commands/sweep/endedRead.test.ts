/**
 * The board sweep's one GitHub read: one question per distinct pull request, a failed read printed rather than read
 * as ended, and a remembered read costing no second call.
 */
import { describe, expect, it } from "vitest";

import { readEndedPullRequests, rememberedFetch } from "../../../../../cli/commands/sweep/endedRead.js";
import { composeBoardModels } from "../../../../../handover/boardState.js";
import type { BoardModel } from "../../../../../handover/boardTypes.js";
import { unwrap } from "../../../../../lib/result.js";
import { ask } from "../../../sweep/askDocFixture.js";
import { tableFetch } from "../../../sweep/boardRunFixture.js";

import { closed, merged } from "./sweepReadFixture.js";

const ACME_2 = "https://github.com/acme/app/pull/2";
const ACME_3 = "https://github.com/acme/app/pull/3";

/** Composed live asks, one per question, slugged by position. */
function models({ questions }: { questions: readonly string[] }): readonly BoardModel[] {
  const docs = questions.map((summary, index) =>
    ask({ settlement: undefined, settlementWitness: undefined, slug: `row-${String(index)}`, summary }),
  );
  return composeBoardModels({ journals: new Map(), probeStates: new Map(), resolutionDocs: docs, roots: docs });
}

describe("readEndedPullRequests", () => {
  it("asks once for a pull request two rows name", async () => {
    const asked: string[] = [];
    const reads = await readEndedPullRequests({
      fetch: tableFetch({ asked, closures: new Map([["acme/app#2", closed({ number: 2 })]]) }),
      models: models({ questions: [`Close ${ACME_2}?`, `Should we abandon ${ACME_2}?`] }),
    });

    expect(asked).toEqual(["acme/app#2"]);
    expect(reads.asked).toBe(1);
    expect([...reads.closures.keys()]).toEqual(["acme/app#2"]);
    expect(reads.unread).toEqual([]);
  });

  it("reports a failed read rather than holding a closure for it", async () => {
    const reads = await readEndedPullRequests({
      fetch: tableFetch({ closures: new Map([["acme/app#2", closed({ number: 2 })]]) }),
      models: models({ questions: [`Close ${ACME_2} as superseded by ${ACME_3}?`] }),
    });

    expect(reads.asked).toBe(2);
    expect([...reads.closures.keys()]).toEqual(["acme/app#2"]);
    expect(reads.unread).toEqual(["acme/app#3: no fixture for acme/app#3"]);
  });

  it("asks nothing of a board whose questions name no pull request", async () => {
    const asked: string[] = [];
    const reads = await readEndedPullRequests({
      fetch: tableFetch({ asked, closures: new Map() }),
      models: models({ questions: ["Which plan should we buy?"] }),
    });

    expect(asked).toEqual([]);
    expect(reads.asked).toBe(0);
  });
});

describe("rememberedFetch", () => {
  const PR = { number: 3, owner: "acme", repo: "app" };

  it("answers a second read from the first", async () => {
    const asked: string[] = [];
    const fetch = rememberedFetch({
      fetch: tableFetch({ asked, closures: new Map([["acme/app#3", merged({ number: 3 })]]) }),
    });

    const first = unwrap(await fetch(PR));
    const second = unwrap(await fetch(PR));

    expect(asked).toEqual(["acme/app#3"]);
    expect(second).toEqual(first);
  });

  it("asks again after a failed read", async () => {
    const asked: string[] = [];
    const fetch = rememberedFetch({ fetch: tableFetch({ asked, closures: new Map() }) });

    await fetch(PR);
    await fetch(PR);

    expect(asked).toEqual(["acme/app#3", "acme/app#3"]);
  });
});
