/**
 * `readStdin` over an injected async iterable rather than the real stdin: bytes are concatenated BEFORE
 * decoding, so a character split across two chunks survives, and a stream error rejects rather than
 * resolving with the prefix that arrived.
 */
import { describe, expect, it } from "vitest";

import { readStdin } from "../../../lib/readStdin.js";

/** An async iterable yielding the given chunks in order. */
async function* chunksOf({
  chunks,
}: {
  chunks: readonly (string | Uint8Array)[];
}): AsyncGenerator<string | Uint8Array> {
  for (const chunk of chunks) {
    yield await Promise.resolve(chunk);
  }
}

describe("readStdin", () => {
  it("resolves an empty stream to the empty string", async () => {
    await expect(readStdin({ input: chunksOf({ chunks: [] }) })).resolves.toBe("");
  });

  it("joins several chunks in byte order", async () => {
    const input = chunksOf({ chunks: [Buffer.from("first "), "second ", Buffer.from("third")] });

    await expect(readStdin({ input })).resolves.toBe("first second third");
  });

  it("decodes a multibyte character split across two chunks once, after concatenation", async () => {
    const euro = Buffer.from("€", "utf8");
    const input = chunksOf({ chunks: [Buffer.from([0x61, euro[0]!]), Buffer.from([euro[1]!, euro[2]!, 0x62])] });

    await expect(readStdin({ input })).resolves.toBe("a€b");
  });

  it("rejects with the stream's own error rather than resolving with the prefix", async () => {
    const broken = new Error("stdin closed mid-read");
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield await Promise.resolve(Buffer.from("partial"));
      throw broken;
    }

    await expect(readStdin({ input: failing() })).rejects.toBe(broken);
  });
});
