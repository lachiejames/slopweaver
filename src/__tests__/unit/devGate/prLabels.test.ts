/**
 * The live label read the `dev gate` judges: a local run reads nothing and makes no call; a pull-request run calls
 * the injected read exactly once with the pull request's own coordinates and hands its answer through unchanged,
 * an empty list included; and an incomplete context or a failed read is its own named error, never an empty list.
 */
import { describe, expect, it } from "vitest";

import { DevGatePrLabelsErrors, labelsForDevGate, type ReadPrLabels } from "../../../devGate/prLabels.js";
import type { IngestError } from "../../../lib/ingestError.js";
import { errAsync, okAsync, type ResultAsync, unwrap, unwrapErr } from "../../../lib/result.js";

/** One call the fake read received. */
interface ReadCall {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/** A plain fake read that records each call and answers the one canned result. */
function recordingRead({
  calls,
  answer,
}: {
  calls: ReadCall[];
  answer: () => ResultAsync<readonly string[], IngestError>;
}): ReadPrLabels {
  return (input) => {
    calls.push(input);
    return answer();
  };
}

const TOKEN = "fixture-token-never-printed";

/** A complete pull-request run's environment, with any variable overridden. */
function prEnv({ over = {} }: { over?: Record<string, string | undefined> } = {}): Record<string, string | undefined> {
  return { GITHUB_TOKEN: TOKEN, PR_NUMBER: "42", PR_REPOSITORY: "acme/widgets", ...over };
}

const SERVER_ERROR: IngestError = {
  kind: "http",
  message: `request failed with ${TOKEN} in a header`,
  operation: "github.issues.get",
  provider: "github",
  status: 500,
};

describe("labelsForDevGate", () => {
  it("reads nothing on a local run, even with a token in the environment", async () => {
    const calls: ReadCall[] = [];
    const read = recordingRead({ answer: () => okAsync(["bug fix"]), calls });

    const result = await labelsForDevGate({ env: { GITHUB_TOKEN: TOKEN, PR_REPOSITORY: "acme/widgets" }, read });

    expect(unwrap(result)).toBe(undefined);
    expect(calls).toEqual([]);
  });

  it("refuses a set but blank PR_NUMBER rather than reading it as a local run", async () => {
    const calls: ReadCall[] = [];
    const read = recordingRead({ answer: () => okAsync(["bug fix"]), calls });

    const blank = unwrapErr(await labelsForDevGate({ env: prEnv({ over: { PR_NUMBER: "  " } }), read }));
    const empty = unwrapErr(await labelsForDevGate({ env: prEnv({ over: { PR_NUMBER: "" } }), read }));

    const expected = DevGatePrLabelsErrors.contextInvalid({ problem: "$PR_NUMBER is not a pull request number" });
    expect([blank, empty]).toEqual([expected, expected]);
    expect(calls).toEqual([]);
  });

  it("calls the read once with the pull request's own coordinates and answers its labels unchanged", async () => {
    const calls: ReadCall[] = [];
    const read = recordingRead({ answer: () => okAsync(["bug fix", "security"]), calls });

    const result = await labelsForDevGate({ env: prEnv(), read });

    expect(unwrap(result)).toEqual(["bug fix", "security"]);
    expect(calls).toEqual([{ number: 42, owner: "acme", repo: "widgets", token: TOKEN }]);
  });

  it("answers an empty list as an empty list, which the kind-label check then judges", async () => {
    const calls: ReadCall[] = [];
    const read = recordingRead({ answer: () => okAsync([]), calls });

    const result = await labelsForDevGate({ env: prEnv(), read });

    expect(unwrap(result)).toEqual([]);
    expect(calls.length).toBe(1);
  });

  it("refuses a pull-request run with no token, making no call", async () => {
    const calls: ReadCall[] = [];
    const read = recordingRead({ answer: () => okAsync(["bug fix"]), calls });

    const error = unwrapErr(await labelsForDevGate({ env: prEnv({ over: { GITHUB_TOKEN: undefined } }), read }));

    expect(error).toEqual(
      DevGatePrLabelsErrors.contextInvalid({ problem: "$GITHUB_TOKEN is not set on the gate step" }),
    );
    expect(calls).toEqual([]);
  });

  it("refuses a PR_NUMBER that is not a positive whole number", async () => {
    const calls: ReadCall[] = [];
    const read = recordingRead({ answer: () => okAsync(["bug fix"]), calls });

    const zero = unwrapErr(await labelsForDevGate({ env: prEnv({ over: { PR_NUMBER: "0" } }), read }));
    const fraction = unwrapErr(await labelsForDevGate({ env: prEnv({ over: { PR_NUMBER: "4.2" } }), read }));
    const word = unwrapErr(await labelsForDevGate({ env: prEnv({ over: { PR_NUMBER: "forty" } }), read }));
    const hex = unwrapErr(await labelsForDevGate({ env: prEnv({ over: { PR_NUMBER: "0x2A" } }), read }));

    const expected = DevGatePrLabelsErrors.contextInvalid({ problem: "$PR_NUMBER is not a pull request number" });
    expect([zero, fraction, word, hex]).toEqual([expected, expected, expected, expected]);
    expect(calls).toEqual([]);
  });

  it("refuses a missing or malformed PR_REPOSITORY", async () => {
    const calls: ReadCall[] = [];
    const read = recordingRead({ answer: () => okAsync(["bug fix"]), calls });

    const missing = unwrapErr(await labelsForDevGate({ env: prEnv({ over: { PR_REPOSITORY: undefined } }), read }));
    const malformed = unwrapErr(await labelsForDevGate({ env: prEnv({ over: { PR_REPOSITORY: "widgets" } }), read }));

    const expected = DevGatePrLabelsErrors.contextInvalid({ problem: "$PR_REPOSITORY is not an owner/repo" });
    expect([missing, malformed]).toEqual([expected, expected]);
    expect(missing.code).toBe("PR_LABEL_CONTEXT_INVALID");
    expect(calls).toEqual([]);
  });

  it("names a failed read with its status, once, and never carries the provider's message or the token", async () => {
    const calls: ReadCall[] = [];
    const read = recordingRead({ answer: () => errAsync(SERVER_ERROR), calls });

    const error = unwrapErr(await labelsForDevGate({ env: prEnv(), read }));

    expect(error).toEqual({
      code: "PR_LABELS_READ_FAILED",
      message:
        "PR_LABELS_READ_FAILED: the live read of the pull request's labels (github.issues.get) answered 500; re-run the job",
      status: 500,
    });
    expect(error.message).not.toContain(TOKEN);
    expect(calls.length).toBe(1);
  });

  it("names a read that failed with no status by its failure kind", async () => {
    const calls: ReadCall[] = [];
    const read = recordingRead({
      answer: () => errAsync({ kind: "network", message: "socket hang up", operation: "github.issues.get" }),
      calls,
    });

    const error = unwrapErr(await labelsForDevGate({ env: prEnv(), read }));

    expect(error.message).toBe(
      "PR_LABELS_READ_FAILED: the live read of the pull request's labels (github.issues.get) failed (network); re-run the job",
    );
    expect(error.code).toBe("PR_LABELS_READ_FAILED");
  });
});
