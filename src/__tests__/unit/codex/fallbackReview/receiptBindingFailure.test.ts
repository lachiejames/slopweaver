/*
 * `receiptBindingFailure`: a receipt passes only while its request file's bytes are unchanged, parse, and agree with
 * the request id and copy the receipt embeds.
 */
import { describe, expect, it } from "vitest";

import { fallbackDocumentSha256, receiptBindingFailure } from "../../../../codex/fallbackReview.js";
import { receiptFor, refusalRequest, request } from "./harness.js";

describe("receiptBindingFailure", () => {
  it("passes a receipt whose request bytes are unchanged", () => {
    const req = request();
    expect(receiptBindingFailure({ receipt: receiptFor({ req }), requestBytes: JSON.stringify(req) })).toBeUndefined();
  });

  it("fails a receipt whose request was edited after recording", () => {
    const req = request();
    const failure = receiptBindingFailure({
      receipt: receiptFor({ req }),
      requestBytes: JSON.stringify(request({ property: { id: "r2-01", statement: "a weaker claim" } })),
    });
    expect(failure).toBe("receipt rcpt-1 binds to request bytes that no longer match req-1");
  });

  it("fails a receipt whose embedded request disagrees with its own requestId", () => {
    const req = request();
    const forged = { ...receiptFor({ req }), requestId: "req-other" };
    const failure = receiptBindingFailure({ receipt: forged, requestBytes: JSON.stringify(req) });
    expect(failure).toBe("receipt rcpt-1 embeds request req-1 but claims req-other");
  });

  it("fails a receipt whose embedded request swaps the refusal ground for a cap — the file's ground governs", () => {
    const onDisk = refusalRequest();
    const forged = { ...receiptFor({ req: onDisk }), request: request() };
    const failure = receiptBindingFailure({ receipt: forged, requestBytes: JSON.stringify(onDisk) });
    expect(failure).toBe("receipt rcpt-1 embeds a copy of req-1 that disagrees with the request file");
  });

  it("still binds a receipt whose embedded copy predates the origin binding its request file carries", () => {
    const onDisk = request({ originRepository: "acme/widget" });
    const { originRepository: _absent, ...older } = onDisk;
    const receipt = { ...receiptFor({ req: onDisk }), request: older };
    expect(receiptBindingFailure({ receipt, requestBytes: JSON.stringify(onDisk) })).toBeUndefined();
  });

  it("binds as it always did when only the embedded copy carries an origin — the origin is never what binding judges", () => {
    const onDisk = request();
    const embedded = { ...receiptFor({ req: onDisk }), request: request({ originRepository: "acme/widget" }) };
    expect(receiptBindingFailure({ receipt: embedded, requestBytes: JSON.stringify(onDisk) })).toBeUndefined();
  });

  it("fails a receipt whose request file does not parse as a request", () => {
    const req = request();
    const receipt = receiptFor({ req });
    const bytes = JSON.stringify({ requestId: "req-1" });
    const failure = receiptBindingFailure({
      receipt: { ...receipt, requestSha256: fallbackDocumentSha256({ bytes }) },
      requestBytes: bytes,
    });
    expect(failure).toBe("receipt rcpt-1 binds to request req-1, which does not parse");
  });
});
