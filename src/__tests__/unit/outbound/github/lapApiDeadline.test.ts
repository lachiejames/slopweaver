import { errAsync, ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { GithubProtectionReadError } from "../../../../corpus/github/protectionRead.js";
import type { IngestError } from "../../../../lib/ingestError.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { GithubLapApi } from "../../../../outbound/github/lapApi.js";
import {
  boundedLapApi,
  type LapDeadline,
  type LapDeadlineTimer,
  withLapDeadline,
} from "../../../../outbound/github/lapApiDeadline.js";

/** A GitHub call that never settles, as a request riding a dead socket never does. */
function hung<T>(): ResultAsync<T, IngestError> {
  return new ResultAsync(new Promise(() => undefined));
}

/** A deadline seam recording each arming and cancel; `elapse` decides whether it elapses at once or never. */
function timerOf({
  elapse,
  armed,
  cancelled,
}: {
  elapse: boolean;
  armed: number[];
  cancelled: number[];
}): LapDeadlineTimer {
  return ({ ms }): LapDeadline => {
    armed.push(ms);
    return {
      cancel: () => {
        cancelled.push(ms);
      },
      elapsed: elapse ? Promise.resolve() : new Promise(() => undefined),
    };
  };
}

/** Every method of the surface hanging, so only a deadline can end any call. */
function hungApi(): GithubLapApi {
  return {
    isAdmin: () => hung(),
    mergeRecord: () => hung(),
    postStatus: () => hung(),
    protection: () => hung(),
    read: () => hung(),
    requiredSources: () => hung(),
    statuses: () => hung(),
  };
}

const REPO = { owner: "acme", repo: "widgets" };

/** One call per method, each naming the operation its timeout must carry; `.map` keeps only the failure side. */
const CALLS: readonly {
  readonly operation: string;
  readonly call: (api: GithubLapApi) => ResultAsync<undefined, IngestError | GithubProtectionReadError>;
}[] = [
  { call: (api) => api.isAdmin(REPO).map(() => undefined), operation: "github.lap.isAdmin" },
  { call: (api) => api.mergeRecord({ ...REPO, number: 7 }).map(() => undefined), operation: "github.lap.mergeRecord" },
  {
    call: (api) =>
      api
        .postStatus({ ...REPO, context: "build", description: "d", sha: "abc", state: "pending" })
        .map(() => undefined),
    operation: "github.lap.postStatus",
  },
  {
    call: (api) => api.protection({ ...REPO, branch: "main" }).map(() => undefined),
    operation: "github.lap.protection",
  },
  { call: (api) => api.read({ ...REPO, number: 7 }).map(() => undefined), operation: "github.lap.read" },
  {
    call: (api) => api.requiredSources({ ...REPO, branch: "main" }).map(() => undefined),
    operation: "github.lap.requiredSources",
  },
  { call: (api) => api.statuses({ ...REPO, sha: "abc" }).map(() => undefined), operation: "github.lap.statuses" },
];

describe("withLapDeadline", () => {
  it("ends a call that never settles in LAP_GITHUB_TIMEOUT once its deadline elapses", async () => {
    const armed: number[] = [];
    const cancelled: number[] = [];
    const result = await withLapDeadline({
      call: () => hung<boolean>(),
      ms: 60_000,
      operation: "github.lap.protection",
      timer: timerOf({ armed, cancelled, elapse: true }),
    });
    expect(unwrapErr(result)).toEqual({
      code: "LAP_GITHUB_TIMEOUT",
      kind: "network",
      message: "GitHub did not answer github.lap.protection within 60s, so the lap treats the connection as dead",
      operation: "github.lap.protection",
      provider: "github",
    });
    expect(cancelled).toEqual([60_000]);
  });

  it("passes an answer that beats the deadline through untouched and stands the deadline down", async () => {
    const armed: number[] = [];
    const cancelled: number[] = [];
    const result = await withLapDeadline({
      call: () => ResultAsync.fromSafePromise(Promise.resolve(true)),
      ms: 60_000,
      operation: "github.lap.isAdmin",
      timer: timerOf({ armed, cancelled, elapse: false }),
    });
    expect(unwrap(result)).toBe(true);
    expect(armed).toEqual([60_000]);
    expect(cancelled).toEqual([60_000]);
  });

  it("passes a call's own failure through rather than calling it a timeout", async () => {
    const failure: IngestError = { kind: "http", message: "forbidden", operation: "x", status: 403 };
    const result = await withLapDeadline({
      call: () => errAsync<boolean, IngestError>(failure),
      ms: 60_000,
      operation: "github.lap.read",
      timer: timerOf({ armed: [], cancelled: [], elapse: false }),
    });
    expect(unwrapErr(result)).toBe(failure);
  });
});

describe("withLapDeadline over a call that throws", () => {
  it("turns a synchronous throw into a typed failure and still stands the deadline down", async () => {
    const cancelled: number[] = [];
    const result = await withLapDeadline({
      call: (): ResultAsync<boolean, IngestError> => {
        throw new Error("synchronous adapter failure");
      },
      ms: 60_000,
      operation: "github.lap.read",
      timer: timerOf({ armed: [], cancelled, elapse: false }),
    });
    expect(unwrapErr(result).message).toBe("synchronous adapter failure");
    expect(unwrapErr(result).operation).toBe("github.lap.read");
    expect(cancelled).toEqual([60_000]);
  });
});

describe("boundedLapApi", () => {
  it("covers every method of the lap's GitHub surface", () => {
    expect(CALLS.length).toBe(Object.keys(hungApi()).length);
  });

  it.each(CALLS)("ends a hung $operation in its own typed timeout", async ({ call, operation }) => {
    const api = boundedLapApi({
      api: hungApi(),
      ms: 60_000,
      timer: timerOf({ armed: [], cancelled: [], elapse: true }),
    });
    const result = await call(api);
    // Every failure member carries a message; only the timeout's IngestError carries the operation it names.
    const failure: { readonly code?: string; readonly message: string; readonly operation?: string } =
      unwrapErr(result);
    expect(failure.code).toBe("LAP_GITHUB_TIMEOUT");
    expect(failure.operation).toBe(operation);
  });
});
