/**
 * `InstallSeams` answered by a fake Mac rather than the machine: the folder listing, moves and deletes, the
 * clock, the text files and the program runner. The install's real logic runs unchanged on top of these, so a
 * case proves the shipped behaviour rather than a restatement of it.
 */
import { ok } from "#lib/result.js";
import { STATE_FILE } from "../../../../../../cli/commands/desktop/installProcess.js";
import type { InstallSeams } from "../../../../../../cli/commands/desktop/installSeams.js";
import { stagedBundle } from "../../../../../../desktop/stagedBuild.js";
import {
  type Behaviour,
  type FakeMac,
  fsError,
  MAIN,
  MOVED_SHA,
  NONCE,
  NOW_MS,
  OUTPUT,
  READY,
  stagedPlist,
  under,
} from "./fakeMac.js";
import { program } from "./programs.js";

/** The seams that list, test and move the fake Mac's folders, and name the main checkout. */
function folderSeams({
  mac,
  behaviour,
}: {
  mac: FakeMac;
  behaviour: Behaviour;
}): Pick<InstallSeams, "entries" | "exists" | "mainCheckout" | "names" | "move"> {
  return {
    entries: ({ path }) =>
      [...mac.folders]
        .filter(([folder]) => folder.startsWith(`${path}/`) && !folder.slice(path.length + 1).includes("/"))
        .map(([folder, { mtimeMs }]) => ({ mtimeMs, name: folder.slice(path.length + 1) })),
    exists: ({ path }) =>
      path === STATE_FILE ? mac.savedCheckout !== undefined : mac.folders.has(path) || mac.files.has(path),
    mainCheckout: () => ok(MAIN),
    names: ({ path }) => {
      if (!mac.folders.has(path)) {
        throw fsError({ code: "ENOENT", path });
      }
      return [...mac.folders.keys()]
        .filter((folder) => folder.startsWith(`${path}/`) && !folder.slice(path.length + 1).includes("/"))
        .map((folder) => folder.slice(path.length + 1));
    },
    move: ({ from, to }) => {
      const moving = under({ mac, root: from });
      if (moving.length === 0 || from === behaviour.unmovable) {
        throw new Error(`no such folder: ${from}`);
      }
      for (const path of moving) {
        mac.folders.set(`${to}${path.slice(from.length)}`, mac.folders.get(path)!);
        mac.folders.delete(path);
      }
      for (const [path, text] of [...mac.files].filter(([file]) => file.startsWith(`${from}/`))) {
        mac.files.set(`${to}${path.slice(from.length)}`, text);
        mac.files.delete(path);
      }
      if (behaviour.stageReplacedAtClaim === true && from === READY) {
        mac.files.set(`${stagedBundle({ folder: to })}/Contents/Info.plist`, stagedPlist({ sha: MOVED_SHA }));
      }
    },
  };
}

/** The seams for the clock, the output, quitting, text files, deletes and every program the install runs. */
function machineFakeSeams({
  mac,
  behaviour,
}: {
  mac: FakeMac;
  behaviour: Behaviour;
}): Omit<InstallSeams, "entries" | "exists" | "mainCheckout" | "names" | "move"> {
  return {
    nonce: NONCE,
    nowMs: () => NOW_MS,
    out: ({ line }) => {
      mac.lines.push(line);
    },
    pause: async () => {},
    quit: ({ pid }) => {
      if (behaviour.stubborn !== true) {
        mac.running.delete(pid);
      }
    },
    readText: ({ path }) =>
      path === STATE_FILE ? JSON.stringify({ checkout: mac.savedCheckout }) : mac.files.get(path)!,
    remove: ({ path }) => {
      if (path === behaviour.undeletable) {
        throw new Error(`EPERM: ${path}`);
      }
      for (const inside of under({ mac, root: path })) {
        mac.folders.delete(inside);
      }
    },
    run: (call) => program({ behaviour, call, mac }),
    runningRoot: () => "/repo",
    tempFolder: () => {
      mac.folders.set(OUTPUT, { mtimeMs: 40, tag: "temp" });
      return OUTPUT;
    },
    writeText: ({ path, text }) => {
      mac.files.set(path, text);
    },
  };
}

/**
 * The seams over a fake Mac.
 *
 * @returns every install seam, each reading or changing that fake Mac as the case's behaviour says
 */
export function fakeSeams({ mac, behaviour }: { mac: FakeMac; behaviour: Behaviour }): InstallSeams {
  return { ...folderSeams({ behaviour, mac }), ...machineFakeSeams({ behaviour, mac }) };
}
