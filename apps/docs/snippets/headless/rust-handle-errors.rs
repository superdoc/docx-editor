use std::error::Error;

use serde_json::json;
use superdoc_sdk::{generated::types::DocCommentsCreateBoundParams, Document};

pub async fn comment_if_present(
    document: &Document,
    quote: &str,
    note: &str,
) -> Result<bool, Box<dyn Error>> {
    let params: DocCommentsCreateBoundParams = serde_json::from_value(json!({
        "target": { "text": quote },
        "text": note
    }))?;

    match document.api().comments().create(&params).await {
        Ok(_) => Ok(true),
        Err(error) if error.code == "TARGET_NOT_FOUND" => Ok(false),
        Err(error) if error.outcome_unknown => {
            Err(format!("{error}; check the document before retrying").into())
        }
        Err(error) => Err(error.into()),
    }
}
