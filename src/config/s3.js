
const crypto = require("node:crypto");

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");

const {
  getSignedUrl,
} = require("@aws-sdk/s3-request-presigner");

const REGION = process.env.AWS_REGION || "ap-south-1";

const BUCKET =
  process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET;

// Uses the default AWS credentials chain.
// On Production EC2, credentials come from the attached IAM role.
const s3 = new S3Client({ region: REGION });

function requireBucket() {
  if (!BUCKET) {
    throw new Error("S3 bucket environment variable is missing");
  }
}

function validateStorageKey(key, organizationId) {
  if (
    !organizationId ||
    typeof key !== "string" ||
    !key.startsWith(
      `organizations/${encodeURIComponent(String(organizationId))}/`
    ) ||
    key.includes("..") ||
    key.includes("\\")
  ) {
    const error = new Error("File access denied");
    error.statusCode = 403;
    throw error;
  }
}

function assertContentType(contentType, allowed) {
  if (typeof contentType !== "string" || !allowed.includes(contentType.toLowerCase())) {
    const error = new Error("Unsupported file type");
    error.statusCode = 400;
    throw error;
  }
}

async function uploadBuffer(
  buffer,
  {
    organizationId,
    folder = "uploads",
    contentType = "application/octet-stream",
  } = {}
) {
  requireBucket();

  const allowedFolders = new Set([
    "uploads",
    "avatars",
    "documents",
    "receipts",
    "onboarding",
    "branding",
    "payslip-assets",
  ]);

  if (
    !organizationId ||
    !Buffer.isBuffer(buffer) ||
    !allowedFolders.has(folder)
  ) {
    throw new Error("Invalid S3 upload request");
  }

  const key = [
    "organizations",
    encodeURIComponent(String(organizationId)),
    folder,
    crypto.randomUUID(),
  ].join("/");

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
  } catch (error) {
    if (error?.name === "CredentialsProviderError" || error?.code === "CredentialsProviderError") {
      const storageError = new Error(
        "S3 storage is not configured. Set AWS credentials or attach an IAM role to the server."
      );
      storageError.statusCode = 503;
      storageError.code = "S3_CREDENTIALS_MISSING";
      storageError.cause = error;
      throw storageError;
    }
    throw error;
  }

  return {
    bucket: BUCKET,
    key,
    bytes: buffer.length,
  };
}

async function getDownloadUrl(key, expiresIn = 300, organizationId = null) {
  requireBucket();

  if (organizationId) validateStorageKey(key, organizationId);
  else if (
    typeof key !== "string" ||
    !key.startsWith("organizations/") ||
    key.includes("..") ||
    key.includes("\\")
  ) throw new Error("Invalid S3 key");

  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
    { expiresIn }
  );
}

async function getFileContent(key, organizationId) {
  requireBucket();
  validateStorageKey(key, organizationId);

  const result = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );

  return {
    buffer: Buffer.from(
      await result.Body.transformToByteArray()
    ),
    contentType:
      result.ContentType || "application/octet-stream",
  };
}

async function verifyFileExists(key, organizationId) {
  requireBucket();
  validateStorageKey(key, organizationId);

  return s3.send(
    new HeadObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );
}

async function deleteObject(key, organizationId) {
  requireBucket();
  validateStorageKey(key, organizationId);

  return s3.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );
}

module.exports = {
  uploadBuffer,
  getDownloadUrl,
  getFileContent,
  verifyFileExists,
  deleteObject,
  validateStorageKey,
  assertContentType,
};
