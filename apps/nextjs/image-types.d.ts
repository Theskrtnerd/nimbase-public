// Committed stand-in for the *.svg/*.png module declarations that normally
// come from the git-ignored next-env.d.ts, so `tsc --noEmit` works in CI and
// fresh worktrees where `next dev/build` has never run.
/// <reference types="next/image-types/global" />
