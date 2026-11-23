/**
 * Reading `apps.connections.open`'s answer. Slack replies HTTP 200 to a refusal and puts the truth in
 * `ok:false` + `error`, so "the request succeeded" and "we have a connection" are different questions —
 * which is the whole reason this parse is separate and tested. Both arms are read through a strict boundary
 * whose key sets were measured live; drift refuses by key and never echoes a value.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { readTicket } from "../../../../live/listen/appsConnections.js";

/** The prefix every drift refusal carries. */
const REFUSED = "POST /api/apps.connections.open answered a shape this version does not read — refused, not guessed: ";

/** Read one answer body, as Slack sent it, at HTTP 200. */
function answered({ body }: { body: unknown }): ReturnType<typeof readTicket> {
  return readTicket({ status: 200, text: JSON.stringify(body) });
}

describe("readTicket", () => {
  it("reads the websocket url out of a successful response", () => {
    expect(unwrap(answered({ body: { ok: true, url: "wss://wss-primary.slack.example/link/?ticket=abc" } }))).toBe(
      "wss://wss-primary.slack.example/link/?ticket=abc",
    );
  });

  it("surfaces Slack's own error code on a refusal, because that names the fix", () => {
    const error = unwrapErr(answered({ body: { error: "invalid_auth", ok: false } }));
    expect(error.code).toBe("SOCKET_TICKET_REFUSED");
    expect(error.message).toBe("Slack refused apps.connections.open: invalid_auth");
    expect(error).toStrictEqual({
      code: "SOCKET_TICKET_REFUSED",
      message: "Slack refused apps.connections.open: invalid_auth",
      slackErrorCode: "invalid_auth",
    });
  });

  it("refuses a refusal that carries no code, since the measured arm always names one", () => {
    const error = unwrapErr(answered({ body: { ok: false } }));
    expect(error.code).toBe("SOCKET_TICKET_RESPONSE_CHANGED");
    expect(error.message).toBe(`${REFUSED}field "error" is missing`);
  });

  it("refuses a success with no url", () => {
    const error = unwrapErr(answered({ body: { ok: true } }));
    expect(error.code).toBe("SOCKET_TICKET_RESPONSE_CHANGED");
    expect(error.message).toBe(`${REFUSED}field "url" is missing`);
  });

  it("refuses a url that is not a websocket url, without quoting it", () => {
    const error = unwrapErr(answered({ body: { ok: true, url: "https://slack.example/not-a-socket" } }));
    expect(error.code).toBe("SOCKET_TICKET_RESPONSE_CHANGED");
    expect(error.message).not.toContain("not-a-socket");
    expect(error.message.startsWith(`${REFUSED}field "url"`)).toBe(true);
  });

  it.each(["wss:///link", "wss://:", "wss://:443/link", "wss://@/x", "wss://./x", "WSS://x.example/link"])(
    "refuses %s, a websocket url with no usable host, without quoting it",
    (url) => {
      const error = unwrapErr(answered({ body: { ok: true, url } }));
      expect(error.code).toBe("SOCKET_TICKET_RESPONSE_CHANGED");
      expect(error.message.startsWith(`${REFUSED}field "url"`)).toBe(true);
      expect(error.message).not.toContain(url);
    },
  );

  it("reads a ticket url carrying a port", () => {
    expect(unwrap(answered({ body: { ok: true, url: "wss://x.example:443/link" } }))).toBe("wss://x.example:443/link");
  });

  it("refuses a key Slack added to the success arm, naming the key and never its value", () => {
    const error = unwrapErr(answered({ body: { ok: true, url: "wss://x.example/link", warning: "DO_NOT_ECHO_7f3a" } }));
    expect(error.message).toBe(`${REFUSED}new field "warning"`);
    expect(error.message).not.toContain("DO_NOT_ECHO_7f3a");
  });

  it("names the HTTP status when the body is not JSON at all", () => {
    const error = unwrapErr(readTicket({ status: 502, text: "<html>gateway error</html>" }));
    expect(error.code).toBe("SOCKET_TICKET_NO_BODY");
    expect(error.message).toBe("Slack answered apps.connections.open with HTTP 502 and no JSON body");
  });

  it("refuses JSON that is not an object rather than reading it as a refusal", () => {
    expect(unwrapErr(readTicket({ status: 200, text: '"ok"' })).code).toBe("SOCKET_TICKET_RESPONSE_CHANGED");
  });

  it("treats a truthy-but-not-true ok as drift rather than a pass", () => {
    expect(unwrapErr(answered({ body: { ok: "true", url: "wss://x" } })).code).toBe("SOCKET_TICKET_RESPONSE_CHANGED");
  });
});
