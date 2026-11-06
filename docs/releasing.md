# Maintainer release checklist

Beeblio publishes desktop installers for Apple Silicon macOS and Windows. Only a tag and published GitHub Release identify a downloadable version; commits on `main` are development snapshots.

1. Decide the version from changes since the last release: a patch for compatible fixes, a minor for compatible functionality, or a major for incompatible changes. Avoid creating retrospective releases for commits that were never shipped.
2. Update `package.json`, `desktop/package.json`, and `CHANGELOG.md` to the same version. Update README instructions if installation or requirements changed.
3. Review open issues and security reports for release blockers. Confirm `main` is clean and CI passes. For desktop changes, check a fresh-profile launch and the affected operating systems.
4. Merge the release changes into `main`. Create an annotated tag on that commit (`git tag -a vX.Y.Z -m "Beeblio X.Y.Z"`) and push the tag. The Desktop Release workflow checks both package versions, builds installers, and creates a draft release.
5. Inspect the draft release notes, contributors, `.dmg`, `.exe`, update metadata, and checksums or signatures if available. Download and install both artifacts on clean systems where possible. Publish the draft only after the checks pass; publishing makes the update visible to installed apps.
6. Verify the public release, its assets, and the update check. Move new work into the `Unreleased` changelog section.

A release candidate can use `vX.Y.Z-beta.N`. It is a prerelease and is not offered as a stable update. Do not move or reuse published tags.
