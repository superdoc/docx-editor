# Releasing @superdoc/fonts

Orbit's root `stable-release-pipeline.yml` owns stable fonts releases, and the Next branch release (`next-branch-release.yml`) owns prereleases from the `next` branch. Maintainers dispatch the stable pipeline against `stable`; the default is a dry run. Eligible font-package or shared font-system changes select an independent version from the `fonts-v${version}` history using the pipeline's conventional-commit rules. The `fonts` toggle controls publication, and `fonts-version` can override the calculated stable version for recovery.

The planner stamps `packages/fonts/package.json`. Versions must be `0.x.y` for stable or `0.x.y-next.N` for next, with a base above `0.2.0`, the last legacy-only release recorded in `scripts/fonts-release-scope.mjs`. The canonical scope can be absent on its first publication; authentication and transport errors still fail planning. The Next branch release plans fonts as one of its release families.

The fonts job checks family-list drift and unit tests, builds the package, and packs the canonical tarball. The existing mirror publisher derives `@superdoc-dev/fonts` from those same bytes, changing only package identity. Both tarballs pass the artifact audit. An isolated consumer install checks the ESM, type and browser entry points, all bundled font files and licenses, and browser font loading with a published SuperDoc release before publication.

Dry runs exercise those checks and npm's dry-run publish for both names without uploading, retagging or deprecating anything. Real stable runs publish both names on `latest`, deprecate the mirror version, and write the `fonts-v` tag and matching channel note only after successful publication. The Next branch release publishes and deprecates the same pair on `next` from its frozen publication plan.

For a partial publish, rerun the failed fonts publish job from the same workflow run and stamped commit. The stable pipeline also accepts the same explicit version with fonts selected. Existing registry artifacts must match the rebuilt tarballs before the publisher can complete the pair. If source changed, cut a new version instead. No public-repository workflow publishes fonts separately.

The font binaries and license texts originate in `shared/font-system/assets`. Keep the font pack aligned with that source when adding or changing families. Consumers install `@superdoc/fonts`; see the package README for loading and migration guidance.
