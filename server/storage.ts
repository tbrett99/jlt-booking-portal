/**
 * Storage helpers — Cloudflare R2 (S3-compatible)
 *
 * Required environment variables:
 *   S3_ENDPOINT        — e.g. https://3f31c81c6887e295e3264f1245f52473.r2.cloudflarestorage.com
 *   S3_ACCESS_KEY_ID   — R2 Access Key ID
 *   S3_SECRET_ACCESS_KEY — R2 Secret Access Key
 *   S3_BUCKET          — bucket name, e.g. jlt-portal-files
 *   S3_PUBLIC_URL      — public base URL, e.g. https://pub-xxx.r2.dev
 *                        (or a custom domain if you set one up later)
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getS3Client(): S3Client {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    const missing = ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]
      .filter((v) => !process.env[v])
      .join(", ");
    throw new Error(
      `Document storage is not configured on this server (missing: ${missing}). Please contact support.`
    );
  }

  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET environment variable is not set");
  return bucket;
}

function getPublicUrl(key: string): string {
  const base = process.env.S3_PUBLIC_URL;
  if (!base) throw new Error("S3_PUBLIC_URL environment variable is not set");
  return `${base.replace(/\/+$/, "")}/${key}`;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

/**
 * Upload a file to R2 and return its public URL.
 * The R2 bucket must have public access enabled for the returned URL to work.
 */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const client = getS3Client();
  const bucket = getBucket();
  const key = normalizeKey(relKey);

  const body = typeof data === "string" ? Buffer.from(data) : data;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  const url = getPublicUrl(key);
  return { key, url };
}

/**
 * Get a presigned download URL for a private file, or the public URL if the
 * bucket is public. Presigned URLs expire after 1 hour.
 */
export async function storageGet(
  relKey: string,
  expiresIn = 3600
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);

  // If the bucket is public, just return the direct URL — no signing needed
  if (process.env.S3_PUBLIC_URL) {
    return { key, url: getPublicUrl(key) };
  }

  // Fallback: generate a presigned URL
  const client = getS3Client();
  const bucket = getBucket();
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn }
  );
  return { key, url };
}
