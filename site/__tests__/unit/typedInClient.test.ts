/*
 * How the page reads the typed-in route's answer: only the route's own 2xx takes a message as in the call, only a
 * refusal the route wrote and called certain puts the owner's text back, and anything that may have reached the voice is
 * said as maybe sent, so it is never sent twice.
 */
import { describe, expect, it } from "vitest";

import { typedInBody, typedInSendOf } from "../../components/voice/typedInClient";

describe("typedInBody", () => {
  it("marks only the desktop test instance's send, so the owner's carries no instance", () => {
    const send = { messageId: "m-1", pressedMs: 5, text: "hi" };
    expect([
      JSON.parse(typedInBody({ ...send, instance: undefined })),
      JSON.parse(typedInBody({ ...send, instance: "e2e" })),
    ]).toEqual([send, { ...send, instance: "e2e" }]);
  });
});

describe("typedInSendOf", () => {
  it("takes the route's own 2xx as in the call, a retry answered already included", () => {
    expect([
      typedInSendOf({ body: { already: false, ok: true }, status: 200 }),
      typedInSendOf({ body: { already: true, ok: true }, status: 200 }),
    ]).toEqual([{ kind: "taken" }, { kind: "taken" }]);
  });

  it("never takes a 5xx as sent, whatever its body says", () => {
    expect(typedInSendOf({ body: { already: false, ok: true }, status: 502 })).toEqual({
      kind: "unknown",
      why: "the typed-in route answered HTTP 502",
    });
  });

  it("says a 2xx it cannot read as maybe sent, never refused", () => {
    expect(typedInSendOf({ body: undefined, status: 200 })).toEqual({
      kind: "unknown",
      why: "the typed-in route answered HTTP 200",
    });
  });

  it("says the route's own unsure answer as maybe sent, in its words", () => {
    const body = { ambiguous: true, ok: false, refused: "the voice was not handed the owner's message: timed out" };
    expect(typedInSendOf({ body, status: 504 })).toEqual({
      kind: "unknown",
      why: "the voice was not handed the owner's message: timed out",
    });
  });

  it("takes the route's own certain refusals as not sent: no call, two calls, a write that failed", () => {
    const refusal = ({ refused }: { refused: string }) => ({ ambiguous: false, ok: false, refused });
    expect([
      typedInSendOf({ body: { ...refusal({ refused: "no voice call is up" }), gone: true }, status: 404 }),
      typedInSendOf({ body: refusal({ refused: "2 voice calls are up" }), status: 409 }),
      typedInSendOf({
        body: refusal({ refused: "the voice was not handed the owner's message: no session" }),
        status: 424,
      }),
    ]).toEqual([
      { kind: "refused", why: "no voice call is up" },
      { kind: "refused", why: "2 voice calls are up" },
      { kind: "refused", why: "the voice was not handed the owner's message: no session" },
    ]);
  });

  it("says a refusal the route did not write as maybe sent", () => {
    expect(typedInSendOf({ body: { refused: "upstream not found" }, status: 404 })).toEqual({
      kind: "unknown",
      why: "upstream not found",
    });
  });
});
