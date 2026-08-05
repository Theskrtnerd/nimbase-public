import { isArtifactRuntimeAssetName } from "@acme/runtime/artifact-runtime";

import { fetchArtifactRuntimeAsset } from "~/server/artifact/runtime-assets";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset } = await params;
  if (!isArtifactRuntimeAssetName(asset)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const bytes = await fetchArtifactRuntimeAsset(asset);
    return new Response(new TextDecoder().decode(bytes), {
      headers: {
        "cache-control": "public, max-age=86400, s-maxage=86400",
        "content-type": "application/javascript; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Artifact runtime unavailable", { status: 502 });
  }
}
