/**
 * The websocket adapter, driven through its `seams` with a plain fake socket and a fake timer: no network,
 * no real `WebSocket`, no real clock. What is pinned is the registration order, which events end the queue
 * and why, the two literal timer bounds, and what each close path asks of the socket.
 */
import { describe, expect, it } from "vitest";

import {
  openSocketConnection,
  type SocketWireEvent,
  type WireSeams,
  type WireSocket,
} from "../../../../live/listen/wire.js";

/** One armed fake timer: what it was armed for, and whether it was disarmed. */
interface ArmedTimer {
  readonly ms: number;
  readonly onElapsed: () => void;
  disarmed: boolean;
}

/** The fake socket and timer, plus everything they recorded. */
interface FakeWire {
  readonly seams: WireSeams;
  readonly urls: string[];
  readonly registrations: SocketWireEvent[];
  readonly sent: string[];
  readonly timers: ArmedTimer[];
  readonly closes: { count: number };
}

/** Build a fake socket that records each registration and a fake timer that records each arming. */
function fakeWire(): FakeWire {
  const urls: string[] = [];
  const registrations: SocketWireEvent[] = [];
  const sent: string[] = [];
  const timers: ArmedTimer[] = [];
  const closes = { count: 0 };
  const socket: WireSocket = {
    close: () => {
      closes.count += 1;
    },
    on: (event) => {
      registrations.push(event);
    },
    send: ({ text }) => {
      sent.push(text);
    },
  };
  const openSocket: WireSeams["openSocket"] = ({ url }) => {
    urls.push(url);
    return socket;
  };
  const setTimer: WireSeams["setTimer"] = ({ ms, onElapsed }) => {
    const armed: ArmedTimer = { disarmed: false, ms, onElapsed };
    timers.push(armed);
    return () => {
      armed.disarmed = true;
    };
  };
  return { closes, registrations, seams: { openSocket, setTimer }, sent, timers, urls };
}

/** Fire every registered `open` listener. */
function fireOpen({ registrations }: { registrations: readonly SocketWireEvent[] }): void {
  for (const event of registrations) {
    if (event.type === "open") {
      event.listener();
    }
  }
}

/** Fire every registered `error` listener. */
function fireError({ registrations }: { registrations: readonly SocketWireEvent[] }): void {
  for (const event of registrations) {
    if (event.type === "error") {
      event.listener();
    }
  }
}

/** Fire every registered `message` listener with one frame's data. */
function fireMessage({ data, registrations }: { data: unknown; registrations: readonly SocketWireEvent[] }): void {
  for (const event of registrations) {
    if (event.type === "message") {
      event.listener({ data });
    }
  }
}

/** Fire every registered `close` listener with one close code. */
function fireClose({ code, registrations }: { code: number; registrations: readonly SocketWireEvent[] }): void {
  for (const event of registrations) {
    if (event.type === "close") {
      event.listener({ code });
    }
  }
}

/** Drain a connection's frames into an array. */
async function drain({ frames }: { frames: AsyncIterable<string> }): Promise<string[]> {
  const seen: string[] = [];
  for await (const text of frames) {
    seen.push(text);
  }
  return seen;
}

describe("openSocketConnection", () => {
  it("opens the given url, registers message, close and error, then open and error, and arms a 15000ms open timer", async () => {
    const wire = fakeWire();
    const pending = openSocketConnection({ seams: wire.seams, url: "wss://wire.example/link?ticket=1" });
    fireOpen({ registrations: wire.registrations });
    const connection = (await pending)!;

    expect(connection.endedBecause()).toBe(undefined);
    expect(wire.urls).toEqual(["wss://wire.example/link?ticket=1"]);
    expect(wire.registrations.map((event) => event.type)).toEqual(["message", "close", "error", "open", "error"]);
    expect(wire.timers.map((timer) => ({ disarmed: timer.disarmed, ms: timer.ms }))).toEqual([
      { disarmed: true, ms: 15000 },
    ]);
    expect(wire.closes.count).toBe(0);
  });

  it("forwards string frames in order, ignores a non-string frame, and drains the buffer when the socket closes", async () => {
    const wire = fakeWire();
    const pending = openSocketConnection({ seams: wire.seams, url: "wss://wire.example/a" });
    fireOpen({ registrations: wire.registrations });
    const connection = (await pending)!;
    fireMessage({ data: "first", registrations: wire.registrations });
    fireMessage({ data: new Uint8Array([1, 2]), registrations: wire.registrations });
    fireMessage({ data: "second", registrations: wire.registrations });
    fireClose({ code: 1006, registrations: wire.registrations });

    expect(await drain({ frames: connection.frames() })).toEqual(["first", "second"]);
    expect(connection.endedBecause()).toBe("the socket closed (code 1006)");
    expect(connection.discarded()).toBe(0);
  });

  it("acknowledges an envelope by sending its id as one JSON object", async () => {
    const wire = fakeWire();
    const pending = openSocketConnection({ seams: wire.seams, url: "wss://wire.example/a" });
    fireOpen({ registrations: wire.registrations });
    const connection = (await pending)!;
    connection.acknowledge({ envelopeId: "env-7" });

    expect(wire.sent).toEqual(['{"envelope_id":"env-7"}']);
  });

  it("an error after open ends the stream with the error reason", async () => {
    const wire = fakeWire();
    const pending = openSocketConnection({ seams: wire.seams, url: "wss://wire.example/a" });
    fireOpen({ registrations: wire.registrations });
    const connection = (await pending)!;
    fireMessage({ data: "kept", registrations: wire.registrations });
    fireError({ registrations: wire.registrations });

    expect(await drain({ frames: connection.frames() })).toEqual(["kept"]);
    expect(connection.endedBecause()).toBe("the socket reported an error");
  });

  it("close drains buffered frames, asks the socket to close once, and resolves when the socket confirms", async () => {
    const wire = fakeWire();
    const pending = openSocketConnection({ seams: wire.seams, url: "wss://wire.example/a" });
    fireOpen({ registrations: wire.registrations });
    const connection = (await pending)!;
    fireMessage({ data: "buffered", registrations: wire.registrations });
    const closing = connection.close({ why: "--once handled its turn" });
    fireClose({ code: 1000, registrations: wire.registrations });
    await closing;

    expect(wire.closes.count).toBe(1);
    expect(wire.timers.map((timer) => ({ disarmed: timer.disarmed, ms: timer.ms }))).toEqual([
      { disarmed: true, ms: 15000 },
      { disarmed: true, ms: 2000 },
    ]);
    expect(await drain({ frames: connection.frames() })).toEqual(["buffered"]);
    expect(connection.endedBecause()).toBe("--once handled its turn");
  });

  it("close resolves when its 2000ms bound elapses with no confirmation from the socket", async () => {
    const wire = fakeWire();
    const pending = openSocketConnection({ seams: wire.seams, url: "wss://wire.example/a" });
    fireOpen({ registrations: wire.registrations });
    const connection = (await pending)!;
    const closing = connection.close({ why: "signal" });
    const bound = wire.timers[1]!;
    bound.onElapsed();
    await closing;

    expect(bound.ms).toBe(2000);
    expect(bound.disarmed).toBe(false);
    expect(wire.closes.count).toBe(1);
  });

  it("cancel discards buffered frames, counts them, and asks the socket to close once", async () => {
    const wire = fakeWire();
    const pending = openSocketConnection({ seams: wire.seams, url: "wss://wire.example/a" });
    fireOpen({ registrations: wire.registrations });
    const connection = (await pending)!;
    fireMessage({ data: "one", registrations: wire.registrations });
    fireMessage({ data: "two", registrations: wire.registrations });
    const cancelling = connection.cancel({ why: "the deadline won" });
    fireClose({ code: 1000, registrations: wire.registrations });
    await cancelling;

    expect(await drain({ frames: connection.frames() })).toEqual([]);
    expect(connection.discarded()).toBe(2);
    expect(connection.endedBecause()).toBe("the deadline won");
    expect(wire.closes.count).toBe(1);
    expect(wire.timers.map((timer) => timer.ms)).toEqual([15000, 2000]);
  });

  it("an error before open resolves undefined, disarms the open timer, and makes no close request", async () => {
    const wire = fakeWire();
    const pending = openSocketConnection({ seams: wire.seams, url: "wss://wire.example/a" });
    fireError({ registrations: wire.registrations });

    expect(await pending).toBe(undefined);
    expect(wire.timers.map((timer) => ({ disarmed: timer.disarmed, ms: timer.ms }))).toEqual([
      { disarmed: true, ms: 15000 },
    ]);
    expect(wire.closes.count).toBe(0);
    expect(wire.sent).toEqual([]);
  });

  it("an abort before open resolves undefined, closes the socket once, and disarms the open timer", async () => {
    const wire = fakeWire();
    const controller = new AbortController();
    const pending = openSocketConnection({ seams: wire.seams, signal: controller.signal, url: "wss://wire.example/a" });
    controller.abort();

    expect(await pending).toBe(undefined);
    expect(wire.closes.count).toBe(1);
    expect(wire.timers.map((timer) => ({ disarmed: timer.disarmed, ms: timer.ms }))).toEqual([
      { disarmed: true, ms: 15000 },
    ]);
  });

  it("the open timer elapsing resolves undefined and closes the socket once", async () => {
    const wire = fakeWire();
    const pending = openSocketConnection({ seams: wire.seams, url: "wss://wire.example/a" });
    wire.timers[0]!.onElapsed();

    expect(await pending).toBe(undefined);
    expect(wire.closes.count).toBe(1);
    expect(wire.timers.map((timer) => timer.ms)).toEqual([15000]);
  });
});
