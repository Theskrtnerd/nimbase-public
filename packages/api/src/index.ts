import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "./root";

/**
 * Inference helpers for input types
 * @example
 * type SourceListInput = RouterInputs['sources']['list']
 *      ^? { workspaceId: string }
 */
type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helpers for output types
 * @example
 * type SourceListOutput = RouterOutputs['sources']['list']
 */
type RouterOutputs = inferRouterOutputs<AppRouter>;

export { type AppRouter, appRouter } from "./root";
export { createTRPCContext } from "./trpc";
export {
  normalizeCompanyEmail,
  resolveUserProfile,
} from "./lib/company-identity";
export type {
  CompanyIdentity,
  UserProfileResolution,
  UserProfileResolutionKind,
} from "./lib/company-identity";
export type {
  ApiSession,
  BrainInitPort,
  CrawlPort,
  CrawlProviderInfo,
  GroupMcpAIPort,
  InvitePort,
  TokenPort,
} from "./trpc";
export type { RouterInputs, RouterOutputs };
