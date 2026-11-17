const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { installModule } = require("./helpers/mockPrisma");

const folders = [
  "avatars",
  "documents",
  "receipts",
  "onboarding",
  "branding",
  "uploads",
];

const bucket = "clocked-test-private";
const organizationId = "org-a";
const otherOrganizationId = "org-b";
const objects = new Map();

let storage;
let originalS3Module;
let originalAwsSend;

function objectKeyFrom(command) {
  return command.input.Key;
}

describe("isolated private S3 storage contract", () => {
  before(() => {
    process.env.AWS_ACCESS_KEY_ID = "test-access-key";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.AWS_REGION = "ap-south-1";
    process.env.S3_BUCKET_NAME = bucket;

    const aws = require("@aws-sdk/client-s3");
    originalAwsSend = aws.S3Client.prototype.send;
    aws.S3Client.prototype.send = async function send(command) {
      const key = objectKeyFrom(command);
      const name = command.constructor.name;
      if (name === "PutObjectCommand") {
        objects.set(key, {
          buffer: Buffer.from(command.input.Body),
          contentType: command.input.ContentType,
        });
        return {};
      }
      if (name === "GetObjectCommand") {
        const stored = objects.get(key);
        if (!stored) {
          const error = new Error("NoSuchKey");
          error.name = "NoSuchKey";
          throw error;
        }
        return {
          ContentType: stored.contentType,
          Body: { transformToByteArray: async () => Uint8Array.from(stored.buffer) },
        };
      }
      if (name === "HeadObjectCommand") {
        if (!objects.has(key)) throw new Error("NotFound");
        return { ContentLength: objects.get(key).buffer.length };
      }
      if (name === "DeleteObjectCommand") {
        objects.delete(key);
        return {};
      }
      throw new Error(`Unsupported test command: ${name}`);
    };

    const s3Path = require.resolve("../src/config/s3");
    originalS3Module = require.cache[s3Path];
    delete require.cache[s3Path];
    storage = require("../src/config/s3");
  });

  after(() => {
    const aws = require("@aws-sdk/client-s3");
    aws.S3Client.prototype.send = originalAwsSend;
    const s3Path = require.resolve("../src/config/s3");
    if (originalS3Module) require.cache[s3Path] = originalS3Module;
    else delete require.cache[s3Path];
    objects.clear();
  });

  it("uploads, downloads and deletes every supported module folder", async () => {
    for (const folder of folders) {
      const body = Buffer.from(`fixture:${folder}`);
      const uploaded = await storage.uploadBuffer(body, {
        organizationId,
        folder,
        contentType: "application/octet-stream",
      });

      assert.match(uploaded.key, new RegExp(`^organizations/${organizationId}/${folder}/`));
      assert.doesNotMatch(uploaded.key, /[?&]X-Amz-/);
      assert.equal(uploaded.bucket, bucket);

      const displayUrl = await storage.getDownloadUrl(uploaded.key, 300);
      assert.match(displayUrl, /^https:\/\/clocked-test-private\.s3\.ap-south-1\.amazonaws\.com\//);
      assert.match(displayUrl, /X-Amz-Signature=/);

      await assert.rejects(
        () => storage.getDownloadUrl(uploaded.key, 300, otherOrganizationId),
        (error) => error.statusCode === 403,
      );

      const downloaded = await storage.getFileContent(uploaded.key, organizationId);
      assert.deepEqual(downloaded.buffer, body);
      assert.equal(downloaded.contentType, "application/octet-stream");

      await storage.deleteObject(uploaded.key, organizationId);
      await assert.rejects(() => storage.getFileContent(uploaded.key, organizationId), /NoSuchKey/);
    }
  });

  it("rejects cross-organization reads, heads and deletes", async () => {
    const uploaded = await storage.uploadBuffer(Buffer.from("tenant data"), {
      organizationId,
      folder: "documents",
      contentType: "application/pdf",
    });

    await assert.rejects(
      () => storage.getFileContent(uploaded.key, otherOrganizationId),
      (error) => error.statusCode === 403,
    );
    await assert.rejects(
      () => storage.verifyFileExists(uploaded.key, otherOrganizationId),
      (error) => error.statusCode === 403,
    );
    await assert.rejects(
      () => storage.deleteObject(uploaded.key, otherOrganizationId),
      (error) => error.statusCode === 403,
    );

    assert.ok(objects.has(uploaded.key), "cross-tenant delete must not remove the object");
    await storage.deleteObject(uploaded.key, organizationId);
  });

  it("rejects unsafe keys and unsupported folders", async () => {
    await assert.rejects(
      () => storage.uploadBuffer(Buffer.from("x"), { organizationId, folder: "../other" }),
      /Invalid S3 upload request/,
    );
    await assert.rejects(
      () => storage.getFileContent(`organizations/${organizationId}/documents/../secret`, organizationId),
      /File access denied/,
    );
    await assert.rejects(
      () => storage.getFileContent(`organizations/${organizationId}/documents/file`, otherOrganizationId),
      (error) => error.statusCode === 403,
    );
  });
});

describe("S3 service persistence contract", () => {
  let expenseService;
  let onboardingService;
  let orgService;
  let capturedExpense;
  let capturedOnboarding;
  let capturedOrganization;
  const originalModules = new Map();

  before(() => {
    process.env.STORAGE_PROVIDER = "s3";

    const fakeS3 = {
      uploadBuffer: async (buffer, { organizationId: orgId, folder, contentType }) => ({
        bucket,
        key: `organizations/${orgId}/${folder}/permanent-test-key`,
        bytes: buffer.length,
        contentType,
      }),
      getDownloadUrl: async (key) => `https://signed.test/${encodeURIComponent(key)}?X-Amz-Signature=test`,
      deleteObject: async () => ({}),
      getFileContent: async () => ({ buffer: Buffer.from("logo"), contentType: "image/png" }),
    };
    const fakeCloudinary = {
      uploadImage: async () => ({ secure_url: "https://res.cloudinary.com/legacy/image.png" }),
      uploadBuffer: async () => ({ secure_url: "https://res.cloudinary.com/legacy/file.pdf" }),
      signedDeliveryUrl: (url) => url,
      isSensitiveDocumentType: () => false,
    };
    const fakePrisma = {
      employee: {
        findFirst: async () => ({ id: "emp-a", organizationId, firstName: "A", lastName: "User", employeeCode: "E1", department: null }),
      },
      expenseClaim: {
        create: async ({ data, include }) => {
          capturedExpense = data;
          return { ...data, id: "expense-a", employee: include.employee.select };
        },
      },
      onboardingCandidate: {
        findUnique: async () => ({
          id: "candidate-a",
          organizationId,
          token: "candidate-token",
          status: "INVITED",
          expiresAt: new Date(Date.now() + 86400000),
          revokedAt: null,
          documents: [],
        }),
        update: async () => ({}),
      },
      onboardingDocument: {
        create: async ({ data }) => {
          capturedOnboarding = data;
          return data;
        },
      },
      organization: {
        findUnique: async () => ({ id: organizationId, logoStorageKey: null, hrAccess: {}, subscription: null }),
        update: async ({ data, include }) => {
          capturedOrganization = data;
          return { id: organizationId, ...data, subscription: include?.subscription ? null : undefined };
        },
      },
    };

    for (const modulePath of [
      "../src/config/database",
      "../src/config/s3",
      "../src/config/cloudinary",
      "../src/services/notification.service",
      "../src/services/email.service",
      "../src/services/whatsapp.service",
      "../src/services/expense.service",
      "../src/services/onboarding.service",
      "../src/services/org.service",
    ]) {
      const resolved = require.resolve(modulePath);
      originalModules.set(resolved, require.cache[resolved]);
    }

    installModule(require.resolve("../src/config/database"), fakePrisma);
    installModule(require.resolve("../src/config/s3"), fakeS3);
    installModule(require.resolve("../src/config/cloudinary"), fakeCloudinary);
    installModule(require.resolve("../src/services/notification.service"), { notifyReviewersOfRequest: async () => {} });
    installModule(require.resolve("../src/services/email.service"), {});
    installModule(require.resolve("../src/services/whatsapp.service"), {});
    delete require.cache[require.resolve("../src/services/expense.service")];
    delete require.cache[require.resolve("../src/services/onboarding.service")];
    delete require.cache[require.resolve("../src/services/org.service")];

    expenseService = require("../src/services/expense.service");
    onboardingService = require("../src/services/onboarding.service");
    orgService = require("../src/services/org.service");
  });

  after(() => {
    for (const [resolved, cached] of originalModules) {
      if (cached) require.cache[resolved] = cached;
      else delete require.cache[resolved];
    }
    delete process.env.STORAGE_PROVIDER;
  });

  it("persists permanent S3 keys for expense receipts, onboarding documents and branding", async () => {
    await expenseService.createExpenseClaim(organizationId, "emp-a", {
      category: "TRAVEL",
      amount: "125",
      title: "Taxi",
      receiptFile: { buffer: Buffer.from("%PDF-1.7 test"), mimetype: "application/pdf", size: 13 },
    });
    assert.equal(capturedExpense.receiptStorageProvider, "s3");
    assert.match(capturedExpense.receiptStorageKey, /^organizations\/org-a\/receipts\//);
    assert.equal(capturedExpense.receiptUrl, null);
    assert.doesNotMatch(capturedExpense.receiptStorageKey, /X-Amz-/);

    await onboardingService.uploadCandidateDocument("candidate-token", {
      documentType: "OTHER",
      fileName: "proof.pdf",
      file: { buffer: Buffer.from("%PDF-1.7 test"), mimetype: "application/pdf", size: 13, originalname: "proof.pdf" },
    });
    assert.equal(capturedOnboarding.storageProvider, "s3");
    assert.match(capturedOnboarding.storageKey, /^organizations\/org-a\/onboarding\//);
    assert.equal(capturedOnboarding.fileUrl, null);
    assert.doesNotMatch(capturedOnboarding.storageKey, /X-Amz-/);

    await orgService.uploadLogo(organizationId, {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]),
      mimetype: "image/png",
    });
    assert.equal(capturedOrganization.logoStorageProvider, "s3");
    assert.match(capturedOrganization.logoStorageKey, /^organizations\/org-a\/branding\//);
    assert.equal(capturedOrganization.logoUrl, null);
    assert.doesNotMatch(capturedOrganization.logoStorageKey, /X-Amz-/);
  });
});
