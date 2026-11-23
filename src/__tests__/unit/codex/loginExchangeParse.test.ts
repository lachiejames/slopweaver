import { describe, expect, it } from "vitest";

import { codexLoginRequests, parseCodexLoginExchange } from "../../../codex/loginExchangeParse.js";

const START_OK =
  'start\t{"id":2,"result":{"type":"chatgpt","loginId":"5b1c-77","authUrl":"https://auth.openai.com/oauth/authorize?x=1"}}';
const COMPLETED_OK = 'completed\t{"method":"account/login/completed","params":{"loginId":"5b1c-77","success":true}}';
const ACCOUNT =
  'account\t{"id":3,"result":{"account":{"type":"chatgpt","email":"owner@example.com","planType":"pro"}}}';

describe("parseCodexLoginExchange", () => {
  it("reads a finished sign-in as connected with the address the account read answered", () => {
    expect(parseCodexLoginExchange({ lines: [START_OK, "opened\t", COMPLETED_OK, ACCOUNT] })).toEqual({
      email: "owner@example.com",
      kind: "connected",
    });
  });

  it("stays connected with no address when the account read never answered", () => {
    expect(parseCodexLoginExchange({ lines: [START_OK, "opened\t", COMPLETED_OK, "!eof"] })).toEqual({
      email: undefined,
      kind: "connected",
    });
  });

  it("reads a cancel the program sent as cancelled, whatever completion follows it", () => {
    const failedCompletion =
      'completed\t{"method":"account/login/completed","params":{"loginId":"5b1c-77","success":false,"error":"canceled"}}';
    expect(parseCodexLoginExchange({ lines: [START_OK, "opened\t", "cancelsent\t", failedCompletion] })).toEqual({
      kind: "cancelled",
    });
  });

  it("reads a cancel before the page existed as cancelled", () => {
    expect(parseCodexLoginExchange({ lines: ["!cancelled"] })).toEqual({ kind: "cancelled" });
  });

  it("names the provider's own words when the sign-in itself failed", () => {
    const failed =
      'completed\t{"method":"account/login/completed","params":{"loginId":"5b1c-77","success":false,"error":"access denied"}}';
    expect(parseCodexLoginExchange({ lines: [START_OK, "opened\t", failed] })).toEqual({
      detail: "access denied",
      failure: "SIGN_IN_FAILED",
      kind: "failed",
    });
  });

  it("reads a refused start as START_REFUSED with the provider's message", () => {
    const refused = 'start\t{"id":2,"error":{"code":-32600,"message":"port 1455 is in use"}}';
    expect(parseCodexLoginExchange({ lines: [refused] })).toEqual({
      detail: "port 1455 is in use",
      failure: "START_REFUSED",
      kind: "failed",
    });
  });

  it("reads a start with no page as START_REFUSED", () => {
    expect(parseCodexLoginExchange({ lines: ['start\t{"id":2,"result":{"type":"apiKey"}}'] })).toEqual({
      detail: "Codex answered without a sign-in page",
      failure: "START_REFUSED",
      kind: "failed",
    });
  });

  it.each([
    ["!url", "URL_REFUSED"],
    ["!browser", "BROWSER_FAILED"],
    ["!deadline", "TIMED_OUT"],
    ["!eof", "EXITED"],
    ["!open", "EXITED"],
  ])("maps the %s marker to %s", (marker, failure) => {
    expect(parseCodexLoginExchange({ lines: [START_OK, marker] }).kind).toBe("failed");
    expect(parseCodexLoginExchange({ lines: [START_OK, marker] })).toMatchObject({ failure });
  });

  it("reads silence as EXITED", () => {
    expect(parseCodexLoginExchange({ lines: [] })).toEqual({
      detail: "the Codex CLI ended without answering",
      failure: "EXITED",
      kind: "failed",
    });
  });
});

describe("codexLoginRequests", () => {
  it("sends the handshake, then the ChatGPT sign-in start, under the ids the program waits on", () => {
    const requests = codexLoginRequests();
    expect(requests.start.map((line) => JSON.parse(line) as unknown)).toEqual([
      { id: 1, method: "initialize", params: { clientInfo: { name: "slopweaver", version: "0" } } },
      { method: "initialized" },
      { id: 2, method: "account/login/start", params: { type: "chatgpt" } },
    ]);
    expect(JSON.parse(requests.account)).toEqual({ id: 3, method: "account/read", params: { refreshToken: false } });
    expect(requests.cancelTemplate).toBe('{"id":4,"method":"account/login/cancel","params":{"loginId":"%s"}}');
  });
});
