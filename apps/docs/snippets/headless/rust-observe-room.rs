use std::{
    collections::HashSet,
    error::Error,
    fs,
    io::Write,
    path::PathBuf,
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use superdoc_sdk::{
    generated::types::{
        DocChangesListBoundParams, DocChangesSnapshotBoundParams,
        DocCloseBoundParams, DocOpenParams,
    },
    wire::{Nullable, Number},
    Client, CollaborationAuth, Document, OpenOptions,
};

const SNAPSHOT_EVERY_RECORDS: usize = 250;
const SNAPSHOT_EVERY: Duration = Duration::from_secs(10 * 60);

pub struct FileHistory {
    dir: PathBuf,
    stored_ids: HashSet<String>,
    cursor: Option<String>,
}

impl FileHistory {
    pub fn open(document_id: &str) -> Result<Self, Box<dyn Error>> {
        let dir = PathBuf::from("history").join(document_id);
        fs::create_dir_all(dir.join("snapshots"))?;
        let mut stored_ids = HashSet::new();
        if let Ok(lines) = fs::read_to_string(dir.join("records.jsonl")) {
            for line in lines.lines().filter(|line| !line.is_empty()) {
                let record: Value = serde_json::from_str(line)?;
                if let Some(id) = record["id"].as_str() {
                    stored_ids.insert(id.to_owned());
                }
            }
        }
        let cursor = fs::read_to_string(dir.join("cursor.txt"))
            .ok()
            .filter(|cursor| !cursor.is_empty());
        Ok(Self {
            dir,
            stored_ids,
            cursor,
        })
    }

    fn append(&mut self, records: &[Value]) -> Result<usize, Box<dyn Error>> {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.dir.join("records.jsonl"))?;
        let mut added = 0;
        for record in records {
            let Some(id) = record["id"].as_str() else {
                continue;
            };
            if !self.stored_ids.insert(id.to_owned()) {
                continue;
            }
            writeln!(file, "{record}")?;
            added += 1;
        }
        Ok(added)
    }

    fn save_cursor(
        &mut self,
        cursor: Option<String>,
    ) -> Result<(), Box<dyn Error>> {
        fs::write(
            self.dir.join("cursor.txt"),
            cursor.as_deref().unwrap_or(""),
        )?;
        self.cursor = cursor;
        Ok(())
    }

    fn save_snapshot(&self, snapshot: &Value) -> Result<(), Box<dyn Error>> {
        let at = snapshot["at"]
            .as_str()
            .unwrap_or("snapshot")
            .replace(':', "-");
        fs::write(
            self.dir.join("snapshots").join(format!("{at}.json")),
            snapshot.to_string(),
        )?;
        Ok(())
    }
}

pub async fn observe_room(
    client: &Client,
    url: &str,
    document_id: &str,
    token: &str,
    should_stop: impl Fn() -> bool,
) -> Result<(), Box<dyn Error>> {
    let params: DocOpenParams = serde_json::from_value(json!({
        "collaboration": {
            "providerType": "hocuspocus",
            "url": url,
            "documentId": document_id,
            "roomMode": "join"
        }
    }))?;
    let options = OpenOptions {
        collaboration_auth: Some(CollaborationAuth::token(token)?),
        ..OpenOptions::default()
    };
    let document = client.open_with_options(&params, options).await?;
    let mut history = FileHistory::open(document_id)?;

    let result = copy_records(&document, &mut history, should_stop).await;

    document
        .close(&DocCloseBoundParams::new().with_discard(true))
        .await?;
    result
}

async fn save_snapshot(
    document: &Document,
    history: &FileHistory,
) -> Result<(), Box<dyn Error>> {
    let snapshot = document
        .api()
        .changes()
        .snapshot(
            &DocChangesSnapshotBoundParams::new().with_include_state(true),
        )
        .await?;
    history.save_snapshot(&serde_json::to_value(&snapshot)?)
}

async fn copy_records(
    document: &Document,
    history: &mut FileHistory,
    should_stop: impl Fn() -> bool,
) -> Result<(), Box<dyn Error>> {
    save_snapshot(document, history).await?;
    let mut since_snapshot = 0;
    let mut last_snapshot_at = Instant::now();

    while !should_stop() {
        let mut list = DocChangesListBoundParams::new()
            .with_wait_ms(Number::new(30000.0)?)
            .with_include_update(true);
        if let Some(after) = &history.cursor {
            list = list.with_after(after.clone());
        }
        let result = document.api().changes().list(&list).await?;

        let records = serde_json::to_value(&result.items)?;
        since_snapshot += history
            .append(records.as_array().map(Vec::as_slice).unwrap_or(&[]))?;
        history.save_cursor(match result.cursor {
            Nullable::Value(cursor) => Some(cursor),
            Nullable::Null => None,
        })?;

        let idle = result.items.is_empty() && since_snapshot > 0;
        let due = since_snapshot >= SNAPSHOT_EVERY_RECORDS
            || (since_snapshot > 0
                && last_snapshot_at.elapsed() >= SNAPSHOT_EVERY);
        if result.truncated || idle || due {
            save_snapshot(document, history).await?;
            since_snapshot = 0;
            last_snapshot_at = Instant::now();
        }
    }
    Ok(())
}
