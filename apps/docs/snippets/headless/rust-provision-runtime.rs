use std::path::Path;

use superdoc_sdk::{
    installation::{host_target, RuntimeManifest},
    Client, HostMode, Result,
};

pub fn install_runtime(cache: &Path) -> Result<()> {
    RuntimeManifest::pinned()?.install(cache, host_target()?)?;
    Ok(())
}

pub async fn connect_installed_runtime(cache: &Path) -> Result<Client> {
    let runtime = RuntimeManifest::pinned()?.resolve(cache, host_target()?)?;
    Client::connect(runtime.host_options(HostMode::Cli)?).await
}
