# Collaborative version history

A backend that keeps named versions of a shared SuperDoc room. Several people edit one DOCX together. The server
saves versions of the room on a schedule and on request, lists them, compares any two as tracked changes, and
restores an old version into the live room without dropping anyone's work.

Copy this directory into your own repository and replace the file storage with your own.

## Run it

Requires Node 22.12 or newer and pnpm 11.

pnpm 11 stops before `pnpm dev` unless esbuild, which runs the server's TypeScript, may run its install script.
Allow it in your copy's `pnpm-workspace.yaml`, or add the same entry to your existing workspace file:

```bash
printf "allowBuilds:\n  esbuild: true\n" > pnpm-workspace.yaml
pnpm install
pnpm dev
```

Open the printed address in two browser windows, with `?user=Ann` and `?user=Ben`. Both edit the same room.
The server listens on `ws://127.0.0.1:1250` and keeps rooms and versions in `./version-data`.

## Running from an Orbit checkout

The source workspace SDK has no packaged CLI binary. Build the engine, SuperDoc and SDK with the repository
setup instructions, install Bun 1.3.11, then run this from `superdoc/public`:

```bash
SUPERDOC_CLI_BIN="$PWD/apps/cli/src/index.ts" pnpm --filter @superdoc-examples/collaborative-version-history dev
```

The copied example installed from npm uses the SDK's embedded CLI instead.

## Two kinds of saving

The example keeps two separate records of a document. Most applications need both.

| | Room draft | Version |
| --- | --- | --- |
| What it is | The live, shared editing state | A DOCX file of the room at one moment |
| When it is written | Continuously, a few seconds after each change | On a trigger or when someone saves one |
| Can it change later | Yes, every edit changes it | No, a version is never rewritten |
| What it is for | Not losing work, rejoining, surviving restarts | Going back, comparing, sharing, signing off |

The room draft is the autosave. Its writes are debounced: receiving an edit or showing Connected does not
acknowledge a durable write. A process crash can lose edits received since the last completed room write.
Versions are the history. Each one is an exact DOCX, so you can download it, compare it, or restore it later.
A successful save response acknowledges that its DOCX and version manifest were written and renamed; these
files survive a process restart. This local-file example does not fsync files or provide a power-loss guarantee.
Use storage with the required durability acknowledgement before promising stronger guarantees.

## When versions are saved

Automatic versions come from these triggers. Each one can be changed or turned off.

| Variable | Default | Saves a version when |
| --- | --- | --- |
| `CHECKPOINT_IDLE_MS` | `30000` | Edits stop for this long |
| `CHECKPOINT_MAX_INTERVAL_MS` | `600000` | Editing continues for this long without a pause |
| `CHECKPOINT_WHEN_LAST_EDITOR_LEAVES` | `on` | The last person leaves the room |

Set a duration to `off` to disable that trigger. A version is also saved when the server shuts down with unsaved
edits, and before every restore.

An automatic version is saved only when the room changed since the last version. If its exported DOCX is
byte-for-byte identical to the newest version, that checkpoint is reused. Named saves always create distinct
versions, including simultaneous requests. Saving a named version resets the automatic schedule.

There is no single right number. Every version costs a full DOCX in storage and a moment of server work, so
frequent versions make a longer list and a bigger bill. Rare versions mean fewer points to go back to. Pick the
triggers from what your users go back to:

- **Review or approval steps:** save a named version at each step from your own application, and keep only a
  slow idle trigger.
- **AI edits:** save a version right after someone accepts an AI change, by calling the save route from your
  accept handler. That gives a clear point to compare against or undo to.
- **Long drafting sessions:** keep the maximum interval so a long session still leaves points to return to.
- **Content-change thresholds:** count meaningful document mutations in your integration and request a named
  version when a configurable count or size threshold is reached. Combine that threshold with a maximum time
  interval, and reset the counter only for changes included in an acknowledged save. This example schedules
  by time; it does not prescribe a universal mutation count. Tune the threshold from measured DOCX size,
  save latency, storage cost and the amount of work your users can afford to reconstruct.

## Closing the tab and losing the connection

A synchronized edit and a persisted edit are different milestones. Room drafts are written asynchronously.
For a checkpoint that must survive a process restart, wait for a successful save response and retain its
version id. A disconnected browser cannot establish that acknowledgement.

- **Connection drops:** SuperDoc keeps the edits in the open tab and sends them when the connection returns.
  The page shows that the editor is offline.
- **Tab closes while offline:** edits that never reached the server are lost. A save in `pagehide` or
  `beforeunload` cannot fix this, because the browser does not wait for network requests there. Show people
  when they are offline instead.
- **Last person leaves:** the server saves a version, so the history matches what people last saw.
- **Server stops:** the server stops accepting edits, saves a version of every room with unsaved edits, then
  exits. After a restart, rooms and versions are read back from storage.

## Restoring a version

Restoring never deletes history. It adds new versions:

1. The server saves the room as it is now, labelled "Before restore".
2. It changes the live room to match the chosen version. Everyone in the room sees the change as a normal edit.
3. It saves the result as a new version that records which version was restored.

Two checks stop a restore from overwriting work:

- The request names the newest version the user saw. If someone saved a version since, the server answers
  `409` with `reason: "stale-base"` and changes nothing. Refresh the list and try again.
- If someone edits the room while the restore runs, the server stops and answers `409` with
  `reason: "room-changed"`. The "Before restore" version is kept, and the room keeps the new edit.

## Comparing versions

Compare returns a DOCX of the older version with the newer one's changes as tracked changes. The changes are
shown as made by the server, not by the person who typed them; use the version list to see who saved each
version. Stored versions are not changed. If the two versions cannot be shown as tracked changes, the server
answers `422` with the reasons.

## Routes

| Route | Does |
| --- | --- |
| `GET /api/documents/:id/versions` | Lists versions, oldest first, and the newest version's id |
| `POST /api/documents/:id/versions` | Saves the room as a named version: `{ "label", "createdBy" }` |
| `GET /api/documents/:id/versions/:version/content` | Downloads a version as DOCX |
| `GET /api/documents/:id/compare?from=v1&to=v3` | Downloads the comparison as tracked changes |
| `POST /api/documents/:id/restore` | Restores: `{ "versionId", "baseVersionId", "requestedBy" }` |

Version ids are assigned by the server, in order. Two saves at the same moment become two versions.

This example has no sign-in. Add your own access check to the routes and to room connections before you deploy
it.

## What this history is, and is not

This is a history of saved versions. It records:

- every version, its label, who or what saved it, and when;
- for any two versions, the changes between them as tracked changes;
- every restore, as new versions that point to the restored one.

It is not a record of every keystroke. Edits between two versions are only visible as the difference between
them. Changes someone typed and then deleted before a version was saved do not appear. Tracked changes that were
rejected before a version was saved leave no record. If you need a tamper-proof audit trail, store versions in
storage that cannot be rewritten, and record your own approval events next to them.

## Test it

```bash
pnpm test:server
pnpm browsers
pnpm test:browser
```

The browser test opens two editors. It saves versions from both at once, compares them, restores an old version,
refuses an outdated restore, takes one editor offline and back, then restarts the server and checks that every
saved version is unchanged.
