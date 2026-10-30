use superdoc_sdk::{
    generated::types::{
        DocPresetDispatchBoundParams, DocPresetDispatchResult, DocPresetGetSystemPromptResult,
        DocPresetGetToolsParams, DocPresetGetToolsResult,
    },
    Document, FullToolkit, InvokeOptions, Result,
};

pub async fn full_toolkit_surface(
    document: &Document,
    policy: &DocPresetGetToolsParams,
    dispatch: &DocPresetDispatchBoundParams,
    options: InvokeOptions,
) -> Result<DocPresetDispatchResult> {
    let toolkit: FullToolkit = document.full_toolkit(policy).await?;
    let _: &DocPresetGetToolsResult = toolkit.tools();
    let _: &DocPresetGetSystemPromptResult = toolkit.system_prompt();
    let _: &str = toolkit.prompt();
    let _: &DocPresetGetToolsParams = toolkit.policy();
    toolkit.dispatch_with_options(dispatch, options).await
}

pub fn full_toolkit_future<'call>(
    document: &'call Document,
    policy: &'call DocPresetGetToolsParams,
) -> impl std::future::Future<Output = Result<FullToolkit>> + Send + 'call {
    document.full_toolkit(policy)
}

pub fn full_dispatch_future<'call>(
    toolkit: &'call FullToolkit,
    dispatch: &'call DocPresetDispatchBoundParams,
    options: InvokeOptions,
) -> impl std::future::Future<Output = Result<DocPresetDispatchResult>> + Send + 'call {
    toolkit.dispatch_with_options(dispatch, options)
}

fn main() {
    let _ = full_toolkit_surface;
    let _ = full_toolkit_future;
    let _ = full_dispatch_future;
}
