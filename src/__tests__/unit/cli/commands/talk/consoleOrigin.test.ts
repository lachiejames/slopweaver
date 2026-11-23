/**
 * The effectful half of the console-origin gate, over real temp directories: a checkout git cannot confirm is a main
 * worktree is not the owner's console, and a console that is not theirs is refused typing into their chair
 * from any home.
 */
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  consoleWriteRefusal,
  liveHomeReach,
  resolveConsoleOrigin,
  transcriptWriteRefusal,
} from "../../../../../cli/commands/talk/consoleOrigin.js";
import { gitInTemp } from "../../../../tempGitRepo.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const tempDir = ({ prefix }: { prefix: string }): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

describe("resolveConsoleOrigin", () => {
  it("fails closed on a lone .git/HEAD, which reads as a main worktree on disk but git refuses", () => {
    const root = tempDir({ prefix: "sw-origin-fake-" });
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    const origin = resolveConsoleOrigin({
      args: { checkoutRoot: root, defaultPort: 3000, port: 3000 },
      declared: [root],
    });
    expect(origin.mainWorktree).toBe(false);
  });

  it("refuses a linked worktree of a real repository, the shape every seat works in", () => {
    const main = tempDir({ prefix: "sw-origin-repo-" });
    const linked = join(tempDir({ prefix: "sw-origin-linked-" }), "seat");
    gitInTemp({ args: ["init", "--quiet", main], cwd: main });
    gitInTemp({
      args: ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "--allow-empty", "-m", "c"],
      cwd: main,
    });
    gitInTemp({ args: ["worktree", "add", "--quiet", linked], cwd: main });
    expect([
      resolveConsoleOrigin({ args: { checkoutRoot: main, defaultPort: 3000, port: 3000 }, declared: [main, linked] })
        .mainWorktree,
      resolveConsoleOrigin({ args: { checkoutRoot: linked, defaultPort: 3000, port: 3000 }, declared: [main, linked] })
        .mainWorktree,
    ]).toEqual([true, false]);
  });

  it("confirms a main worktree git itself initialised", () => {
    const root = tempDir({ prefix: "sw-origin-main-" });
    gitInTemp({ args: ["init", "--quiet", root], cwd: root });
    expect(
      resolveConsoleOrigin({ args: { checkoutRoot: root, defaultPort: 3000, port: 3000 }, declared: [root] }),
    ).toEqual({
      checkoutRoot: root,
      defaultPort: 3000,
      mainWorktree: true,
      port: 3000,
    });
  });

  it("refuses a main worktree the owner's profile does not declare, as any separate clone is", () => {
    const root = tempDir({ prefix: "sw-origin-clone-" });
    gitInTemp({ args: ["init", "--quiet", root], cwd: root });
    const origin = resolveConsoleOrigin({
      args: { checkoutRoot: root, defaultPort: 3000, port: 3000 },
      declared: [tempDir({ prefix: "sw-origin-owner-" })],
    });
    expect(origin.mainWorktree).toBe(false);
  });

  it("fails closed on a checkout in no repository, so it is never the owner's console", () => {
    const root = tempDir({ prefix: "sw-origin-none-" });
    const origin = resolveConsoleOrigin({
      args: { checkoutRoot: root, defaultPort: 3000, port: 3000 },
      declared: [root],
    });
    expect(origin.mainWorktree).toBe(false);
  });

  it("fails closed on a .git naming a git dir that is not there, as an unreadable linked worktree does", () => {
    const root = tempDir({ prefix: "sw-origin-dangling-" });
    writeFileSync(join(root, ".git"), "gitdir: /nowhere/at/all\n");
    const origin = resolveConsoleOrigin({
      args: { checkoutRoot: root, defaultPort: 3000, port: 3000 },
      declared: [root],
    });
    expect(origin.mainWorktree).toBe(false);
  });
});

describe("liveHomeReach", () => {
  const liveWithCalls = (): string => {
    const live = tempDir({ prefix: "sw-origin-live-" });
    mkdirSync(join(live, "talk", "calls"), { recursive: true });
    writeFileSync(join(live, "talk", "card-landings.jsonl"), "");
    return live;
  };
  const witness = (): { home: string; handoverDir: string } => {
    const home = tempDir({ prefix: "sw-origin-witness-" });
    return { handoverDir: join(home, "handovers"), home };
  };

  it("reaches a live home kept off every default path by the profile.json it holds", () => {
    const live = liveWithCalls();
    writeFileSync(join(live, "profile.json"), "{}");
    const reach = liveHomeReach({
      handoverDir: join(live, "handovers"),
      home: live,
      liveHomes: [tempDir({ prefix: "sw-origin-default-" })],
    });
    expect(reach).toBe(`${realpathSync(live)} holds an install's profile.json, so it is a live home`);
  });

  it("lets a fresh witness home with no profile.json through", () => {
    expect(liveHomeReach({ ...witness(), liveHomes: [tempDir({ prefix: "sw-origin-default-" })] })).toBe(undefined);
  });

  it("reaches the owner's home through a symlink to the home itself", () => {
    const live = liveWithCalls();
    const home = join(tempDir({ prefix: "sw-origin-link-" }), "home");
    symlinkSync(live, home);
    expect(liveHomeReach({ handoverDir: join(home, "handovers"), home, liveHomes: [live] })).toBe(
      `${live} is the owner's live home or inside it`,
    );
  });

  it("reaches it from a home or a handover dir inside it, but not from a sibling that only shares its prefix", () => {
    const live = liveWithCalls();
    const sibling = `${live}-witness`;
    dirs.push(sibling);
    expect([
      liveHomeReach({ handoverDir: join(live, "witness", "h"), home: join(live, "witness"), liveHomes: [live] }),
      liveHomeReach({ handoverDir: join(live, "handovers"), home: sibling, liveHomes: [live] }),
      liveHomeReach({ handoverDir: join(sibling, "h"), home: sibling, liveHomes: [live] }),
    ]).toEqual([
      `${join(live, "witness")} is the owner's live home or inside it`,
      `${join(live, "handovers")} is the owner's live home or inside it`,
      undefined,
    ]);
  });

  it("reaches it from a home inside any of the places the owner's live home could be", () => {
    const moved = liveWithCalls();
    const account = liveWithCalls();
    expect(liveHomeReach({ handoverDir: join(account, "h"), home: account, liveHomes: [moved, account] })).toBe(
      `${account} is the owner's live home or inside it`,
    );
  });

  it("refuses a talk symlink inside a separate home", () => {
    const live = liveWithCalls();
    const { home, handoverDir } = witness();
    symlinkSync(join(live, "talk"), join(home, "talk"));
    expect(liveHomeReach({ handoverDir, home, liveHomes: [live] })).toBe(`${join(home, "talk")} is a symlink`);
  });

  it("refuses a card-landing ledger symlinked into the owner's, a write site no path list named", () => {
    const live = liveWithCalls();
    const { home, handoverDir } = witness();
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    symlinkSync(join(live, "talk", "card-landings.jsonl"), join(home, "talk", "card-landings.jsonl"));
    expect(liveHomeReach({ handoverDir, home, liveHomes: [live] })).toBe(
      `${join(home, "talk", "card-landings.jsonl")} is a symlink`,
    );
  });

  it("refuses a call file with a second hard link, since a hard link has no path to resolve", () => {
    const live = liveWithCalls();
    writeFileSync(join(live, "talk", "calls", "c1.jsonl"), "");
    const { home, handoverDir } = witness();
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    linkSync(join(live, "talk", "calls", "c1.jsonl"), join(home, "talk", "calls", "c1.jsonl"));
    expect(liveHomeReach({ handoverDir, home, liveHomes: [live] })).toBe(
      `${join(home, "talk", "calls", "c1.jsonl")} has a second hard link`,
    );
  });

  it("lets a separate home holding only plain files through", () => {
    const live = liveWithCalls();
    const { home, handoverDir } = witness();
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    writeFileSync(join(home, "talk", "calls", "c1.jsonl"), "{}\n");
    expect(liveHomeReach({ handoverDir, home, liveHomes: [live] })).toBe(undefined);
  });
});

describe("consoleWriteRefusal", () => {
  const seat = { checkoutRoot: "/w/seat", defaultPort: 3000, mainWorktree: false, port: 3001 };

  it("lets a console that is not the owner's write a home it named for itself", () => {
    const home = tempDir({ prefix: "sw-origin-home-" });
    const handoverDir = join(home, "handovers");
    expect(
      consoleWriteRefusal({ handoverDir, home, origin: seat, typesIntoChair: false, verb: "talk transcript" }),
    ).toBe(undefined);
  });

  it("refuses one typing into the owner's chair from that same home, with no hatch to open it", () => {
    const home = tempDir({ prefix: "sw-origin-home-" });
    const refusal = consoleWriteRefusal({
      handoverDir: join(home, "handovers"),
      home,
      origin: seat,
      typesIntoChair: true,
      verb: "talk relay",
    });
    expect(refusal).toContain(
      "talk relay refused: a checkout that is not the owner's main checkout at /w/seat on :3001 (the owner's console is :3000) is not the owner's console",
    );
    expect(refusal).toContain("No hatch opens this");
    expect(refusal).not.toContain("SLOPWEAVER_ALLOW_NON_OWNER_CONSOLE_LIVE_TALK");
  });

  it("refuses an origin no call record can store, even one that reads as the owner's, so its speech never reads unstamped", () => {
    const home = tempDir({ prefix: "sw-origin-home-" });
    const overlong = { ...seat, checkoutRoot: `/${"a".repeat(1001)}`, mainWorktree: true, port: 3000 };
    const refusal = consoleWriteRefusal({
      handoverDir: join(home, "handovers"),
      home,
      origin: overlong,
      typesIntoChair: false,
      verb: "talk transcript",
    });
    expect(refusal).toContain("talk transcript refused: this console's origin");
    expect(refusal).toContain("is not one a call record can store, so its speech would read back as unstamped");
  });

  it("names the link it found when it refuses a home that holds one", () => {
    const home = tempDir({ prefix: "sw-origin-home-" });
    symlinkSync(tempDir({ prefix: "sw-origin-elsewhere-" }), join(home, "talk"));
    const refusal = consoleWriteRefusal({
      handoverDir: join(home, "handovers"),
      home,
      origin: seat,
      typesIntoChair: false,
      verb: "talk transcript",
    });
    expect(refusal).toContain(`: ${join(home, "talk")} is a symlink`);
  });
});

describe("the desktop test instance's writes", () => {
  const testOnOwnerConsole = {
    checkoutRoot: "/w/main",
    defaultPort: 3000,
    instance: "e2e",
    mainWorktree: true,
    port: 3000,
  } as const;
  const linkedHome = (): { home: string; handoverDir: string } => {
    const home = tempDir({ prefix: "sw-origin-home-" });
    symlinkSync(tempDir({ prefix: "sw-origin-elsewhere-" }), join(home, "talk"));
    return { handoverDir: join(home, "handovers"), home };
  };

  it("carries the marker beside the server-derived fields", () => {
    const root = tempDir({ prefix: "sw-origin-fake-" });
    const origin = resolveConsoleOrigin({
      args: { checkoutRoot: root, defaultPort: 3000, instance: "e2e", port: 3000 },
      declared: [],
    });
    expect(origin).toEqual({ checkoutRoot: root, defaultPort: 3000, instance: "e2e", mainWorktree: false, port: 3000 });
  });

  it("lets a transcript through the owner's own console record where any other console would be refused", () => {
    const { home, handoverDir } = linkedHome();
    expect(transcriptWriteRefusal({ handoverDir, home, origin: testOnOwnerConsole })).toBe(undefined);
  });

  it("judges the marker on any other console as that console", () => {
    const { home, handoverDir } = linkedHome();
    const onSeat = { ...testOnOwnerConsole, checkoutRoot: "/w/seat", mainWorktree: false, port: 3001 };
    expect(transcriptWriteRefusal({ handoverDir, home, origin: onSeat })).toContain(
      `: ${join(home, "talk")} is a symlink`,
    );
  });

  it("never types into the owner's chair, even through the owner's own console", () => {
    const home = tempDir({ prefix: "sw-origin-home-" });
    const refusal = consoleWriteRefusal({
      handoverDir: join(home, "handovers"),
      home,
      origin: testOnOwnerConsole,
      typesIntoChair: true,
      verb: "talk relay",
    });
    expect(refusal).toContain(
      "talk relay refused: the desktop e2e test instance, through the owner's main checkout at /w/main on :3000 (the owner's console is :3000) is not the owner's console",
    );
  });
});
