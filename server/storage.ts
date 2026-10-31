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
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

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

// Assessment submissions can contain learner work and must remain private even
// if a legacy R2 public URL is configured for ordinary Portal attachments. Store
// those objects encrypted; their plaintext is only returned after the Portal's
// own authorization route has approved the request.
const PRIVATE_OBJECT_MAGIC = Buffer.from("JLT-A1");
const PRIVATE_OBJECT_IV_BYTES = 12;
const PRIVATE_OBJECT_TAG_BYTES = 16;

function privateStorageKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Private document storage requires JWT_SECRET");
  return createHash("sha256").update(`jlt-private-storage-v1:${secret}`).digest();
}

export function encryptPrivateStoragePayload(plaintext: Buffer) {
  const iv = randomBytes(PRIVATE_OBJECT_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", privateStorageKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([PRIVATE_OBJECT_MAGIC, iv, tag, encrypted]);
}

export function decryptPrivateStoragePayload(payload: Buffer) {
  const headerBytes = PRIVATE_OBJECT_MAGIC.length + PRIVATE_OBJECT_IV_BYTES + PRIVATE_OBJECT_TAG_BYTES;
  if (payload.length <= headerBytes || !payload.subarray(0, PRIVATE_OBJECT_MAGIC.length).equals(PRIVATE_OBJECT_MAGIC)) {
    throw new Error("This file is not a recognised private Portal document");
  }
  const ivStart = PRIVATE_OBJECT_MAGIC.length;
  const tagStart = ivStart + PRIVATE_OBJECT_IV_BYTES;
  const ciphertextStart = tagStart + PRIVATE_OBJECT_TAG_BYTES;
  const decipher = createDecipheriv("aes-256-gcm", privateStorageKey(), payload.subarray(ivStart, tagStart));
  decipher.setAuthTag(payload.subarray(tagStart, ciphertextStart));
  return Buffer.concat([decipher.update(payload.subarray(ciphertextStart)), decipher.final()]);
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
 * Store an encrypted object for private Academy assessment material. Deliberately
 * returns no usable public URL: callers must use a Portal authorization route to
 * decrypt and stream the file back to an authorised person.
 */
export async function storagePutEncrypted(
  relKey: string,
  data: Buffer | Uint8Array | string,
): Promise<{ key: string }> {
  const client = getS3Client();
  const bucket = getBucket();
  const key = normalizeKey(relKey);
  const plaintext = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  const body = encryptPrivateStoragePayload(plaintext);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: "application/octet-stream",
    CacheControl: "no-store",
  }));
  return { key };
}

/** Retrieve and decrypt an encrypted private object after application-level access checks. */
export async function storageGetDecrypted(relKey: string): Promise<Buffer> {
  const client = getS3Client();
  const response = await client.send(new GetObjectCommand({ Bucket: getBucket(), Key: normalizeKey(relKey) }));
  const body = response.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!body?.transformToByteArray) throw new Error("Private document storage returned no readable file body");
  const encrypted = Buffer.from(await body.transformToByteArray());
  return decryptPrivateStoragePayload(encrypted);
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
