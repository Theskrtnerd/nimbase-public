import { env } from "~/env";

/**
 * The canonical public URL for a artifact share slug. One definition so the link
 * handed to chat surfaces and the `og:url` served on the page cannot drift.
 */
export function shareUrl(slug: string): string {
  return `${env.NIMBASE_WEB_URL}/s/${slug}`;
}
