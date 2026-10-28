use std::error::Error;

use serde_json::json;
use superdoc_sdk::{
    generated::types::DocOpenParams, Client, CollaborationAuth, Document,
    OpenOptions,
};

pub async fn join_collaboration_document(
    client: &Client,
    url: &str,
    document_id: &str,
    token: &str,
) -> Result<Document, Box<dyn Error>> {
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
    Ok(client.open_with_options(&params, options).await?)
}
