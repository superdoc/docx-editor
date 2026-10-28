use std::{error::Error, path::Path};

use serde_json::json;
use superdoc_sdk::{
    generated::types::{
        DocCloseBoundParams, DocOpenParams, DocSaveBoundParams,
        DocTrackChangesDecideBoundParams,
    },
    installation::{host_target, RuntimeManifest},
    Client, Document, HostMode,
};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn Error>> {
    let manifest = RuntimeManifest::pinned()?;
    let (cache, target) = (Path::new(".superdoc-runtime"), host_target()?);
    let runtime = manifest
        .resolve(cache, target)
        .or_else(|_| manifest.install(cache, target))?;
    let client = Client::connect(runtime.host_options(HostMode::Cli)?).await?;

    let result = accept_contract(&client).await;

    client.shutdown().await?;
    result
}

async fn accept_contract(client: &Client) -> Result<(), Box<dyn Error>> {
    let document = client
        .open(&DocOpenParams::new().with_doc("./contract.docx".into()))
        .await?;

    let result = accept_all(&document).await;

    document
        .close(&DocCloseBoundParams::new().with_discard(true))
        .await?;
    result
}

async fn accept_all(document: &Document) -> Result<(), Box<dyn Error>> {
    let decision: DocTrackChangesDecideBoundParams =
        serde_json::from_value(json!({
            "decision": "accept",
            "target": { "kind": "all" }
        }))?;
    document.api().track_changes().decide(&decision).await?;

    document
        .api()
        .save(
            &DocSaveBoundParams::new()
                .with_out("./contract.accepted.docx".into())
                .with_force(true),
        )
        .await?;
    Ok(())
}
