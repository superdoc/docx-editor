use std::error::Error;

use serde_json::json;
use superdoc_sdk::{
    generated::types::DocPlanExecuteBoundParams, wire::Presence, Document,
};

pub async fn add_review_comments(
    document: &Document,
    review_notes: &[(&str, &str)],
) -> Result<(), Box<dyn Error>> {
    let entries: Vec<_> = review_notes
        .iter()
        .map(|(quote, note)| {
            json!({
                "operationId": "comments.create",
                "input": { "target": { "text": quote }, "text": note }
            })
        })
        .collect();
    let plan: DocPlanExecuteBoundParams =
        serde_json::from_value(json!({ "entries": entries }))?;
    let result = document.api().plan().execute(&plan).await?;

    if let Presence::Present(failure) = result.failure {
        return Err(format!(
            "comment {} ({}) failed: {}",
            failure.entry_index.get(),
            failure.operation_id,
            failure.message
        )
        .into());
    }
    Ok(())
}
