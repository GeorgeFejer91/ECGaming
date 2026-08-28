# VDO.Ninja SDK 1.5.5

This directory vendors the official VDO.Ninja SDK release tagged `v1.5.5` from <https://github.com/steveseguin/ninjasdk> for static, local loading by EC Gaming. It was copied from Affect Tracker's pinned, verified vendor directory.

Files copied without modification:

| File                  | Upstream path              | SHA-256                                                            |
| --------------------- | -------------------------- | ------------------------------------------------------------------ |
| `vdoninja-sdk.min.js` | `dist/vdoninja-sdk.min.js` | `390ea6c8b1a4e57bf7fa18ff2b394f25cc79e637130f97e4a29ca958a90fac77` |
| `LICENSE-MPL-2.0.txt` | `LICENSE`                  | `3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04` |

The SDK is licensed under the Mozilla Public License 2.0. EC Gaming's independently written adapter is `src/protocol/remote.ts` and remains under the repository's BSD-3-Clause license. The adapter follows the tested data-only room/channel semantics established by Affect Tracker without copying its coordinate-specific adapter.
