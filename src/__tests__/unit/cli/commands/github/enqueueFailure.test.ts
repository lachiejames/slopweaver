import { describe, expect, it } from "vitest";

import {
  landedDespiteFailureLine,
  type MutationWitness,
  mayResendMutation,
  mutationFailureLines,
  resendingLine,
} from "../../../../../cli/commands/github/enqueueFailure.js";
import type { IngestError } from "../../../../../lib/ingestError.js";

/** No HTTP response of any kind came back — the class the recovery path exists for. */
const TRANSPORT: IngestError = {
  code: "UND_ERR_SOCKET",
  kind: "network",
  message: "other side closed",
  operation: "github.enqueuePullRequest",
  provider: "github",
};

/** GitHub answered and refused — a verdict, not a dropped connection. */
const REFUSED: IngestError = {
  kind: "http",
  message: "expected head oid does not match the current head oid",
  operation: "github.enqueuePullRequest",
  provider: "github",
  status: 422,
};

const ABSENT: MutationWitness = { kind: "absent" };
const LANDED: MutationWitness = { kind: "landed" };
const UNREADABLE: MutationWitness = { kind: "unreadable", why: "pull request acme/widget#9 not found" };

describe("mayResendMutation", () => {
  it("permits a second send only when the witness proved the state absent AND nothing answered", () => {
    expect(mayResendMutation({ error: TRANSPORT, witness: ABSENT })).toBe(true);
  });

  it("refuses a second send when GitHub answered, however transient its answer looks", () => {
    expect(mayResendMutation({ error: REFUSED, witness: ABSENT })).toBe(false);
  });

  it("refuses a second send when the press already landed", () => {
    expect(mayResendMutation({ error: TRANSPORT, witness: LANDED })).toBe(false);
  });

  it("refuses a second send when the witness could not be read — an unproven absence is not an absence", () => {
    expect(mayResendMutation({ error: TRANSPORT, witness: UNREADABLE })).toBe(false);
  });
});

describe("mutationFailureLines", () => {
  const subject = { number: 9, repo: "acme/widget" };

  it("opens with the formatted failure, naming the operation and the transport code", () => {
    const lines = mutationFailureLines({ ...subject, dequeue: false, error: TRANSPORT, witness: ABSENT });
    expect(lines[0]).toBe("github github.enqueuePullRequest UND_ERR_SOCKET: other side closed");
  });

  it("states plainly that nothing was changed when the transport dropped and the witness proved it", () => {
    const lines = mutationFailureLines({ ...subject, dequeue: false, error: TRANSPORT, witness: ABSENT });
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe(
      "no HTTP response came back at all, so GitHub never answered this enqueue of acme/widget#9; the queue " +
        "read back shows nothing was applied, and the one permitted re-send failed the same way. Nothing was " +
        "changed on GitHub — run the verb again.",
    );
  });

  it("says UNCERTAIN, and why, when the witness read failed too", () => {
    const lines = mutationFailureLines({ ...subject, dequeue: false, error: TRANSPORT, witness: UNREADABLE });
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe(
      "UNCERTAIN: the enqueue of acme/widget#9 failed and the queue read that would settle whether it landed " +
        "also failed (pull request acme/widget#9 not found). Read the pull request's merge queue before " +
        "pressing again.",
    );
  });

  it("names a refusal as GitHub's own verdict rather than as a dropped connection", () => {
    const lines = mutationFailureLines({ ...subject, dequeue: false, error: REFUSED, witness: ABSENT });
    expect(lines[0]).toBe(
      "github github.enqueuePullRequest HTTP 422: expected head oid does not match the current head oid",
    );
    expect(lines[1]).toBe(
      "GitHub answered and refused this enqueue of acme/widget#9; the queue read back confirms nothing was " +
        "applied. Re-sending would earn the same refusal — fix what it named.",
    );
  });

  it("names the DIRECTION the caller asked for, so a dequeue does not report itself as an enqueue", () => {
    const lines = mutationFailureLines({ ...subject, dequeue: true, error: TRANSPORT, witness: UNREADABLE });
    expect(lines[1]).toContain("the dequeue of acme/widget#9 failed");
  });
});

describe("the two diagnostic lines", () => {
  it("announces the one re-send before it happens, and says it is the only one", () => {
    expect(resendingLine({ dequeue: false })).toBe(
      "the enqueue died at the transport and the queue read back shows nothing was applied — sending it once " +
        "more. This is the only re-send; a second failure is reported, not retried.",
    );
  });

  it("explains a failure GitHub had already applied, carrying the failure's own words", () => {
    expect(landedDespiteFailureLine({ dequeue: true, error: TRANSPORT })).toBe(
      "the dequeue reported a failure (github github.enqueuePullRequest UND_ERR_SOCKET: other side closed) but " +
        "GitHub had already applied it — the connection dropped after the mutation was accepted. The queue read " +
        "below is the witness.",
    );
  });
});
