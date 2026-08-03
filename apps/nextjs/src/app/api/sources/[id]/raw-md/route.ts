import { redirectToSourceArtifact } from "~/server/sources/raw-redirect";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return redirectToSourceArtifact(req, id, "raw-md");
}
