
const prisma = require("../config/database");

const {
  uploadImage,
  uploadBuffer,
} = require("../config/cloudinary");

const {
  uploadBuffer: uploadToS3,
  deleteObject: deleteFromS3,
} = require("../config/s3");

const {
  assertSniffedType,
} = require("../middleware/upload.middleware");

const {
  presentAuthUser,
} = require("./entitlement.service");

const {
  organizationWithSubscription,
} = require("../utils/prismaSelects");

const ACCEPTED_DATA_URI =
  /^data:image\/(jpeg|png|webp|gif);base64,/i;

const MAX_AVATAR_BYTES = 6 * 1024 * 1024;

const folderFor = (organizationId) =>
  `workpulse/${organizationId}/avatars`;

const toUrl = (result) =>
  result?.secure_url || result?.url;

function httpError(message, statusCode = 400, cause) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (cause) error.cause = cause;
  return error;
}

function isS3Enabled() {
  return process.env.STORAGE_PROVIDER === "s3";
}

function getUploadedFile(req) {
  return (
    req.file ||
    req.files?.image?.[0] ||
    req.files?.file?.[0] ||
    req.files?.avatar?.[0] ||
    (Array.isArray(req.files) ? req.files[0] : null)
  );
}

function decodeInlineImage(value) {
  if (
    typeof value !== "string" ||
    !ACCEPTED_DATA_URI.test(value)
  ) {
    throw httpError(
      "Choose a JPEG, PNG, WebP or GIF photo to upload."
    );
  }

  const comma = value.indexOf(",");
  const contentType = value
    .slice(5, value.indexOf(";"))
    .toLowerCase();

  const encoded = value.slice(comma + 1);

  if (
    !encoded ||
    encoded.length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4 + 8 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    throw httpError("Invalid avatar image.");
  }

  const buffer = Buffer.from(encoded, "base64");

  if (
    !buffer.length ||
    buffer.length > MAX_AVATAR_BYTES
  ) {
    throw httpError("Avatar must be 6 MB or smaller.");
  }

  const file = {
    buffer,
    mimetype: contentType,
    size: buffer.length,
  };

  assertSniffedType(file);

  return file;
}

function validateImage(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw httpError("Invalid avatar upload.");
  }

  if (
    !file.buffer.length ||
    file.buffer.length > MAX_AVATAR_BYTES
  ) {
    throw httpError("Avatar must be 6 MB or smaller.");
  }

  if (
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ].includes(file.mimetype)
  ) {
    throw httpError("Unsupported avatar image type.");
  }

  assertSniffedType(file);
}

function safeAvatarUrl(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw httpError("Invalid avatar URL.");
  }

  const trimmed = value.trim();

  if (!trimmed) return null;

  let parsed;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw httpError("Invalid avatar URL.");
  }

  // Never accept client-submitted internal S3 references.
  if (parsed.protocol !== "https:") {
    throw httpError("Avatar URL must use HTTPS.");
  }

  return parsed.toString();
}

function normalizeAvatarInput(input, organizationId) {
  if (input && typeof input === "object") {
    if (
      input.provider !== "s3" ||
      typeof input.key !== "string"
    ) {
      throw httpError("Invalid avatar upload result.");
    }

    const expectedPrefix =
      `organizations/${encodeURIComponent(String(organizationId))}/avatars/`;

    if (
      !input.key.startsWith(expectedPrefix) ||
      input.key.includes("..") ||
      input.key.includes("\\")
    ) {
      throw httpError("Invalid avatar storage key.", 403);
    }

    return {
      avatarUrl: null,
      avatarStorageKey: input.key,
      provider: "s3",
    };
  }

  return {
    avatarUrl: safeAvatarUrl(input),
    avatarStorageKey: null,
    provider: "cloudinary",
  };
}

async function cleanupUploadedAvatar(input, organizationId) {
  if (
    !input ||
    typeof input !== "object" ||
    input.provider !== "s3" ||
    !input.key
  ) {
    return;
  }

  try {
    await deleteFromS3(input.key, organizationId);
  } catch (error) {
    console.error("[S3] Avatar cleanup failed:", {
      key: input.key,
      message: error.message,
    });
  }
}

async function uploadS3Avatar(file, organizationId) {
  validateImage(file);

  try {
    const uploaded = await uploadToS3(file.buffer, {
      organizationId,
      folder: "avatars",
      contentType: file.mimetype,
    });

    if (!uploaded?.key) {
      throw new Error("S3 returned no object key");
    }

    return {
      provider: "s3",
      key: uploaded.key,
    };
  } catch (cause) {
    throw httpError(
      "Avatar S3 upload failed. Please try again.",
      502,
      cause
    );
  }
}

// --------------------------------------------------
// Upload avatar
// --------------------------------------------------

const uploadAvatarFile = async (req) => {
  const organizationId = req.user?.organizationId;

  if (!organizationId) {
    throw httpError(
      "Organization access required.",
      403
    );
  }

  const file = getUploadedFile(req);

  if (file) {
    validateImage(file);

    if (isS3Enabled()) {
      return uploadS3Avatar(file, organizationId);
    }

    try {
      const result = await uploadBuffer(file.buffer, {
        folder: folderFor(organizationId),
        resource_type: "image",
      });

      if (!toUrl(result)) {
        throw new Error("Cloudinary returned no URL");
      }

      return toUrl(result);
    } catch (cause) {
      throw httpError(
        cause?.statusCode === 503
          ? "Avatar storage is not configured on the server."
          : "Avatar storage upload failed. Please try again.",
        cause?.statusCode === 503 ? 503 : 502,
        cause
      );
    }
  }

  const inline =
    req.body?.image ||
    req.body?.file ||
    req.body?.avatarUrl;

  if (
    typeof inline === "string" &&
    ACCEPTED_DATA_URI.test(inline)
  ) {
    if (isS3Enabled()) {
      const image = decodeInlineImage(inline);

      return uploadS3Avatar(
        image,
        organizationId
      );
    }

    decodeInlineImage(inline);

    try {
      const result = await uploadImage(inline, {
        folder: folderFor(organizationId),
        resource_type: "image",
      });

      if (!toUrl(result)) {
        throw new Error("Cloudinary returned no URL");
      }

      return toUrl(result);
    } catch (cause) {
      throw httpError(
        cause?.statusCode === 503
          ? "Avatar storage is not configured on the server."
          : "Avatar storage upload failed. Please try again.",
        cause?.statusCode === 503 ? 503 : 502,
        cause
      );
    }
  }

  throw httpError(
    "Choose a JPEG, PNG, WebP or GIF photo to upload."
  );
};

// --------------------------------------------------
// Load user
// --------------------------------------------------

const loadAuthUser = (userId) =>
  prisma.user.findUnique({
    where: {
      id: userId,
    },
    include: {
      organization: organizationWithSubscription,
      employee: {
        include: {
          branch: true,
          shift: true,
          department: true,
        },
      },
    },
  });

// --------------------------------------------------
// Save own avatar
// --------------------------------------------------

const setMyAvatar = async (
  userId,
  organizationId,
  avatarInput
) => {
  const avatar = normalizeAvatarInput(
    avatarInput,
    organizationId
  );

  try {
    const existing = await prisma.user.findFirst({
      where: {
        id: userId,
        organizationId,
      },
      select: {
        id: true,
        avatarStorageKey: true,
      },
    });

    if (!existing) {
      throw httpError("User not found.", 404);
    }

    await prisma.$transaction([
      prisma.user.update({
        where: {
          id: existing.id,
        },
        data: {
          avatarUrl: avatar.avatarUrl,
          avatarStorageKey: avatar.avatarStorageKey,
        },
      }),

      prisma.employee.updateMany({
        where: {
          userId,
          organizationId,
          deletedAt: null,
        },
        data: {
          avatarUrl: avatar.avatarUrl,
          avatarStorageKey: avatar.avatarStorageKey,
        },
      }),
    ]);

    const user = await loadAuthUser(userId);

    if (!user) {
      throw httpError("User not found.", 404);
    }

    // Previous S3 objects are retained for now.
    // They should be cleaned only after reference checks.
    return presentAuthUser(user);
  } catch (error) {
    // Clean up only newly uploaded objects.
    if (
      avatarInput &&
      typeof avatarInput === "object" &&
      avatarInput.provider === "s3"
    ) {
      // A post-commit response failure must not delete
      // an avatar now referenced by the database.
      const linked = await prisma.user.findFirst({
        where: {
          id: userId,
          organizationId,
          avatarStorageKey: avatarInput.key,
        },
        select: { id: true },
      }).catch(() => null);

      if (!linked) {
        // In uncertain DB failure cases, retain the object.
        // A reconciliation job can remove verified orphans.
        console.warn(
          "[S3] Avatar save failed; object retained for reconciliation:",
          avatarInput.key
        );
      }
    }

    throw error;
  }
};

// --------------------------------------------------
// Admin/Manager updates employee avatar
// --------------------------------------------------

const setEmployeeAvatar = async (
  organizationId,
  employeeId,
  avatarInput
) => {
  const avatar = normalizeAvatarInput(
    avatarInput,
    organizationId
  );

  const employee = await prisma.employee.findFirst({
    where: {
      id: employeeId,
      organizationId,
      deletedAt: null,
    },
  });

  if (!employee) {
    // The controller must also enforce authorization.
    throw httpError("Employee not found.", 404);
  }

  const operations = [
    prisma.employee.update({
      where: {
        id: employee.id,
      },
      data: {
        avatarUrl: avatar.avatarUrl,
        avatarStorageKey: avatar.avatarStorageKey,
      },
    }),
  ];

  if (employee.userId) {
    operations.push(
      prisma.user.updateMany({
        where: {
          id: employee.userId,
          organizationId,
        },
        data: {
          avatarUrl: avatar.avatarUrl,
          avatarStorageKey: avatar.avatarStorageKey,
        },
      })
    );
  }

  await prisma.$transaction(operations);

  return prisma.employee.findFirst({
    where: {
      id: employee.id,
      organizationId,
    },
    include: {
      branch: true,
      department: true,
      shift: true,
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          avatarUrl: true,
        },
      },
    },
  });
};

module.exports = {
  uploadAvatarFile,
  setMyAvatar,
  setEmployeeAvatar,
};
