import json
import os
import time
from pathlib import Path

from superdoc import SuperDocClient

SNAPSHOT_EVERY_RECORDS = 250
SNAPSHOT_EVERY_SECONDS = 10 * 60

document_id = os.environ.get("DOCUMENT_ID", "contract-123")
token = os.environ["OBSERVER_TOKEN"]

history_dir = Path("history") / document_id
records_file = history_dir / "records.jsonl"
cursor_file = history_dir / "cursor.txt"
(history_dir / "snapshots").mkdir(parents=True, exist_ok=True)

stored_ids = set()
if records_file.exists():
    for line in records_file.read_text().splitlines():
        if line:
            stored_ids.add(json.loads(line)["id"])
cursor = cursor_file.read_text() if cursor_file.exists() else ""


def save_snapshot(document):
    snapshot = document.changes.snapshot({"includeState": True})
    name = snapshot["at"].replace(":", "-") + ".json"
    (history_dir / "snapshots" / name).write_text(json.dumps(snapshot))


with SuperDocClient() as client:
    document = client.open(
        {
            "collaboration": {
                "providerType": "hocuspocus",
                "url": os.environ.get("COLLAB_URL", "ws://127.0.0.1:1234"),
                "documentId": document_id,
                "roomMode": "join",
            },
        },
        collaboration_auth={"type": "token", "token": token},
    )

    try:
        save_snapshot(document)
        since_snapshot = 0
        last_snapshot_at = time.monotonic()

        while True:
            params = {"waitMs": 30000, "includeUpdate": True}
            if cursor:
                params["after"] = cursor
            result = document.changes.list(params)

            with records_file.open("a") as records:
                for record in result["items"]:
                    if record["id"] in stored_ids:
                        continue
                    records.write(json.dumps(record) + "\n")
                    stored_ids.add(record["id"])
                    since_snapshot += 1
            cursor = result["cursor"] or ""
            cursor_file.write_text(cursor)

            idle = not result["items"] and since_snapshot > 0
            due = since_snapshot >= SNAPSHOT_EVERY_RECORDS or (
                since_snapshot > 0 and time.monotonic() - last_snapshot_at >= SNAPSHOT_EVERY_SECONDS
            )
            if result["truncated"] or idle or due:
                save_snapshot(document)
                since_snapshot = 0
                last_snapshot_at = time.monotonic()
    finally:
        document.close({"discard": True})
