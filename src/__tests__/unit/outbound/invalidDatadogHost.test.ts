import { describe, expect, it } from "vitest";

import {
  InvalidDatadogHostRefusedError,
  invalidDatadogHostRefusal,
  invalidDatadogHostsInPayload,
  refuseInvalidDatadogHost,
} from "../../../outbound/invalidDatadogHost.js";

/** The link the bot actually posted, but on the synthetic `ap1` site rather than the install's own. */
const OFFENDING_URL = "https://app.ap1.datadoghq.com/monitors/1000001";

const closed = (): boolean => false;
const open = (): boolean => true;

describe("invalidDatadogHostsInPayload", () => {
  it("finds the host in a Slack blocks payload, with the path it sat at", () => {
    const payload = {
      blocks: [{ elements: [{ elements: [{ text: "monitor", type: "link", url: OFFENDING_URL }] }] }],
      channel: "C0SYN000000000",
    };
    expect(invalidDatadogHostsInPayload({ payload }).map((hit) => hit.path)).toEqual([
      "blocks.0.elements.0.elements.0.url",
    ]);
  });

  it("reports an empty path for a bare string", () => {
    expect(invalidDatadogHostsInPayload({ payload: OFFENDING_URL }).map((hit) => hit.path)).toEqual([""]);
  });

  it("reads record keys, URLs and FormData entries", () => {
    const form = new FormData();
    form.append("comment", `see ${OFFENDING_URL}`);
    const payload = { [OFFENDING_URL]: 1, form, link: new URL(OFFENDING_URL) };
    expect(invalidDatadogHostsInPayload({ payload }).map((hit) => hit.path)).toEqual(["", "form.comment", "link"]);
  });

  it("reads a boxed string whole, as JSON serialises it, rather than character by character", () => {
    const payload = { input: { description: new String(OFFENDING_URL) } };
    expect(invalidDatadogHostsInPayload({ payload }).map((hit) => hit.path)).toEqual(["input.description"]);
  });

  it("reads a boxed string whose toStringTag is spoofed, since serialisation still sends the string", () => {
    const boxed = Object.defineProperty(new String(OFFENDING_URL), Symbol.toStringTag, { value: "Boxed" });
    expect(invalidDatadogHostsInPayload({ payload: { body: boxed } }).map((hit) => hit.path)).toEqual(["body"]);
  });

  it("reads what toJSON answers, since JSON serialisation sends that rather than the object's fields", () => {
    const payload = { input: { description: { toJSON: (): string => OFFENDING_URL } } };
    expect(invalidDatadogHostsInPayload({ payload }).map((hit) => hit.path)).toEqual(["input.description"]);
  });

  it("reads a boxed string's own toJSON as well as the string it boxes", () => {
    const payload = { text: Object.assign(new String("clean"), { toJSON: (): string => OFFENDING_URL }) };
    expect(invalidDatadogHostsInPayload({ payload }).map((hit) => hit.path)).toEqual(["text"]);
  });

  it("calls toJSON with the property's own key, as JSON serialisation does", () => {
    // JSON serialisation hands toJSON the property's key; this one answers clean to any other caller.
    const toJSON: (key: string) => string = (key) => (key === "note" ? OFFENDING_URL : "clean");
    const payload = { metadata: { note: { toJSON } } };
    expect(invalidDatadogHostsInPayload({ payload }).map((hit) => hit.path)).toEqual(["metadata.note"]);
  });

  it("reads a byte view's own toJSON as well as its bytes", () => {
    const body = Object.defineProperty(new Uint8Array([0]), "toJSON", { value: (): string => OFFENDING_URL });
    expect(invalidDatadogHostsInPayload({ payload: { body } }).map((hit) => hit.path)).toEqual(["body"]);
  });

  it("reads a URL once, not again through the platform's own toJSON", () => {
    expect(invalidDatadogHostsInPayload({ payload: { link: new URL(OFFENDING_URL) } }).map((hit) => hit.path)).toEqual([
      "link",
    ]);
  });

  it("reads UTF-16 text in either byte order at either alignment, ending on the last byte", () => {
    const le = Buffer.from(OFFENDING_URL, "utf16le");
    const be = Buffer.from(le).swap16();
    const payload = {
      beEven: be,
      beOdd: Buffer.concat([Buffer.from([0x78]), be]),
      leEven: le,
      beTrailed: Buffer.concat([be, Buffer.from([0x58])]),
      leOdd: Buffer.concat([Buffer.from([0x78]), le]),
    };
    expect(invalidDatadogHostsInPayload({ payload }).map((hit) => hit.path)).toEqual([
      "beEven",
      "beOdd",
      "leEven",
      "beTrailed",
      "leOdd",
    ]);
  });

  it("reads what a bigint's toJSON answers, the one primitive JSON serialisation asks", () => {
    const original: unknown = Reflect.get(BigInt.prototype, "toJSON");
    Reflect.set(BigInt.prototype, "toJSON", (): string => OFFENDING_URL);
    try {
      expect(invalidDatadogHostsInPayload({ payload: { link: 1n } }).map((hit) => hit.path)).toEqual(["link"]);
    } finally {
      Reflect.set(BigInt.prototype, "toJSON", original);
    }
  });

  it("reads bytes as the text they carry, the shape a Slack upload's file takes", () => {
    const bytes = new TextEncoder().encode(`report ${OFFENDING_URL}`);
    const payload = { arrayBuffer: bytes.slice().buffer, buffer: Buffer.from(bytes), view: bytes.subarray(7) };
    expect(invalidDatadogHostsInPayload({ payload }).map((hit) => [hit.path, hit.correctHost])).toEqual([
      ["arrayBuffer", "ap1.datadoghq.com"],
      ["buffer", "ap1.datadoghq.com"],
      ["view", "ap1.datadoghq.com"],
    ]);
  });

  it("reads text stored as UTF-16 in either byte order, after a non-ASCII character a NUL strip would mangle", () => {
    const utf16le = Buffer.from(`≡${OFFENDING_URL}`, "utf16le");
    const utf16be = Buffer.from(utf16le).swap16();
    expect(invalidDatadogHostsInPayload({ payload: { utf16be, utf16le } }).map((hit) => hit.path)).toEqual([
      "utf16be",
      "utf16le",
    ]);
  });

  it("reads a FormData file entry's name and type, which multipart serialises beside its bytes", () => {
    const form = new FormData();
    form.set("file", new Blob(["clean"], { type: "app.ap1.datadoghq.com" }), "clean.txt");
    expect(invalidDatadogHostsInPayload({ payload: { form } }).map((hit) => hit.path)).toEqual(["form.file"]);
  });

  it("reads a Blob's type but not its bytes, which cannot be read synchronously", () => {
    const bytes = new TextEncoder().encode(OFFENDING_URL);
    const payload = {
      bytesOnly: new Blob([bytes]),
      typed: new Blob(["clean"], { type: "text/app.ap1.datadoghq.com" }),
    };
    expect(invalidDatadogHostsInPayload({ payload }).map((hit) => hit.path)).toEqual(["typed"]);
  });

  it("walks a cycle once", () => {
    const payload: Record<string, unknown> = { text: OFFENDING_URL };
    payload["self"] = payload;
    expect(invalidDatadogHostsInPayload({ payload }).length).toBe(1);
  });

  it("passes a payload linking the correct ap1 console host", () => {
    expect(invalidDatadogHostsInPayload({ payload: { text: "https://ap1.datadoghq.com/monitors/1000001" } })).toEqual(
      [],
    );
  });
});

describe("invalidDatadogHostRefusal", () => {
  it("renders the four-line refusal, naming ap1.datadoghq.com and the hatch", () => {
    const refusal = invalidDatadogHostRefusal({
      command: "slack chat.postMessage",
      hatchIsOpen: closed,
      payload: { text: OFFENDING_URL },
    })!;
    const lines = refusal.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("slack chat.postMessage blocked because");
    expect(lines[0]).toContain("app.ap1.datadoghq.com is not a Datadog console; use ap1.datadoghq.com — found at text");
    expect(lines[2]).toContain("slopweaver hatch open invalid-datadog-console-host");
  });

  it("names each dead host once however often it appears", () => {
    const refusal = invalidDatadogHostRefusal({
      command: "linear commentCreate",
      hatchIsOpen: closed,
      payload: { a: OFFENDING_URL, b: OFFENDING_URL },
    })!;
    expect(refusal.split("use ap1.datadoghq.com").length).toBe(2);
    expect(refusal).toContain("found at a, b");
  });

  it("sends a clean payload without asking the hatch", () => {
    const asked: string[] = [];
    const refusal = invalidDatadogHostRefusal({
      command: "slack chat.postMessage",
      hatchIsOpen: () => {
        asked.push("asked");
        return false;
      },
      payload: { text: "https://ap1.datadoghq.com/monitors/1000001" },
    });
    expect(refusal).toBe(undefined);
    expect(asked).toEqual([]);
  });

  it("sends a dead host when the hatch is open", () => {
    expect(
      invalidDatadogHostRefusal({ command: "slack chat.postMessage", hatchIsOpen: open, payload: OFFENDING_URL }),
    ).toBe(undefined);
  });
});

describe("refuseInvalidDatadogHost", () => {
  it("throws the refusal as its own error class", () => {
    expect(() => {
      refuseInvalidDatadogHost({
        command: "github POST /repos",
        hatchIsOpen: closed,
        payload: { body: OFFENDING_URL },
      });
    }).toThrow(InvalidDatadogHostRefusedError);
  });
});
