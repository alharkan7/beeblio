# Changelog

This file records published Beeblio desktop releases. The source code on `main` may be newer than the latest published installer.

## [Unreleased]

## [1.1.0] - 2026-11-06

### Added

- Local data file analysis and a resizable workspace sidebar.
- LaTeX editing, compilation, and citation workflows. PDF compilation uses an optional local TeX installation.
- Keenable web search as an optional search tool, including a keyless endpoint. Thanks to Ilya Bogin for the contribution and provider disclosure in [PR #11](https://github.com/alharkan7/beeblio/pull/11).
- A way to reconnect a project after its linked folder moves, without creating a new project.

### Improved

- Updated Next.js and patched vulnerable DOMPurify and `proxy-addr` dependencies.
- Workspace file listings and folder navigation.
- Retry for failed chat messages, including repeated prompts. Thanks to idris chaalel for the initial retry contribution in [PR #8](https://github.com/alharkan7/beeblio/pull/8).
- Native folder selection across supported desktop platforms, with Linux cancellation and error handling. Thanks to idris chaalel for [PR #7](https://github.com/alharkan7/beeblio/pull/7).
- Activity date rendering and setup documentation.

### Notes

- Projects still store files in their linked local folders. Back up both those folders and Beeblio application data before upgrading.
- macOS and Windows installers remain unsigned unless the maintainer supplies signing credentials; see the README for platform guidance.

## [1.0.0] - 2026-10-15

- First published desktop release for Apple Silicon macOS and Windows. See the [v1.0.0 release](https://github.com/alharkan7/beeblio/releases/tag/v1.0.0).

[Unreleased]: https://github.com/alharkan7/beeblio/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/alharkan7/beeblio/compare/v1.0.0...v1.1.0
