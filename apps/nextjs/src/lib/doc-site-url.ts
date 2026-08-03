/**
 * Where a published documentation site lives.
 *
 * Pure, and deliberately outside `~/server`: the build job, the REST response
 * shaper, and the dashboard panel all need this, and it previously existed as
 * three separate implementations — each with its own dev/prod branch — for the
 * single fact the whole feature is organized around.
 */

/**
 * The path every site is served under. Doubles as the Astro `base` the runner
 * bakes into the build, so the two cannot disagree — a mismatch means every
 * asset and nav link on the site resolves one path segment wrong. Both the
 * build (`build.ts`) and the serving route call this; keep it that way.
 */
export function docSiteBasePath(
  workspaceSlug: string,
  siteSlug: string,
): string {
  return `/${workspaceSlug}/${siteSlug}`;
}

/**
 * The public address of a docs site — stable for the site's whole life.
 *
 * The one definition. It previously existed three times (the build job, the
 * REST response shaper, and the dashboard panel), each with its own dev/prod
 * branch, for the single fact this feature is built around.
 *
 * `origin` is the docs host in production. Pass a dev origin to get a URL that
 * resolves locally, where there is no docs host at all.
 */
export function docSiteUrl(args: {
  workspaceSlug: string;
  siteSlug: string;
  docsHost?: string;
  devOrigin?: string;
}): string {
  const path = docSiteBasePath(args.workspaceSlug, args.siteSlug);
  return args.docsHost
    ? `https://${args.docsHost}${path}`
    : `${args.devOrigin ?? ""}/api/docs-site${path}`;
}
