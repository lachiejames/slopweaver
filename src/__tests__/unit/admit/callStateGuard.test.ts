/**
 * The call-state tripwire: a hand-run command that would delete, move or overwrite a live home's console-voice call
 * state is refused — the incident command first, verbatim but for its home — and a read, an append, a copy
 * OUT, a sibling file, a throwaway home and an expansion the guard cannot know all pass.
 *
 * Resolution is lexical, so the homes are plain absolute strings and no filesystem is touched — bar `CDPATH`, which
 * bash resolves by testing each entry on disk, so its cases build a real temp home.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { callStatePaths, evaluateCallStateGuard, reachesProtected } from "../../../admit/callStateGuard.js";
import { callStateRefusal, runCallStateGuard } from "../../../admit/callStateGuardRunner.js";
import { accountDefaultHome } from "../../../homeDir.js";

const USER = "/fixture/users/dev";
const HOME = `${USER}/.slopweaver`;
const THROWAWAY = "/fixture/tmp/e2e-home";
const CALLS = `${HOME}/talk/calls`;
const INDEX = `${HOME}/talk/call-index.txt`;
const CURSORS = `${HOME}/talk/unread-cursors`;
const LEDGER = `${HOME}/talk/call-quarantine.jsonl`;
const THREADS = `${HOME}/talk/threads`;
const WORK = "/fixture/work";
const ENV = { HOME: USER, SLOPWEAVER_HOME: HOME };

/** The seven ids the incident's `rm` removed, in the order it named them. */
const INCIDENT_IDS = [
  "f1edcbb1-553c-4a21-a21b-a1bb8a62b630",
  "8d74b96f-f72d-4135-be24-b78897fa3926",
  "dde2f4a9-3c83-4cae-9d43-c6bd847ce1be",
  "e4c86495-1951-469d-81c7-3043be13705e",
  "0d33866b-bbcf-4e62-8dc1-250c2dd54835",
  "8108e3d7-b766-4b66-a0d0-3b52a225ef23",
  "8130aa5b-9a39-42b0-a86b-169a1f271d95",
];

/** Judge one command from one directory, protecting the live fixture home. */
function judge({
  command,
  cwd = WORK,
  homes = [HOME],
}: {
  command: string;
  cwd?: string;
  homes?: readonly string[];
}): ReturnType<typeof evaluateCallStateGuard> {
  return evaluateCallStateGuard({ command, cwd, env: ENV, homes });
}

describe("callStatePaths", () => {
  it("names the four witnesses of one home, and its call-thread journals", () => {
    expect(callStatePaths({ home: HOME })).toEqual([CALLS, INDEX, CURSORS, LEDGER, THREADS]);
  });

  it("refuses an rm of a call's thread journal", () => {
    expect(judge({ command: `rm ${THREADS}/x.jsonl` })?.protectedPath).toBe(THREADS);
  });
});

describe("evaluateCallStateGuard", () => {
  it.each([
    ["a directory an earlier cd left", `cd ${CALLS} && cd /tmp && rm ~-/live.jsonl`],
    ["one of several the chain stood in", `cd ${CALLS} && cd /tmp && cd /var && rm -rf ~-`],
  ])("refuses an rm under ~- naming %s", (_label, command) => {
    expect(judge({ command })?.protectedPath).toBe(CALLS);
  });

  it("refuses an rm under ~- naming the $OLDPWD the session inherited", () => {
    const env = { ...ENV, OLDPWD: CALLS };

    expect(evaluateCallStateGuard({ command: "rm ~-/live.jsonl", cwd: WORK, env, homes: [HOME] })?.protectedPath).toBe(
      CALLS,
    );
  });

  it("allows an rm under ~- in a throwaway home, and with no $OLDPWD to name", () => {
    const env = { ...ENV, OLDPWD: `${THROWAWAY}/talk/calls` };

    expect([
      judge({ command: `cd ${THROWAWAY}/talk/calls && cd /tmp && rm ~-/live.jsonl` }),
      evaluateCallStateGuard({ command: "rm ~-/live.jsonl", cwd: WORK, env, homes: [HOME] }),
      judge({ command: "rm ~-/live.jsonl" }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("allows a sequence brace over a throwaway home's talk directory", () => {
    expect(judge({ command: `cd ${THROWAWAY} && rm -rf tal{k..l}` })).toBe(undefined);
  });

  it("allows a named-user tilde when the guarded home is a throwaway one", () => {
    const command = "rm ~dev/.slopweaver/talk/call-index.txt";
    expect(judge({ command, homes: [THROWAWAY] })).toBe(undefined);
  });

  it("allows a brace-expanded program in a throwaway home, and a test command on the live index", () => {
    expect([
      judge({ command: `cd ${THROWAWAY}/talk/calls && r{m,m} victim.jsonl` }),
      judge({ command: `[ -f ${HOME}/talk/call-index.txt ]` }),
      judge({ command: `cd ${WORK} && $EDITOR notes.md` }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("refuses a cd through a HOME the command assigns itself, from a throwaway hook environment", () => {
    const env = { HOME: "/fixture/model-user", SLOPWEAVER_HOME: THROWAWAY };
    expect([
      evaluateCallStateGuard({
        command: `HOME=${USER}; cd "$HOME/.slopweaver/talk/calls" && rm live.jsonl`,
        cwd: WORK,
        env,
        homes: [HOME],
      })?.protectedPath,
      evaluateCallStateGuard({
        command: `export SLOPWEAVER_HOME=${HOME}; rm "$SLOPWEAVER_HOME"/talk/call-index.txt`,
        cwd: WORK,
        env,
        homes: [HOME],
      })?.protectedPath,
      evaluateCallStateGuard({
        command: `HOME=${USER}; rm ~/.slopweaver/talk/call-index.txt`,
        cwd: WORK,
        env,
        homes: [HOME],
      })?.protectedPath,
    ]).toEqual([CALLS, INDEX, INDEX]);
  });

  it("refuses a git restore whose work tree an inherited or exported GIT_WORK_TREE points at the live home", () => {
    const command = "cd /fixture/repo && git restore -- talk/call-index.txt";
    expect([
      evaluateCallStateGuard({ command, cwd: WORK, env: { ...ENV, GIT_WORK_TREE: HOME }, homes: [HOME] })
        ?.protectedPath,
      judge({ command: `export GIT_WORK_TREE=${HOME}; ${command}` })?.protectedPath,
    ]).toEqual([CALLS, CALLS]);
  });

  it("allows a git restore under an inherited GIT_WORK_TREE in a throwaway home, and with none", () => {
    const command = "cd /fixture/repo && git restore -- talk/call-index.txt";
    expect([
      evaluateCallStateGuard({ command, cwd: WORK, env: { ...ENV, GIT_WORK_TREE: THROWAWAY }, homes: [HOME] }),
      judge({ command }),
      evaluateCallStateGuard({
        command: `rm ${WORK}/x`,
        cwd: WORK,
        env: { ...ENV, GIT_WORK_TREE: HOME },
        homes: [HOME],
      }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("allows a find -delete with no starting point in a throwaway home, and a plain find in the live one", () => {
    expect([
      judge({ command: `cd ${THROWAWAY}/talk/calls && find -delete` }),
      judge({ command: `cd ${CALLS} && find -name '*.jsonl'` }),
    ]).toEqual([undefined, undefined]);
  });

  it("allows a find {} embedded in an -exec rm's path into a throwaway home", () => {
    const command = `cd /fixture/tmp && find . -name calls -exec rm -rf ${THROWAWAY}/talk/{} \\;`;
    expect(judge({ command })).toBe(undefined);
  });

  it("allows a globstar spanning only a throwaway home", () => {
    expect(judge({ command: "shopt -s globstar; cd /fixture && rm tmp/**/talk/call-index.txt" })).toBe(undefined);
  });

  it("allows a HOME the command assigns to a throwaway user", () => {
    const env = { HOME: "/fixture/model-user", SLOPWEAVER_HOME: THROWAWAY };
    const command = `HOME=/fixture/users/other; cd "$HOME/.slopweaver/talk/calls" && rm live.jsonl`;
    expect(evaluateCallStateGuard({ command, cwd: WORK, env, homes: [HOME] })).toBe(undefined);
  });

  it("allows an inline git alias for reset --hard in a throwaway home", () => {
    expect(judge({ command: `cd ${THROWAWAY} && git -c 'alias.nuke=reset --hard' nuke` })).toBe(undefined);
  });

  it("refuses the incident command — one rm of seven call files — on its first operand", () => {
    const command = `rm ${INCIDENT_IDS.map((id) => `${CALLS}/${id}.jsonl`).join(" ")}`;

    expect(judge({ command })).toEqual({
      operand: `${CALLS}/${INCIDENT_IDS[0]}.jsonl`,
      others: INCIDENT_IDS.slice(1).map((id) => `${CALLS}/${id}.jsonl`),
      protectedPath: CALLS,
      segment: command,
    });
  });

  it("allows a relative rm after a bare cd when $HOME holds only a throwaway home", () => {
    const command = "cd && rm .slopweaver/talk/calls/live.jsonl";

    expect(judge({ command, homes: [THROWAWAY] })).toBeUndefined();
  });

  it("names a live operand hiding behind a throwaway first hit, since a hatch exempts the whole segment", () => {
    const command = `rm ${THROWAWAY}/talk/calls/test.jsonl ${CALLS}/live.jsonl`;
    const hit = judge({ command, homes: [THROWAWAY, HOME] })!;

    expect(hit.others).toEqual([`${CALLS}/live.jsonl`]);
    expect(callStateRefusal({ hit })).toContain(`and also ${CALLS}/live.jsonl`);
  });

  it.each([
    ["an ancestor, recursively", `rm -rf ${HOME}/talk`, CALLS],
    ["the home through ~", "rm -rf ~/.slopweaver", CALLS],
    ["the index through a quoted $SLOPWEAVER_HOME", 'rm "$SLOPWEAVER_HOME"/talk/call-index.txt', INDEX],
    ["the index through ${HOME}", "unlink ${HOME}/.slopweaver/talk/call-index.txt", INDEX],
    ["a moved call file", `mv ${CALLS}/a.jsonl /fixture/tmp/a.jsonl`, CALLS],
    ["a copy over the index", `cp /fixture/tmp/x ${INDEX}`, INDEX],
    ["a copy into the calls directory by -t", `cp -t ${CALLS} /fixture/tmp/x`, CALLS],
    [
      "an attached, quoted -t naming the home by variable, after a cd",
      'cd /tmp && cp -t"$SLOPWEAVER_HOME/talk/calls" /fixture/tmp/x.jsonl',
      CALLS,
    ],
    ["an attached, quoted --target-directory=", 'cp --target-dir="$SLOPWEAVER_HOME/talk/calls" /fixture/tmp/x', CALLS],
    ["a truncating redirect", `echo > ${INDEX}`, INDEX],
    ["a numbered attached redirect", `printf x 2>${INDEX}`, INDEX],
    ["an &> redirect", `true &> ${INDEX}`, INDEX],
    ["a >| clobber", `: >| ${CALLS}/x.jsonl`, CALLS],
    ["a dd of= over a call file", `dd if=/dev/null of=${CALLS}/x.jsonl`, CALLS],
    ["a relative rm after a cd into the home by ~", "cd ~/.slopweaver/talk/calls && rm live.jsonl", CALLS],
    ["a relative rm after a bare cd, which goes to $HOME", "cd && rm .slopweaver/talk/calls/live.jsonl", CALLS],
    ["a relative rm after a bare cd -P --", "cd -P -- && rm -rf .slopweaver/talk", CALLS],
    ["a relative rm after a cd -P", `cd -P ${CALLS} && rm stale.jsonl`, CALLS],
    ["a negated rm after a cd", `cd ${CALLS} && ! rm stale.jsonl`, CALLS],
    ["an rm in a case arm after a cd", `cd ${CALLS} && case x in x) rm stale.jsonl;; esac`, CALLS],
    ["an rm under env -C after a cd", `cd ${HOME}/talk && env -C calls rm stale.jsonl`, CALLS],
    ["an rm under nested env -C after a cd", `cd /tmp && env -C ${HOME}/talk env -C calls rm -f live.jsonl`, CALLS],
    ["an rm under env --chdir= then -C", `cd /tmp && env --chdir=${HOME} env -C talk/calls rm live.jsonl`, CALLS],
    ["an rm env -S splits out after a cd", `cd ${CALLS} && env -S "rm x.jsonl"`, CALLS],
    ["an rm an attached -S splits out", `env -i -S'rm ${CALLS}/x.jsonl'`, CALLS],
    ["an rm a clustered -iS splits out", `env -iS "rm ${INDEX}"`, INDEX],
    ["an rm --split-string= splits out", `env --split-string="rm ${INDEX}"`, INDEX],
    ["an rm an abbreviated --split splits out", `env --split "rm ${INDEX}"`, INDEX],
    ["an rm a nested -S splits out", `env -S "env -S 'rm ${INDEX}'"`, INDEX],
    ["a -C inside a split string", `cd /tmp && env -S "-C ${HOME}/talk rm call-index.txt"`, INDEX],
    ["a find -exec of env -S rm", `find ${CALLS} -exec env -S "rm" {} +`, CALLS],
    ["a one-operand ln -f linking into a call directory", `cd ${CALLS} && ln -f /fixture/tmp/x.jsonl`, CALLS],
    ["a git rm of a tracked call file", `git -C ${HOME} rm -f -- talk/calls/x.jsonl`, CALLS],
    [
      "a git rm whose dry run a later --no-dry-run undoes",
      `cd ${HOME} && git rm -n --no-dry-run -f -- talk/calls/x.jsonl`,
      CALLS,
    ],
    ["a git reset --hard in the home", `git -C ${HOME} reset --hard`, CALLS],
    ["a git -C $PWD reset --hard after a cd", `cd "$SLOPWEAVER_HOME" && git -C "$PWD" reset --hard`, CALLS],
    ["a git -C ${PWD}/talk clean after a cd", `cd ${HOME} && git -C \${PWD}/talk clean -fdx`, CALLS],
    ["a git -C $SLOPWEAVER_HOME reset --hard", 'git -C "$SLOPWEAVER_HOME" reset --hard', CALLS],
    ["a git -C ~/.slopweaver checkout -f", "git -C ~/.slopweaver checkout -f", CALLS],
    ["a relative rm after a cd by $PWD", `cd ${HOME} && cd "$PWD/talk/calls" && rm x.jsonl`, CALLS],
    ["a git restore into a configured work tree", `cd /tmp && git -c core.worktree=${HOME} restore -- talk/x`, CALLS],
    ["a wrapped git -C restore", `cd /tmp && command git -C ${HOME} restore -- talk/call-index.txt`, INDEX],
    ["a clustered forced checkout after a cd", `cd ${HOME} && git checkout -fq old`, CALLS],
    ["a top-rooted git pathspec after a cd", `cd ${HOME} && git restore :/talk/calls/live.jsonl`, CALLS],
    ["a descriptor-less >& onto the index", `cd ${HOME}/talk && : >& call-index.txt`, `${HOME}/talk/call-index.txt`],
    ["a relative rm after a cd by $SLOPWEAVER_HOME", 'cd "$SLOPWEAVER_HOME/talk" && rm call-index.txt', INDEX],
    ["a call file named by a variable", 'rm "$SLOPWEAVER_HOME/talk/calls/$id.jsonl"', CALLS],
    ["a call file named by a variable below a literal path", `rm ${CALLS}/"$id".jsonl`, CALLS],
    ["a call file named by a command substitution", `rm ${CALLS}/$(cat /fixture/tmp/ids)`, CALLS],
    ["a home directory named by a variable", `rm -rf ${HOME}/$DIR`, CALLS],
    ["a parameter default after a cd", `cd ${CALLS} && rm "\${UNSET:-live.jsonl}"`, CALLS],
    ["a tilde path holding a variable", "rm ~/.slopweaver/talk/$WHAT", CALLS],
    ["a git clean whose glob pathspec holds an unknown expansion", `git -C ${HOME} clean -fd -- "$OTHER*.tmp"`, CALLS],
    [
      "a relative rm after a cd by a quoted variable and suffix",
      'cd "$SLOPWEAVER_HOME"/talk/calls && rm x.jsonl',
      CALLS,
    ],
    ["a quoted dd of= over the index", `dd if=/dev/null 'of=${INDEX}'`, INDEX],
    ["a find -delete", `find ${CALLS} -name '*.jsonl' -delete`, CALLS],
    ["a find -exec rm", `find ${HOME}/talk -type f -exec rm {} +`, CALLS],
    ["a find -exec of a wrapped rm", `find ${CALLS} -exec env rm -f {} +`, CALLS],
    ["a find -exec mv out of the home", `find ${CALLS} -name '*.jsonl' -exec mv {} /fixture/tmp/old/ \\;`, CALLS],
    ["a find -delete after its leading -H", `find -H ${CALLS} -type f -delete`, CALLS],
    ["a find -delete whose BSD -f names the start", `find -x -f ${CALLS} -delete`, CALLS],
    ["a no-clobber cp a later -f outranks, after a cd", `cd ${HOME}/talk && cp -n -f /tmp/new call-index.txt`, INDEX],
    ["a no-clobber cp clustered with -i", `cp -ni /fixture/tmp/new ${INDEX}`, INDEX],
    [
      "an rsync whose --backup-dir is the live talk directory, after a cd",
      `cd /tmp/case && rsync -b --backup-dir=${HOME}/talk src/call-index.txt dst/`,
      CALLS,
    ],
    ["an rsync whose spaced --backup-dir is the calls directory", `rsync -b --backup-dir ${CALLS} a dst/`, CALLS],
    ["an rsync --write-batch over the index", `rsync -a --write-batch=${INDEX} src dst`, INDEX],
    ["a git reset --hard from a sibling directory of the home", `cd ${HOME}/corpus && git reset --hard HEAD`, CALLS],
    ["a forced checkout from deep below the home", `git -C ${HOME}/corpus/a checkout -f`, CALLS],
    ["a wrapped git -C reset into a home subdirectory", `command git -C ${HOME}/corpus reset --hard`, CALLS],
    ["an inline git alias for reset --hard, after a cd", `cd ${HOME} && git -c 'alias.nuke=reset --hard' nuke`, CALLS],
    ["a top-rooted restore from a sibling directory", `cd ${HOME}/corpus && git restore :/talk/calls/x.jsonl`, CALLS],
    ["a git clean whose spaced -e takes -n as its pattern", `cd ${HOME} && git clean -fd -e -n`, CALLS],
    ["a git clean whose --exclude takes -n as its pattern", `git -C ${HOME} clean -fd --exclude -n`, CALLS],
    [
      "a find -exec rm naming a call file itself",
      `cd /tmp && find . -prune -exec rm -f ${CALLS}/live.jsonl \\;`,
      CALLS,
    ],
    ["a find -exec cp over the index", `find /tmp -prune -exec cp /fixture/tmp/x ${INDEX} \\;`, INDEX],
    ["a find -exec of a nested find -delete", `find /tmp -prune -exec find ${CALLS} -delete \\;`, CALLS],
    ["an in-place sed on a cursor", `sed -i '' 's/a/b/' ${CURSORS}/supervisor.json`, CURSORS],
    ["a tee over the ledger", `tee ${LEDGER}`, LEDGER],
    ["a truncate of the index", `truncate -s 0 ${INDEX}`, INDEX],
    ["a relative path after cd", `cd ${HOME}/talk && rm calls/x.jsonl`, CALLS],
    ["a brace list of call files", `rm ${CALLS}/{a,b}.jsonl`, CALLS],
    ["a sequence brace over the talk directory, after a cd", `cd ${HOME} && rm -rf tal{k..l}`, CALLS],
    ["the owner's own account's named-user tilde", "cd /tmp && rm ~dev/.slopweaver/talk/call-index.txt", INDEX],
    [
      "a globstar spanning the home, after a cd",
      "shopt -s globstar; cd /fixture && rm users/**/talk/call-index.txt",
      // A `**` may also run on past the calls directory, which is protected first.
      CALLS,
    ],
    ["a brace-expanded program name, after a cd", `cd ${CALLS} && r{m,m} victim.jsonl`, CALLS],
    ["a globbed program name", `/bin/r? ${INDEX}`, INDEX],
    ["a variable program name", `"$RM" ${INDEX}`, INDEX],
    ["a brace-expanded git, in a subdirectory of the home", `cd ${HOME}/corpus && {git,} reset --hard`, CALLS],
    ["a brace-expanded -exec program", `find ${CALLS} -exec r{m,m} {} +`, CALLS],
    [
      "a find {} embedded in an -exec rm's path, after a cd",
      `cd /fixture/tmp && find . -name calls -exec rm -rf ${HOME}/talk/{} \\;`,
      CALLS,
    ],
    ["a find -delete with no starting point, after a cd", `cd ${CALLS} && find -delete`, CALLS],
    [
      "a find -exec rm with no starting point, after a cd",
      `cd ${HOME}/talk && find -name '*.jsonl' -exec rm {} +`,
      CALLS,
    ],
    ["a find {} embedded mid-name", `find /fixture/tmp -exec truncate -s 0 ${HOME}/talk/call-{}.txt \\;`, CALLS],
    ["a named-user tilde over the whole home", "rm -rf ~dev/.slopweaver", CALLS],
    ["a glob matching the index", `rm ${HOME}/talk/call-*.txt`, INDEX],
    ["a glob in an ancestor component", `rm -rf ${HOME}/t*`, CALLS],
    ["a bracket class", `rm ${HOME}/talk/[c]alls/x.jsonl`, CALLS],
    ["a nested brace", `rm ${HOME}/talk/{relays,{calls,other}}/x`, CALLS],
    ["a brace whose body holds a slash, after a cd", `cd ${HOME} && rm -rf {talk/calls,other}`, CALLS],
    ["a brace whose body holds a slash", `rm -rf ${HOME}/{x,talk/calls}`, CALLS],
    ["a POSIX class after a cd", `cd ${HOME}/talk && rm -rf [[:lower:]]alls`, CALLS],
    ["a negated class opening on a literal ]", `rm -rf ${HOME}/talk/[!]]alls`, CALLS],
    ["a git clean of the home", `git -C ${HOME} clean -fdx`, CALLS],
    ["a git clean whose pathspec is an ancestor", `git -C ${HOME} clean -fdx -- talk`, CALLS],
    ["a git clean whose pathspec git reads as a glob", `git -C ${HOME} clean -fd -- '*.jsonl'`, CALLS],
    ["a git clean whose pathspec is magic", `git -C ${HOME} clean -fd :/`, CALLS],
    ["a wrapped rm", `env FOO=1 sudo -u dev rm ${CALLS}/x.jsonl`, CALLS],
    ["an rm behind sudo's prompt option", `sudo -p prompt rm ${CALLS}/x.jsonl`, CALLS],
    ["an rm behind a sudo cluster ending in a valued letter", `sudo -Eu dev rm ${CALLS}/x.jsonl`, CALLS],
    ["an rm behind env's chdir option", `env -C /tmp rm ${CALLS}/x.jsonl`, CALLS],
    ["an rm behind time's output option", `time -o /tmp/t rm ${CALLS}/x.jsonl`, CALLS],
    ["a later segment", `ls && rm ${CALLS}/x.jsonl`, CALLS],
    ["an rm after a lone & after a cd", `cd ${HOME}/talk && :; true & rm call-index.txt`, INDEX],
    ["an rm after a glued &", `true&rm ${INDEX}`, INDEX],
    ["an rm in a subshell after a cd", `cd ${CALLS} && (rm live.jsonl)`, CALLS],
    ["an rm through $PWD after a cd", `cd ${CALLS} && rm "$PWD/x.jsonl"`, CALLS],
    ["an rm through ${PWD} after a cd", `cd ${HOME}/talk && rm \${PWD}/call-index.txt`, INDEX],
    ["the line after a comment", `ls # done\nrm ${CALLS}/x.jsonl`, CALLS],
    ["a quoted # that is no comment", `echo '#' ; rm ${CALLS}/x.jsonl`, CALLS],
    ["a local rsync destination", `rsync -a /fixture/tmp/x ${CALLS}/`, CALLS],
    ["an rsync -t (keep times) destination", `rsync -t /fixture/tmp/x ${INDEX}`, INDEX],
    ["an install destination", `install -m 600 /fixture/tmp/x ${INDEX}`, INDEX],
    [
      "an rsync that removes its sent sources",
      `rsync --remove-source-files ${CALLS}/x.jsonl /fixture/tmp/backup/`,
      CALLS,
    ],
    [
      "an rsync whose abbreviated --remove-source removes",
      `rsync --remove-source ${CALLS}/x.jsonl /fixture/tmp/b/`,
      CALLS,
    ],
    ["an rsync whose abbreviated --remove-sent removes", `rsync --remove-sent ${CALLS}/x.jsonl /fixture/tmp/b/`, CALLS],
    ["a no-clobber cp an abbreviated --forc outranks", `cp -n --forc /fixture/tmp/x ${INDEX}`, INDEX],
    ["a cp into an abbreviated --target-dir=", `cp --target-dir=${CALLS} /fixture/tmp/x.jsonl`, CALLS],
    ["a cp into a spaced abbreviated --target", `cp --target ${CALLS} /fixture/tmp/x.jsonl`, CALLS],
    ["a cp under an abbreviated --par into the home", `cd /tmp && cp --par talk/calls/x.jsonl ${HOME}/`, CALLS],
    ["an rsync whose abbreviated --backup-d is the calls dir", `rsync -b --backup-d=${CALLS} a dst/`, CALLS],
    ["an rsync whose abbreviated --only-write is the index", `rsync -a --only-write ${INDEX} src dst`, INDEX],
    ["a symlink over the index", `ln -sf /fixture/tmp/x ${INDEX}`, INDEX],
    ["an in-place perl on the ledger", `perl -pi -e 's/a/b/' ${LEDGER}`, LEDGER],
    ["an in-place ruby on a cursor", `ruby -i -pe 'x' ${CURSORS}/supervisor.json`, CURSORS],
    ["a shred of a call file", `shred -u ${CALLS}/x.jsonl`, CALLS],
    ["a trash of the calls directory", `trash ${CALLS}`, CALLS],
    ["an rsync whose valued option follows its operands", `rsync /fixture/tmp/x ${CALLS}/id.jsonl --exclude no`, CALLS],
    ["an rsync whose unknown option follows its operands", `rsync /fixture/tmp/x ${CALLS}/id.jsonl --frob no`, CALLS],
    ["a cp whose suffix value follows its operands", `cp /fixture/tmp/x ${INDEX} -S .bak`, INDEX],
    ["an rm on the line after a heredoc", `cat <<'EOF'\nbody\nEOF\nrm ${INDEX}`, INDEX],
    ["a case-only alias of the home, which a Mac resolves", `rm ${USER}/.SLOPWEAVER/talk/calls/x.jsonl`, CALLS],
    ["a copy into the home of a directory named talk", `cp -R /fixture/tmp/talk ${HOME}/`, CALLS],
    ["a copy into the home of a directory's contents", `cp -R /fixture/tmp/stash/ ${HOME}`, CALLS],
    ["an rsync -R that keeps the source's path", `rsync -aR talk/calls/x.jsonl ${HOME}/`, CALLS],
    [
      "an rsync whose file list names paths below the home",
      `cd ${HOME} && rsync -a --files-from=/l /fixture/src .`,
      CALLS,
    ],
    ["an rsync whose spaced file list names paths", `rsync -a --files-from /l /fixture/src ${HOME}`, CALLS],
    [
      "an rsync whose abbreviated file list names paths, after a cd",
      `cd ${HOME}/talk && rsync -a --files-f=/l /fixture/src .`,
      CALLS,
    ],
    ["an rsync whose spaced, abbreviated file list names paths", `rsync -a --files /l /fixture/src ${HOME}`, CALLS],
    ["a ditto into the home, which copies contents", `ditto /fixture/tmp/stash ${HOME}`, CALLS],
    ["a cp -T onto the home itself", `cp -rT /fixture/tmp/stash ${HOME}`, CALLS],
    ["a copy whose source holds an expansion", `cp "$SRC" ${HOME}/talk/`, CALLS],
    ["a copy whose source's last component is a command substitution", `cp /x/"$(echo calls)" ${HOME}/talk/`, CALLS],
    ["an extglob below the calls directory", `rm ${CALLS}/@(*)`, CALLS],
    ["a globbed source copied into the home, which may name talk", `cp -r /fixture/tmp/t* ${HOME}/`, CALLS],
  ])("refuses %s", (_label, command, protectedPath) => {
    expect(judge({ command })?.protectedPath).toBe(protectedPath);
  });

  it.each([
    ["a read", `cat ${CALLS}/x.jsonl`],
    ["a listing", `ls -la ${CALLS}`],
    ["an append", `echo x >> ${INDEX}`],
    ["an &>> append", `true &>> ${INDEX}`],
    ["a 2>&1 duplication with a backgrounded read", `cat ${INDEX} 2>&1 & ls ${CALLS}`],
    ["a copy OUT", `cp ${CALLS}/x.jsonl /fixture/tmp/copy.jsonl`],
    ["a copy OUT into the home itself", `cp ${CALLS}/x.jsonl ${HOME}/`],
    [
      "a copy OUT into the home spelled through the variable",
      `cp "$SLOPWEAVER_HOME"/talk/calls/x.jsonl "$SLOPWEAVER_HOME"/`,
    ],
    ["a -t copy OUT into the home itself", `cp -t ${HOME} ${CALLS}/x.jsonl`],
    ["an appending tee", `printf 'x\\n' | tee -a ${CALLS}/id.jsonl`],
    ["a sibling file", `rm ${HOME}/talk/relays.jsonl`],
    ["a sibling glob", `rm ${HOME}/talk/relays*.jsonl`],
    ["a quoted glob, which is literal", `rm -rf '${HOME}/t*'`],
    ["a quoted >, which is data", `echo ">" ${INDEX}`],
    ["an unknown variable", "rm $OTHER/talk/calls/x.jsonl"],
    ["a command substitution", `rm "$(echo ${CALLS})"/x.jsonl`],
    ["a remote rsync destination", `rsync -a /fixture/tmp/x host:${CALLS}`],
    ["an rsync copy OUT to another host", `rsync -a ${CALLS}/x.jsonl host:/tmp/x`],
    ["an rsync -t (keep times) copy OUT", `rsync -t ${CALLS}/x.jsonl /fixture/tmp/x`],
    ["a truncate reading the index as its reference", `truncate -r ${INDEX} /fixture/tmp/x`],
    ["a dry-run git clean", `git -C ${HOME} clean -nd`],
    ["a git clean limited to an unrelated pathspec", `git -C ${HOME} clean -fdx -- unrelated.tmp`],
    ["a variable delete in a working directory outside the home", 'rm -rf "$BUILD" "${OUT:-dist}"'],
    ["a variable delete below an unrelated literal directory", 'rm -rf /fixture/tmp/"$X"'],
    ["a variable delete in a throwaway home", `rm ${THROWAWAY}/talk/calls/"$id".jsonl`],
    ["a git -C $PWD reset --hard in a throwaway home", `cd ${THROWAWAY} && git -C "$PWD" reset --hard`],
    ["a single-quoted dollar, which is literal", `rm ${HOME}/'$id'.jsonl`],
    ["a git clean whose -e value is not a pathspec", `git -C ${HOME} clean -fdx -e talk unrelated.tmp`],
    ["an unterminated quote, which the shell refuses to parse", `rm '${CALLS}`],
    ["an unreadable class below a protected directory", `rm ${CALLS}/[z-a]`],
    ["a no-clobber copy onto the index", `cp -n /fixture/tmp/new ${INDEX}`],
    ["a one-operand rsync listing", `rsync ${CALLS}/`],
    ["a process substitution after $HOME", "rm $HOME/.slopweaver/talk/calls/<(printf x)"],
    ["a process substitution after a literal path", `rm ${CALLS}/<(printf x)`],
    ["a process substitution in an attached redirection target", `echo >${CALLS}/<(printf x)`],
    ["another account's named-user tilde", "rm ~root/.slopweaver/talk/call-index.txt"],
    ["a directory-stack tilde", "rm ~2/talk/call-index.txt"],
    ["a commented-out rm after a ;", `true # ; rm ${CALLS}/x.jsonl`],
    ["a commented-out line", `# rm ${CALLS}/x.jsonl\nls`],
    ["a copy OUT whose -t comes after --, so is a file name", `cp -- -t ${CALLS}/x.jsonl /fixture/tmp/out/`],
    ["the inline hatch on the segment", `SLOPWEAVER_ALLOW_CALL_STATE_DELETE=1 rm ${CALLS}/x.jsonl`],
    ["a call file in a throwaway home", `rm ${THROWAWAY}/talk/calls/x.jsonl`],
    ["an rm through $PWD in a throwaway home", `cd ${THROWAWAY}/talk/calls && rm "$PWD/x.jsonl"`],
    ["a wrapped git -C restore in a throwaway home", `command git -C ${THROWAWAY} restore -- talk/call-index.txt`],
    ["a slash-holding brace in a throwaway home", `rm -rf ${THROWAWAY}/{talk/calls,other}`],
    ["a git reset --hard below a throwaway home", `cd ${THROWAWAY}/corpus && git reset --hard HEAD`],
    ["a git reset --hard in an unrelated repository", `cd ${WORK}/repo && git reset --hard HEAD`],
    ["an rsync whose --backup-dir is a throwaway home", `rsync -b --backup-dir=${THROWAWAY}/talk a.txt dst/`],
    ["an rsync --backup, which is no --backup-dir", `rsync --backup ${CALLS}/x.jsonl /fixture/tmp/b/`],
    ["an rsync --partial, which is no --partial-dir", `rsync --partial ${INDEX} /fixture/tmp/b/`],
    [
      "an abbreviated --remove-source from a throwaway home",
      `rsync --remove-source ${THROWAWAY}/talk/calls/x.jsonl /t/`,
    ],
    ["an rm under nested env -C in a throwaway home", `env -C ${THROWAWAY}/talk env -C calls rm -f live.jsonl`],
    ["an rm env -S splits out in a throwaway home", `cd ${THROWAWAY}/talk/calls && env -S "rm x.jsonl"`],
    ["a read env -S splits out", `env -S "cat ${INDEX}"`],
    ["an -uS unsetting a variable named S", `env -uS ls ${CALLS}`],
    [
      "a find -exec rm naming a throwaway call file",
      `find /tmp -prune -exec rm -f ${THROWAWAY}/talk/calls/x.jsonl \\;`,
    ],
    ["a find -exec that only reads a call file", `find ${CALLS} -name '*.jsonl' -exec cat {} \\;`],
    ["a find -exec cp of a found file OUT", `find ${CALLS} -name '*.jsonl' -exec cp {} /fixture/tmp/out/ \\;`],
    ["a quoted >| that is data", `echo '>|' ${INDEX}`],
    ["a read whose heredoc body holds an rm line", `cat ${CALLS}/x.jsonl <<'EOF'\nrm ${CALLS}/x.jsonl\nEOF`],
    ["a variable name a quote splits", 'rm $HOM"E"/.slopweaver/talk/call-index.txt'],
    ["a single-quoted $HOME, which is literal", "rm '$HOME'/.slopweaver/talk/call-index.txt"],
    ["an rsync listing whose valued option follows it", `rsync ${CALLS}/x.jsonl --exclude no`],
    ["an rsync copy OUT whose valued option follows it", `rsync ${CALLS}/x.jsonl /fixture/tmp/x --exclude no`],
  ])("allows %s", (_label, command) => {
    expect(judge({ command })).toBe(undefined);
  });

  it("refuses an rm after a backgrounded cd, which runs where the shell already was", () => {
    expect(judge({ command: "cd calls & rm call-index.txt", cwd: `${HOME}/talk` })?.protectedPath).toBe(INDEX);
    expect(judge({ command: "cd calls & ls", cwd: `${HOME}/talk` })).toBe(undefined);
  });

  it("refuses a later segment the inline hatch on an earlier one does not cover", () => {
    const command = `SLOPWEAVER_ALLOW_CALL_STATE_DELETE=1 ls && rm ${CALLS}/x.jsonl`;

    expect(judge({ command })?.segment).toBe(`rm ${CALLS}/x.jsonl`);
  });

  it.each([
    ["a backgrounded command", `SLOPWEAVER_ALLOW_CALL_STATE_DELETE=1 true & rm ${INDEX}`],
    ["a backgrounded env", `env SLOPWEAVER_ALLOW_CALL_STATE_DELETE=1 true & rm ${INDEX}`],
    ["a backgrounded command after a cd", `cd /tmp; SLOPWEAVER_ALLOW_CALL_STATE_DELETE=1 true & rm ${INDEX}`],
  ])("refuses an rm after %s the inline hatch arms, which runs with it closed", (_label, command) => {
    expect(judge({ command })?.protectedPath).toBe(INDEX);
  });

  it.each([
    [
      "the hatch on the rm itself, after a backgrounded command",
      `true & SLOPWEAVER_ALLOW_CALL_STATE_DELETE=1 rm ${INDEX}`,
    ],
    ["the hatch through env on the rm, before one", `env SLOPWEAVER_ALLOW_CALL_STATE_DELETE=1 rm ${INDEX} & true`],
    ["the hatch on a lone rm", `SLOPWEAVER_ALLOW_CALL_STATE_DELETE=1 rm ${INDEX}`],
  ])("allows %s", (_label, command) => {
    expect(judge({ command })).toBe(undefined);
  });

  it("guards every home it is given, each once, and only those", () => {
    const command = `rm ${THROWAWAY}/talk/call-index.txt`;

    expect(judge({ command, homes: [HOME, THROWAWAY, HOME] })?.protectedPath).toBe(`${THROWAWAY}/talk/call-index.txt`);
    expect(judge({ command: `rm ${INDEX}`, homes: [THROWAWAY] })).toBe(undefined);
  });
});

describe("evaluateCallStateGuard where a cd's landing is read on disk", () => {
  let root: string;
  let live: string;
  let throwaway: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cdpath-"));
    live = join(root, "live");
    throwaway = join(root, "throwaway");
    mkdirSync(join(live, "talk", "calls"), { recursive: true });
    mkdirSync(join(throwaway, "talk", "calls"), { recursive: true });
    mkdirSync(join(root, "work"));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  /** Judge one command from the work directory, `SLOPWEAVER_HOME` pointing at `home`, the live home protected. */
  function judgeIn({
    command,
    home,
    cdPath,
  }: {
    command: string;
    home: string;
    cdPath?: string | undefined;
  }): ReturnType<typeof evaluateCallStateGuard> {
    const env = cdPath === undefined ? { SLOPWEAVER_HOME: home } : { CDPATH: cdPath, SLOPWEAVER_HOME: home };
    return evaluateCallStateGuard({ command, cwd: join(root, "work"), env: { ...env, HOME: root }, homes: [live] });
  }

  it.each([
    ["a prefix assignment", 'CDPATH="$SLOPWEAVER_HOME/talk" cd calls && rm live.jsonl', undefined],
    ["an earlier bare assignment", 'CDPATH="$SLOPWEAVER_HOME/talk"; cd calls && rm live.jsonl', undefined],
    ["an earlier export", "export CDPATH=$SLOPWEAVER_HOME/talk; cd calls; rm live.jsonl", undefined],
    [
      "a later entry after one that misses",
      "CDPATH=/nowhere:$SLOPWEAVER_HOME/talk cd calls && rm live.jsonl",
      undefined,
    ],
    ["the environment's own CDPATH", "cd calls && rm live.jsonl", "$SLOPWEAVER_HOME/talk"],
  ])("refuses an rm after a cd %s sends into the live calls directory", (_label, command, cdPath) => {
    const hit = judgeIn({ cdPath, command, home: live });

    expect(hit?.protectedPath).toBe(join(live, "talk", "calls"));
  });

  it("refuses an rm after a cd whose CDPATH assignment may not have run, and allows it in a throwaway home", () => {
    const commands = [
      `true || CDPATH=${throwaway}/talk; cd calls && rm live.jsonl`,
      `false && CDPATH=${throwaway}/talk; cd calls && rm live.jsonl`,
      `CDPATH=${throwaway}/talk | cat; cd calls && rm live.jsonl`,
    ];
    const hits = commands.map((command) => judgeIn({ cdPath: "$SLOPWEAVER_HOME/talk", command, home: live }));
    const throwawayHits = commands.map((command) => judgeIn({ cdPath: `${throwaway}/talk`, command, home: throwaway }));

    expect(hits.map((hit) => hit?.protectedPath)).toEqual(commands.map(() => join(live, "talk", "calls")));
    expect(throwawayHits).toEqual([undefined, undefined, undefined]);
  });

  it.each([
    [
      "the same cd into a throwaway home",
      'CDPATH="$SLOPWEAVER_HOME/talk" cd calls && rm live.jsonl',
      undefined,
      "throwaway",
    ],
    [
      "a ./ target, which never consults CDPATH",
      'CDPATH="$SLOPWEAVER_HOME/talk" cd ./calls && rm x.jsonl',
      undefined,
      "live",
    ],
    ["a CDPATH unset before the cd", "unset CDPATH; cd calls && rm live.jsonl", "$SLOPWEAVER_HOME/talk", "live"],
  ] as const)("allows %s", (_label, command, cdPath, which) => {
    const home = { live, throwaway }[which];

    expect(judgeIn({ cdPath, command, home })).toBe(undefined);
  });

  it.each([
    ["an exit", "cd $SLOPWEAVER_HOME/talk/calls || exit 1; rm -f live.jsonl"],
    ["a newline", "cd $SLOPWEAVER_HOME/talk/calls || exit 1\nrm -f live.jsonl"],
    ["a later && step", "cd $SLOPWEAVER_HOME/talk/calls || echo no && rm -f live.jsonl"],
    ["a second cd alternative", "cd $SLOPWEAVER_HOME/talk/calls || cd /tmp || exit; rm -f live.jsonl"],
    ["a first alternative that is missing", "cd /nowhere/x || cd $SLOPWEAVER_HOME/talk/calls || exit; rm live.jsonl"],
  ])("refuses an rm after a cd || %s, which runs where the cd went", (_label, command) => {
    expect(judgeIn({ command, home: live })?.protectedPath).toBe(join(live, "talk", "calls"));
  });

  it.each([
    ["the alternative itself, which runs only where the cd failed", "cd $SLOPWEAVER_HOME/talk/calls || rm live.jsonl"],
    ["a cd || into a missing directory", "cd $SLOPWEAVER_HOME/talk/nowhere || exit 1; rm live.jsonl"],
  ])("allows %s", (_label, command) => {
    expect(judgeIn({ command, home: live })).toBe(undefined);
  });

  it("allows the same cd || exit; rm in a throwaway home", () => {
    const command = "cd $SLOPWEAVER_HOME/talk/calls || exit 1; rm -f live.jsonl";

    expect(judgeIn({ command, home: throwaway })).toBe(undefined);
  });

  it.each([
    ["attached", "cd $SLOPWEAVER_HOME/talk && cd >call-index.txt"],
    ["spaced", "cd $SLOPWEAVER_HOME/talk && cd > call-index.txt"],
    ["after an operand", "cd $SLOPWEAVER_HOME/talk && cd /tmp >call-index.txt"],
    ["on a descriptor", "cd $SLOPWEAVER_HOME/talk && cd 2>call-index.txt"],
  ])("refuses a cd carrying a truncating redirect, %s, where the shell stood", (_label, command) => {
    expect(judgeIn({ command, home: live })?.protectedPath).toBe(join(live, "talk", "call-index.txt"));
  });

  it("refuses an rm after a cd whose redirect is harmless, from where the cd went", () => {
    const command = "cd $SLOPWEAVER_HOME/talk/calls >/dev/null && rm live.jsonl";

    expect(judgeIn({ command, home: live })?.protectedPath).toBe(join(live, "talk", "calls"));
  });

  it.each([
    [
      "-execdir climbing out of a found directory",
      String.raw`cd .. && find work -execdir truncate -s 0 ../live/talk/call-index.txt \;`,
    ],
    [
      "-okdir climbing from a file one level down",
      String.raw`cd .. && find work -okdir truncate -s 0 ../../live/talk/call-index.txt \;`,
    ],
  ])("refuses a find %s, judged from each found directory", (_label, command) => {
    expect(judgeIn({ command, home: live })?.protectedPath).toBe(join(live, "talk", "call-index.txt"));
  });

  it("refuses a find -execdir writing a relative name anywhere under the home, judging the home whole", () => {
    const command = String.raw`find $SLOPWEAVER_HOME -execdir cp /tmp/x call-index.txt \;`;

    expect(judgeIn({ command, home: live })?.protectedPath).toBe(join(live, "talk", "calls"));
  });

  it.each([
    [
      "-execdir climbing into a throwaway home",
      String.raw`cd .. && find work -execdir truncate -s 0 ../throwaway/talk/call-index.txt \;`,
      "live",
    ],
    [
      "-execdir writing a relative name under a throwaway home",
      String.raw`find $SLOPWEAVER_HOME -execdir cp /tmp/x call-index.txt \;`,
      "throwaway",
    ],
  ] as const)("allows a find %s", (_label, command, which) => {
    expect(judgeIn({ command, home: { live, throwaway }[which] })).toBe(undefined);
  });

  it.each([
    ["an && the shell may skip", "cd $SLOPWEAVER_HOME/talk/calls; false && cd /tmp; rm live.jsonl"],
    ["an || the shell may skip", "cd $SLOPWEAVER_HOME/talk/calls; true || cd /tmp; rm live.jsonl"],
    ["a pipe, whose subshell keeps it", "cd $SLOPWEAVER_HOME/talk/calls; true | cd /tmp; rm live.jsonl"],
  ])("refuses an rm after a cd behind %s, from where the shell stood", (_label, command) => {
    expect(judgeIn({ command, home: live })?.protectedPath).toBe(join(live, "talk", "calls"));
  });

  it.each([
    [
      "the same skipped cd in a throwaway home",
      "cd $SLOPWEAVER_HOME/talk/calls; false && cd /tmp; rm live.jsonl",
      "throwaway",
    ],
    [
      "an rm that runs only once the cd has",
      "cd $SLOPWEAVER_HOME/talk/calls; false && cd /tmp && rm live.jsonl",
      "live",
    ],
  ] as const)("allows %s", (_label, command, which) => {
    expect(judgeIn({ command, home: { live, throwaway }[which] })).toBe(undefined);
  });

  it.each([
    ["attached", "cd $SLOPWEAVER_HOME/talk && rm -f /tmp/absent {fd}>call-index.txt"],
    ["spaced", "cd $SLOPWEAVER_HOME/talk && rm -f /tmp/absent {fd}> call-index.txt"],
    ["forced", "cd $SLOPWEAVER_HOME/talk && true {out}>|call-index.txt"],
  ])("refuses a named-descriptor truncating redirect, %s", (_label, command) => {
    expect(judgeIn({ command, home: live })?.protectedPath).toBe(join(live, "talk", "call-index.txt"));
  });

  it.each([
    ["an upper-case path", 'cd "$SLOPWEAVER_HOME/talk/calls" && /bin/RM live.jsonl'],
    ["an upper-case name on the PATH", "cd $SLOPWEAVER_HOME/talk/calls && RM live.jsonl"],
    ["a mixed-case wrapper", "cd $SLOPWEAVER_HOME/talk/calls && Env Rm live.jsonl"],
    ["a mixed-case find action", "cd $SLOPWEAVER_HOME/talk && Find calls -exec RM {} +"],
  ])("refuses a remover spelled in %s, which a case-blind filesystem runs", (_label, command) => {
    expect(judgeIn({ command, home: live })?.protectedPath).toBe(join(live, "talk", "calls"));
  });

  it.each([
    ["a coproc", "cd $SLOPWEAVER_HOME/talk/calls && coproc rm live.jsonl"],
    ["a named coproc", "cd $SLOPWEAVER_HOME/talk/calls && coproc DEL { rm live.jsonl; }"],
    ["nice", "cd $SLOPWEAVER_HOME/talk/calls && nice -n 5 rm live.jsonl"],
    ["timeout", "cd $SLOPWEAVER_HOME/talk/calls && timeout 5 rm live.jsonl"],
  ])("refuses a remover run by %s", (_label, command) => {
    expect(judgeIn({ command, home: live })?.protectedPath).toBe(join(live, "talk", "calls"));
  });

  it.each([
    ["after a cd", "cd $SLOPWEAVER_HOME/talk/calls \\\n&& rm live.jsonl"],
    ["inside an operand", "cd $SLOPWEAVER_HOME/talk/ca\\\nlls && rm live.jsonl"],
    ["before the remover", "cd $SLOPWEAVER_HOME/talk/calls && \\\n  rm live.jsonl"],
  ])("refuses an rm with a line continuation %s, which bash removes", (_label, command) => {
    expect(judgeIn({ command, home: live })?.protectedPath).toBe(join(live, "talk", "calls"));
  });

  it.each([
    ["~+ alone", "cd $SLOPWEAVER_HOME/talk/calls && rm -rf ~+"],
    ["a path under ~+", "cd $SLOPWEAVER_HOME/talk/calls && rm ~+/live.jsonl"],
  ])("refuses an rm of %s, the directory a followed cd reached", (_label, command) => {
    expect(judgeIn({ command, home: live })?.protectedPath).toBe(join(live, "talk", "calls"));
  });

  it("allows the same ~+ rm in a throwaway home", () => {
    const command = "cd $SLOPWEAVER_HOME/talk/calls && rm ~+/live.jsonl";

    expect(judgeIn({ command, home: throwaway })).toBe(undefined);
  });

  it("allows a line-continued rm in a throwaway home", () => {
    const command = "cd $SLOPWEAVER_HOME/talk/calls \\\n&& rm live.jsonl";

    expect(judgeIn({ command, home: throwaway })).toBe(undefined);
  });

  it("allows a coproc remover in a throwaway home", () => {
    const command = "cd $SLOPWEAVER_HOME/talk/calls && coproc rm live.jsonl";

    expect(judgeIn({ command, home: throwaway })).toBe(undefined);
  });

  it("allows an upper-case remover in a throwaway home", () => {
    const command = 'cd "$SLOPWEAVER_HOME/talk/calls" && /bin/RM live.jsonl';

    expect(judgeIn({ command, home: throwaway })).toBe(undefined);
  });

  it("allows a named-descriptor truncating redirect in a throwaway home", () => {
    const command = "cd $SLOPWEAVER_HOME/talk && rm -f /tmp/absent {fd}>call-index.txt";

    expect(judgeIn({ command, home: throwaway })).toBe(undefined);
  });

  it("allows a cd carrying a truncating redirect in a throwaway home", () => {
    const command = "cd $SLOPWEAVER_HOME/talk && cd >call-index.txt";

    expect(judgeIn({ command, home: throwaway })).toBe(undefined);
  });
});

describe("reachesProtected", () => {
  it("reaches the path itself, what is under it and an ancestor, never a sibling", () => {
    expect([
      reachesProtected({ operand: CALLS, target: CALLS }),
      reachesProtected({ operand: `${CALLS}/x.jsonl`, target: CALLS }),
      reachesProtected({ operand: HOME, target: CALLS }),
      reachesProtected({ operand: `${HOME}/talk/calls-old`, target: CALLS }),
      reachesProtected({ operand: `${INDEX}.bak`, target: INDEX }),
    ]).toEqual([true, true, true, false, false]);
  });

  it("reads a whole ** component as globstar, spanning any number of components", () => {
    expect([
      reachesProtected({ operand: "/fixture/**/talk/call-index.txt", target: INDEX }),
      reachesProtected({ operand: "/fixture/users/**/.slopweaver", target: CALLS }),
      reachesProtected({ operand: `${HOME}/**/call-index.txt`, target: INDEX }),
      reachesProtected({ operand: `${HOME}/talk/**`, target: CALLS }),
      reachesProtected({ operand: "/elsewhere/**/talk/call-index.txt", target: INDEX }),
      reachesProtected({ operand: `${HOME}/\\*\\*/call-index.txt`, target: INDEX }),
    ]).toEqual([true, true, true, true, false, false]);
  });

  it("reads an escaped glob character literally, and an uncompilable class as unjudged", () => {
    expect([
      reachesProtected({ operand: `${HOME}/\\*`, target: CALLS }),
      reachesProtected({ operand: `${HOME}/[z-a]*`, target: CALLS }),
    ]).toEqual([false, false]);
  });
});

describe("runCallStateGuard", () => {
  /** Run the runner over one Bash payload, collecting stderr. */
  async function run({
    command,
    env = ENV,
  }: {
    command: string;
    env?: Readonly<Record<string, string | undefined>>;
  }): Promise<{ readonly code: number; readonly errors: readonly string[] }> {
    const errors: string[] = [];
    const code = await runCallStateGuard({
      env,
      homes: [HOME],
      readStdin: () => Promise.resolve(JSON.stringify({ cwd: WORK, tool_input: { command }, tool_name: "Bash" })),
      writeError: (line) => {
        errors.push(line);
      },
    });
    return { code, errors };
  }

  it("refuses with the four-line hatch refusal and the remedy naming --home and talk quarantine", async () => {
    const command = `rm ${CALLS}/x.jsonl`;
    const result = await run({ command });
    const hit = { operand: `${CALLS}/x.jsonl`, others: [], protectedPath: CALLS, segment: command };

    expect(result).toEqual({ code: 2, errors: [`${callStateRefusal({ hit })}\n`] });
    expect(result.errors[0]).toContain("SLOPWEAVER_ALLOW_CALL_STATE_DELETE=1");
    expect(result.errors[0]).toContain("slopweaver talk quarantine <id>");
    expect(result.errors[0]).toContain("throwaway `--home`");
  });

  it("allows everything under the process-wide hatch", async () => {
    const env = { ...ENV, SLOPWEAVER_ALLOW_CALL_STATE_DELETE: "1" };

    expect(await run({ command: `rm ${CALLS}/x.jsonl`, env })).toEqual({ code: 0, errors: [] });
  });

  it("guards the environment's home AND the account default when no homes are injected", async () => {
    /**
     * One payload through the production home selection, a throwaway configured home beside the account default —
     * under test, the per-file sandbox `setup-ambient-home.ts` installs, never the operator's own home.
     */
    const judgeLive = async ({ command }: { command: string }): Promise<number> =>
      runCallStateGuard({
        env: { HOME: USER, SLOPWEAVER_HOME: THROWAWAY },
        readStdin: () => Promise.resolve(JSON.stringify({ cwd: WORK, tool_input: { command }, tool_name: "Bash" })),
        writeError: () => undefined,
      });

    expect([
      await judgeLive({ command: `rm ${THROWAWAY}/talk/call-index.txt` }),
      await judgeLive({ command: `rm ${accountDefaultHome()}/talk/call-index.txt` }),
      await judgeLive({ command: `rm ${INDEX}` }),
    ]).toEqual([2, 2, 0]);
  });

  it("fails OPEN on a payload it cannot read", async () => {
    const errors: string[] = [];
    const code = await runCallStateGuard({
      env: ENV,
      homes: [HOME],
      readStdin: () => Promise.resolve("{not json"),
      writeError: (line) => {
        errors.push(line);
      },
    });

    expect({ code, errors }).toEqual({ code: 0, errors: [] });
  });
});
