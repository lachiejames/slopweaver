import { describe, expect, it } from "vitest";

import { type TeeableStream, teeWrites } from "../../../lib/writeTee.js";

/** A plain stream that records every `write` call's arguments — a seam, not a mock. */
function recordingStream(): TeeableStream & { readonly calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    write: (...args: unknown[]): boolean => {
      calls.push(args);
      return true;
    },
  };
}

describe("teeWrites", () => {
  it("passes every write through unchanged and hands back what was written beside the run's value", async () => {
    const stream = recordingStream();
    const done = (): void => undefined;
    const { text, value } = await teeWrites({
      keepChars: 1024,
      run: () => {
        stream.write("first line\n");
        stream.write(new TextEncoder().encode("second line\n"), done);
        return Promise.resolve(7);
      },
      stream,
    });
    expect(value).toBe(7);
    expect(text).toBe("first line\nsecond line\n");
    expect(stream.calls).toEqual([["first line\n"], [new TextEncoder().encode("second line\n"), done]]);
  });

  it("decodes a character whose UTF-8 bytes were split across two writes whole", async () => {
    const stream = recordingStream();
    const bytes = new TextEncoder().encode("read: €\n");
    const { text } = await teeWrites({
      keepChars: 1024,
      run: () => {
        stream.write(bytes.subarray(0, 7));
        stream.write(bytes.subarray(7));
        return Promise.resolve(1);
      },
      stream,
    });
    expect(text).toBe("read: €\n");
  });

  it("keeps bytes written through any byte view a stream accepts, a DataView and a non-byte typed array included", async () => {
    const stream = recordingStream();
    const { text } = await teeWrites({
      keepChars: 1024,
      run: () => {
        stream.write(new DataView(Uint8Array.of(0x41, 0x0a).buffer));
        stream.write(new Uint16Array(Uint8Array.of(0x42, 0x43).buffer));
        return Promise.resolve(1);
      },
      stream,
    });
    expect(text).toBe("A\nBC");
  });

  it("keeps write order when a string lands between the halves of a split character", async () => {
    const stream = recordingStream();
    const { text } = await teeWrites({
      keepChars: 1024,
      run: () => {
        stream.write(Uint8Array.of(0xe2, 0x82));
        stream.write("X");
        stream.write(Uint8Array.of(0xac, 0x0a));
        return Promise.resolve(1);
      },
      stream,
    });
    expect(text).toBe("�X�\n");
  });

  it("never opens the kept tail on the low half of a character the cut split", async () => {
    const stream = recordingStream();
    const { text } = await teeWrites({
      keepChars: 3,
      run: () => {
        stream.write("a😀bc");
        return Promise.resolve(1);
      },
      stream,
    });
    expect(text).toBe("bc");
  });

  it("keeps only the last keepChars characters", async () => {
    const stream = recordingStream();
    const { text } = await teeWrites({
      keepChars: 5,
      run: () => {
        stream.write("abcdefgh");
        stream.write("ij");
        return Promise.resolve(0);
      },
      stream,
    });
    expect(text).toBe("fghij");
  });

  it("puts the original write back after the run resolves", async () => {
    const stream = recordingStream();
    const original = stream.write;
    await teeWrites({ keepChars: 10, run: () => Promise.resolve(0), stream });
    expect(stream.write).toBe(original);
  });

  it("puts the original write back when the run throws, and lets the throw through", async () => {
    const stream = recordingStream();
    const original = stream.write;
    await expect(
      teeWrites({ keepChars: 10, run: () => Promise.reject(new Error("dispatcher blew up")), stream }),
    ).rejects.toThrow("dispatcher blew up");
    expect(stream.write).toBe(original);
  });
});
