import { describe, expect, it } from "vitest";

import { AcknowledgementErrors } from "../../../orgHealth/acknowledgementErrors.js";

describe("AcknowledgementErrors", () => {
  it("words a ledger failure with the path and the cause's own message", () => {
    const error = AcknowledgementErrors.ledgerIo({ cause: new Error("EACCES"), path: "/h/org-health/acks.jsonl" });

    expect(error).toEqual({
      code: "LEDGER_IO",
      message: "the incident-acknowledgement ledger at /h/org-health/acks.jsonl could not be used: EACCES",
      path: "/h/org-health/acks.jsonl",
    });
  });

  it("words a ledger failure whose cause is not an Error as the cause itself", () => {
    const error = AcknowledgementErrors.ledgerIo({ cause: "it is not a regular file", path: "/h/acks.jsonl" });

    expect(error.message).toBe(
      "the incident-acknowledgement ledger at /h/acks.jsonl could not be used: it is not a regular file",
    );
  });

  it("says nothing was acknowledged against a snapshot that is not measured, and why", () => {
    const error = AcknowledgementErrors.notMeasured({ because: "the snapshot is 3h old" });

    expect(error).toEqual({
      because: "the snapshot is 3h old",
      code: "NOT_MEASURED",
      message: "nothing to acknowledge against: the incident snapshot is not measured (the snapshot is 3h old)",
    });
  });

  it("names the reference that is not open", () => {
    const error = AcknowledgementErrors.notOpen({ ref: "INC-70" });

    expect(error).toEqual({
      code: "NOT_OPEN",
      message: "INC-70 is not an open incident in the current snapshot, so there is nothing to acknowledge",
      ref: "INC-70",
    });
  });

  it("says nothing was acknowledged for a reference held open twice", () => {
    const error = AcknowledgementErrors.ambiguousRef({ because: "INC-98 appears 2 times", ref: "INC-98" });

    expect(error).toEqual({
      code: "AMBIGUOUS_REF",
      message: "nothing was acknowledged: INC-98 appears 2 times",
      ref: "INC-98",
    });
  });
});
