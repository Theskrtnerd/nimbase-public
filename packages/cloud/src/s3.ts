import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { cloudEnv } from "./env";

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;
  const env = cloudEnv();
  client = new S3Client({
    region: env.NIMBASE_S3_REGION,
    endpoint: env.NIMBASE_S3_ENDPOINT,
    forcePathStyle: env.NIMBASE_S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.NIMBASE_AWS_ACCESS_KEY_ID,
      secretAccessKey: env.NIMBASE_AWS_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

// Test/eval-only seam: when set, `putObject`/`getObject*` read/write this
// in-memory map instead of hitting S3, so the retrieval eval seeds and reads
// note bodies with no AWS credentials. Production NEVER sets it (the default
// stays the real S3 client). Both the text and byte body paths are
// intercepted (zip expansion writes entry bytes) — only the presign helpers
// are not exercised offline. Pass `null` to restore.
let memStore: Map<string, string | Uint8Array> | null = null;

export function setObjectStoreForTesting(
  store: Map<string, string | Uint8Array> | null,
): void {
  memStore = store;
}

export const s3KeyFor = {
  // Byte-exact, untouched original — same extension as captured.
  originalSource: (workspaceId: string, sourceId: string, ext: string) =>
    `workspaces/${workspaceId}/sources/${sourceId}/original.${ext}`,
  // Extracted text + metadata frontmatter, the sole input to compile.
  rawMdSource: (workspaceId: string, sourceId: string) =>
    `workspaces/${workspaceId}/sources/${sourceId}/raw.md`,
  wikiBody: (workspaceId: string, versionId: string) =>
    `workspaces/${workspaceId}/wiki/${versionId}.md`,
  shareHtml: (workspaceId: string, slug: string) =>
    `workspaces/${workspaceId}/shares/${slug}.html`,
  artifactHtml: (workspaceId: string, id: string) =>
    `workspaces/${workspaceId}/artifactes/${id}.html`,
  artifactSource: (workspaceId: string, id: string) =>
    `workspaces/${workspaceId}/artifactes/${id}.tsx`,
  // Projected Nimbus content handed to the build runner, one JSON bundle.
  docSiteInput: (workspaceId: string, buildId: string) =>
    `workspaces/${workspaceId}/docsites/builds/${buildId}/input.json`,
  // Built static output. Keyed by BUILD, not by site: a build lands in a fresh
  // prefix and DocSite.liveBuildId flips only once it succeeds, so a failed
  // rebuild can never half-overwrite a site that is already serving.
  docSiteAsset: (workspaceId: string, buildId: string, path: string) =>
    `workspaces/${workspaceId}/docsites/builds/${buildId}/dist/${path}`,
};

export async function putObject(
  key: string,
  body: string | Uint8Array,
  contentType: string,
): Promise<void> {
  if (memStore) {
    memStore.set(key, body);
    return;
  }
  await s3().send(
    new PutObjectCommand({
      Bucket: cloudEnv().NIMBASE_S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getObjectText(key: string): Promise<string> {
  if (memStore) {
    const stored = memStore.get(key);
    if (stored === undefined) return "";
    return typeof stored === "string"
      ? stored
      : Buffer.from(stored).toString("utf8");
  }
  const res = await s3().send(
    new GetObjectCommand({ Bucket: cloudEnv().NIMBASE_S3_BUCKET, Key: key }),
  );
  return (await res.Body?.transformToString()) ?? "";
}

export async function getObjectBytes(key: string): Promise<Uint8Array> {
  if (memStore) {
    const stored = memStore.get(key);
    if (stored === undefined) return new Uint8Array();
    return typeof stored === "string"
      ? new Uint8Array(Buffer.from(stored, "utf8"))
      : stored;
  }
  const res = await s3().send(
    new GetObjectCommand({ Bucket: cloudEnv().NIMBASE_S3_BUCKET, Key: key }),
  );
  return (await res.Body?.transformToByteArray()) ?? new Uint8Array();
}

// Short-lived URL the extension PUTs a raw binary capture to. Content type is
// pinned so the stored object serves with the right mime later.
export function presignPutUrl(
  key: string,
  contentType: string,
): Promise<string> {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: cloudEnv().NIMBASE_S3_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 600 },
  );
}

// Short-lived URL for viewing/playing a raw artifact (trace-back).
export function presignGetUrl(key: string): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: cloudEnv().NIMBASE_S3_BUCKET, Key: key }),
    { expiresIn: 900 },
  );
}

// Whether the object exists — finalize uses this to confirm an upload landed.
export async function headObject(key: string): Promise<boolean> {
  try {
    await s3().send(
      new HeadObjectCommand({ Bucket: cloudEnv().NIMBASE_S3_BUCKET, Key: key }),
    );
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === "NotFound") return false;
    throw err;
  }
}
