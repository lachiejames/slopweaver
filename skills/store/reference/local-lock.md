# The local store lock — `store lock`, `store start`

A fresh Supabase stack accepts `postgres:postgres` from anything on this Mac. `slopweaver store lock` closes
that door and leaves one login: the verbs' own. `yarn store:start` runs `slopweaver store start`, which starts
the stack through the pinned CLI and then locks it, so nobody has to run anything by hand.

## What one run does, in order

Before any of these, it reads where the database port is published (`docker port`) and refuses with
`PORT_EXPOSED`, changing nothing, when any publication is beyond loopback. Docker Desktop's default port
binding publishes on every interface, and Mac logins then arrive from an address the rule below never names,
so the lock would not hold. The fix it names is Docker Desktop's Port binding behavior "Localhost only".

1. **Settles the verbs' login.** The role `slopweaver_login` logs in with a random per-install password (256
   bits), and every session it opens runs as `postgres`. The server is handed a SCRAM verifier, never the
   password, and the statements travel on psql's stdin, never argv. The password is written to
   `$SLOPWEAVER_HOME/secrets/store-url` (0600), and parked in `store-lock/pending-login-<project_id>` (0600, one
   file per stack) while a run is between minting it and writing it. It is never printed, logged or put in a report.
2. **Before anything changes on a stack whose role carries no backup mark, keeps a local copy of the store**
   (database and Storage, never home files). The mark is a comment on the role, written in the transaction
   that creates it, or straight after the copy for a role the run found made by hand. So a first lock, and a
   `--rotate` over a hand-made role, always copy first. The copy goes
   `$SLOPWEAVER_HOME/store-lock/backups/<instant>/`: a `pg_dump`, `storage.tar` and a manifest. It restores
   the copy into the rehearsal throwaway and compares it with live (table counts, sampled rows, schema). Every
   Storage object is then checked in the tar by path, size and, where its name is a sha256, by digest. A copy
   that fails any check stops the run before anything changes. An empty stack (no table in `public` or `drizzle`, no
   Storage bucket or object) needs no copy. A marked role
   copies nothing and the earlier copy is not re-checked: a later lock changes only the login, never the data.
3. **Proves the new URL** logs in as `slopweaver_login`, runs as `postgres`, and reaches THIS stack's server.
   The server's start instant (epoch seconds, so a role's time zone cannot change it) is read over the URL and
   over the container's socket, and the two must match.
4. **Installs the rule.** It writes two lines into the container's `pg_hba.conf` above the first rule that
   admits the Docker network's gateway (where every Mac login arrives from): `slopweaver_login` by password,
   then every other role refused. Each service's own login from inside the network is untouched.
5. **Proves the door closed** at `127.0.0.1` and `[::1]` (`postgres:postgres` refused by the rule). It then
   ends any session from the Mac that is not the login, because a reload never ends an open session.
6. **Takes the API roles' table rights away** in `public` (`anon`, `authenticated`, `service_role`, MAINTAIN
   included), now and in both owners' default privileges, then reads them back to prove none are left.

The run holds one lock for every stack (stacks sharing a home share its files) in this user's machine-wide runtime directory, never stale while its
holder lives, so two runs from any two homes never interleave. A run that stops midway converges on
the next one, because the order is the safety. A password is parked in its stack's own pending file (an exclusive 0600 create
at that path, never a staged sibling, with the file and every directory entry on its path synced) before the role is touched, and a later run on the same stack adopts it; a run on another stack sharing the home never reads or clears it. A URL that is written but has no rule yet is kept, and
the rule is installed. A run that finds its own password parked writes `store-url` again before dropping it, and ends
the login's open sessions, because the earlier run may have changed the password and died before syncing the URL. A
parked password that does not log in is left in place, never deleted: a killed run's role change can still commit
inside the container after the run is gone, and the next run then adopts it. Until the new URL is proven and
written, the old one keeps working.

## Why `postgres` keeps its password

Storage logs in as `postgres` with the CLI default on every start. Measured: changing that password
crash-looped `supabase_storage_*`. So `postgres` keeps it, and the rule refuses it from the Mac.

## Reruns, other homes, `store verify`

- **Every start**: a container recreate restores the image's `pg_hba.conf`, so `store start` reapplies the
  rule. A rerun keeps the password and changes nothing else.
- **A second home** on this Mac finds the role and no password of its own, so the run refuses. `--rotate`
  gives that home a new password, and any other home's `store-url` then stops working. It also ends every session
  open as the login, because a password change never ends one. A parked password
  that logs in is adopted first even under `--rotate`, because it is then the only copy of the current one.
- **A stored password is trusted only where the server checks passwords.** Before keeping or adopting one, the run
  tries a random wrong password. If that gets in (someone added a `trust` rule), no stored password counts as
  proven, so the run refuses short of `--rotate`, which sets one it knows. A rotation reuses a parked password
  rather than overwriting it, because it may be the current one, and fsyncs it in place before the role changes.
- **`store verify`** measures the lock read-only: the login, the rules, both refused doors, stray sessions
  and the grants. Any finding fails it. A store on another host never gets this far: selection refuses it, with no
  hatch; a `--workdir` naming
  no stack config is a finding.
  A URL that reaches this checkout's own stack around the lock's own address is a finding: `SLOPWEAVER_STORE_URL`
  (it overrides the lock's URL), or a `store-url` naming another host alias or port. It counts by address, or by
  any route that logs in to the same server (the start times match). **Any other URL that logs in on this Mac
  fails verify too**: its start time is read through the login being judged, so a forward into this stack can
  fake it. A deliberately different local Postgres opens with `SLOPWEAVER_ALLOW_LOCAL_STORE_ELSEWHERE=1`; that
  hatch admits a server on this machine only, never another host. A URL is read the way the
  store's own client reads it, so a postgres.js host list (`h1:p1,h2:p2`) is tried host by host, never skipped. `--workdir` names another
  checkout's stack.

## What it does not stop

- **Anything running as you**: it can read `secrets/store-url`, and it can drive Docker into the container,
  where `supabase_admin` needs no password ([hardening § 3](../../../docs/security/local-store-hardening.md#3--treat-docker-access-as-store-access)).
  A door-only store is a different build.
- **The recreate window**: between a container recreate and the next `store start` or `store lock`, the
  image's rules are back. The lock ends a session that used the window but cannot prevent one.
- **Containers on the store's network**, which reach Postgres as every Supabase service does.
- **An old password's session, to `store verify`**: it cannot tell a session opened on a replaced password from one
  on the current password. The run that replaces a password ends them all.
