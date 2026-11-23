/**
 * The scripted programs behind the fake Mac's `run` seam: `ps`, `yarn`, `git`, the signing and permission
 * tools, `ditto`, LaunchServices and `open`, each answering the way a case's {@link Behaviour} says. A case's
 * timing knobs hook in here, writing a lease or moving HEAD at exactly the step the install reaches.
 */
import { dirname } from "node:path";

import { err, ok } from "#lib/result.js";
import { APP_SUPPORT, LSREGISTER } from "../../../../../../cli/commands/desktop/installProcess.js";
import type { InstallSeams, ProgramCall } from "../../../../../../cli/commands/desktop/installSeams.js";
import { DesktopInstallErrors } from "../../../../../../desktop/errors.js";
import { BUNDLE_ID, INSTALLED_BUNDLE } from "../../../../../../desktop/installPlan.js";
import { stagePaths } from "../../../../../../desktop/stagedBuild.js";
import {
  type Behaviour,
  DESKTOP_MANIFEST,
  EXPORTED,
  type FakeMac,
  HEAD_ISO,
  LEAF,
  MOVED_SHA,
  NONCE,
  NOW_MS,
  OUTPUT,
  plistOf,
  SHA1,
  under,
  writeLease,
} from "./fakeMac.js";

/** One `lsregister -dump` record, in the shape macOS 27 prints it. */
function dumpRecord({ path }: { path: string }): string {
  return [`path:                       ${path} (0x1648)`, `identifier:                 ${BUNDLE_ID}`].join("\n");
}

/** What the fake LaunchServices answers. */
function launchServices({
  mac,
  call,
  behaviour,
}: {
  mac: FakeMac;
  call: ProgramCall;
  behaviour: Behaviour;
}): ReturnType<InstallSeams["run"]> {
  const [flag, path] = call.args;
  if (flag === "-dump") {
    return ok(
      [INSTALLED_BUNDLE, ...mac.registered].map((each) => dumpRecord({ path: each })).join(`\n${"-".repeat(80)}\n`),
    );
  }
  if (flag === "-u" && path !== behaviour.sticky) {
    mac.registered.delete(path!);
  }
  return ok("");
}

/** A bundle's requirement by the build it holds: only a new build signed as asked carries the leaf. */
function requirementOf({ tag, behaviour }: { tag: string; behaviour: Behaviour }): string {
  return tag === "new" && behaviour.signsAdHoc !== true ? LEAF : `cdhash H"${tag}"`;
}

/** One scripted run of a signing or permission program. */
function signingProgram({
  mac,
  call,
  behaviour,
}: {
  mac: FakeMac;
  call: ProgramCall;
  behaviour: Behaviour;
}): ReturnType<InstallSeams["run"]> {
  const [first] = call.args;
  switch (call.command) {
    case "/usr/bin/security":
      mac.calls.push(`security ${first!}`);
      if (first === "create-keychain") {
        mac.folders.set(call.args.at(-1)!, { mtimeMs: 1, tag: "keychain" });
      }
      return ok(first === "find-certificate" ? `SHA-256 hash: 00\nSHA-1 hash: ${SHA1}\n` : "");
    case "/usr/bin/openssl":
      mac.calls.push("openssl");
      return ok("");
    case "/usr/bin/codesign":
      if (first === "--verify") {
        mac.calls.push("codesign --verify");
        return ok("");
      }
      if (first === "-d") {
        return ok(`# designated => ${requirementOf({ behaviour, tag: mac.folders.get(call.args.at(-1)!)!.tag })}\n`);
      }
      mac.calls.push("codesign --sign");
      return ok("");
    default:
      mac.calls.push(`tccutil ${call.args.join(" ")}`);
      if (behaviour.tccFails === true) {
        return err(DesktopInstallErrors.stepFailed({ command: "tccutil", detail: "exit 1" }));
      }
      return ok("");
  }
}

/** One scripted `yarn` run: `app` writes the built bundle and its Info.plist. */
function yarnProgram({
  mac,
  call,
  behaviour,
}: {
  mac: FakeMac;
  call: ProgramCall;
  behaviour: Behaviour;
}): ReturnType<InstallSeams["run"]> {
  const [first] = call.args;
  if (first === "install" && behaviour.yarnFails === true) {
    return err(DesktopInstallErrors.stepFailed({ command: "yarn install", detail: "exit 1" }));
  }
  if (first === "app") {
    // A build compiling a stale file left in its export carries it: a bundle that is not the plain new build.
    const residue = under({ mac, root: dirname(EXPORTED) }).some((path) => mac.folders.get(path)!.tag !== "exported");
    mac.folders.set(`${OUTPUT}/mac-arm64/Slopweaver.app`, { mtimeMs: 50, tag: residue ? "residue" : "new" });
    mac.files.set(`${OUTPUT}/mac-arm64/Slopweaver.app/Contents/Info.plist`, plistOf({ behaviour, call }));
    if (behaviour.callDuringBuild === true) {
      writeLease({ mac, untilMs: NOW_MS + 30_000 });
    }
  }
  return ok("");
}

/**
 * One scripted `git` run: the desktop files' status against HEAD, a commit's stamp by sha, its committed desktop
 * manifest, else a count.
 */
function gitProgram({
  mac,
  call,
  behaviour,
}: {
  mac: FakeMac;
  call: ProgramCall;
  behaviour: Behaviour;
}): ReturnType<InstallSeams["run"]> {
  mac.gitCalls.push(call.args.join(" "));
  const [first] = call.args;
  if (first === "show") {
    return ok(DESKTOP_MANIFEST);
  }
  if (first === "log") {
    return ok(`${call.args.at(-1)!}\u001f${HEAD_ISO}\n`);
  }
  if (first === "archive") {
    // The export's extraction, modelled at the archive: every literal pathspec lands under the source folder.
    const source = dirname(EXPORTED);
    for (const pathspec of call.args.slice(call.args.indexOf("--") + 1)) {
      mac.folders.set(`${source}/${pathspec.replace(/^:\(literal\)/u, "")}`, { mtimeMs: 1, tag: "exported" });
    }
    return ok("");
  }
  if (first === "status") {
    const claimed = under({ mac, root: stagePaths({ appSupport: APP_SUPPORT, nonce: NONCE }).claimed }).length > 0;
    if (behaviour.headMovesAtClaim === true && claimed) {
      mac.head = MOVED_SHA;
    }
    const edited = behaviour.editedDuringBuild === true && mac.folders.has(`${OUTPUT}/mac-arm64/Slopweaver.app`);
    const dirty = behaviour.dirtyShell === true || edited;
    const change = dirty ? "1 .M N... 100644 100644 100644 a b desktop/src/main.ts\n" : "";
    return ok(`# branch.oid ${mac.head}\n# branch.head main\n${change}`);
  }
  return ok("42\n");
}

/** One scripted copy, launch or registration — the programs a case's timing hooks into. */
function hookedProgram({
  mac,
  call,
  behaviour,
}: {
  mac: FakeMac;
  call: ProgramCall;
  behaviour: Behaviour;
}): ReturnType<InstallSeams["run"]> {
  const [first, second] = call.args;
  if (call.command === "/usr/bin/ditto") {
    mac.folders.set(second!, { mtimeMs: 60, tag: mac.folders.get(first!)!.tag });
    if (behaviour.launchedDuringCopy === true) {
      mac.running.set(501, INSTALLED_BUNDLE);
    }
    return ok("");
  }
  if (call.command === LSREGISTER) {
    if (behaviour.callAfterSwap === true && !mac.running.has(777)) {
      mac.running.set(777, INSTALLED_BUNDLE);
      writeLease({ mac, untilMs: NOW_MS + 30_000 });
    }
    return launchServices({ behaviour, call, mac });
  }
  mac.calls.push("open");
  if (behaviour.callAtOpen === true) {
    mac.running.set(778, "/Users/owner/Desktop/Slopweaver.app");
    writeLease({ mac, untilMs: NOW_MS + 30_000 });
  }
  if (call.args.includes("--checkout") && behaviour.launch === "runs") {
    mac.running.set(900, first!);
    mac.savedCheckout = call.args.at(-1);
  }
  return ok("");
}

/**
 * One scripted program run.
 *
 * @returns what the fake Mac answers for that program, an error where the case's behaviour makes it fail
 */
export function program({
  mac,
  call,
  behaviour,
}: {
  mac: FakeMac;
  call: ProgramCall;
  behaviour: Behaviour;
}): ReturnType<InstallSeams["run"]> {
  switch (call.command) {
    case "/bin/ps":
      return ok(
        [...mac.running].map(([pid, bundle]) => `${String(pid)} ${bundle}/Contents/MacOS/Slopweaver`).join("\n"),
      );
    case "yarn":
      return yarnProgram({ behaviour, call, mac });
    case "git":
      return gitProgram({ behaviour, call, mac });
    case "/usr/bin/security":
    case "/usr/bin/openssl":
    case "/usr/bin/codesign":
    case "/usr/bin/tccutil":
      return signingProgram({ behaviour, call, mac });
    case "/usr/bin/plutil":
      return ok(
        behaviour.stagedForeignId === true && call.args.at(-1)!.includes("/claimed-") ? "com.other.app" : BUNDLE_ID,
      );
    case "/usr/bin/ditto":
    case LSREGISTER:
    case "/usr/bin/open":
      return hookedProgram({ behaviour, call, mac });
    case "/usr/bin/mdutil":
      return ok("/:\n\tIndexing and searching disabled.");
    case "/bin/test":
      mac.calls.push(`test ${call.args.join(" ")}`);
      if (behaviour.helperMissing === true) {
        return err(
          DesktopInstallErrors.stepFailed({ command: `/bin/test ${call.args.join(" ")}`, detail: "exit 1: " }),
        );
      }
      return ok("");
    default:
      return ok("");
  }
}
