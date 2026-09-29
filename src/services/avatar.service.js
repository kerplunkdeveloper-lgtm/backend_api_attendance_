const prisma = require("../config/database");
const { uploadImage, uploadBuffer } = require("../config/cloudinary");
const { assertSniffedType } = require("../middleware/upload.middleware");
const { presentAuthUser } = require("./entitlement.service");
const { organizationWithSubscription } = require("../utils/prismaSelects");

const ACCEPTED_DATA_URI = /^data:image\/(jpeg|png|webp|gif);base64,/i;

const folderFor = (organizationId) => `workpulse/${organizationId}/avatars`;

const toUrl = (result) => result.secure_url || result.url;

/**
 * Reads a multipart file or inline data URI from the request and stores it.
 */
const uploadAvatarFile = async (req) => {
  const folder = folderFor(req.user.organizationId);
  const file =
    req.file ||
    (req.files &&
      (req.files.image?.[0] ||
        req.files.file?.[0] ||
        req.files.avatar?.[0] ||
        (Array.isArray(req.files) ? req.files[0] : null)));

  if (file) {
    assertSniffedType(file);
    let result;
    try {
      result = await uploadBuffer(file.buffer, {
        folder,
        resource_type: "image",
      });
    } catch (cause) {
      const error = new Error(
        cause?.statusCode === 503
          ? "Avatar storage is not configured on the server."
          : "Avatar storage upload failed. Please try again.",
      );
      error.statusCode = cause?.statusCode === 503 ? 503 : 502;
      error.cause = cause;
      throw error;
    }
    return toUrl(result);
  }

  const inline = req.body?.image || req.body?.file || req.body?.avatarUrl;
  if (typeof inline === "string" && ACCEPTED_DATA_URI.test(inline)) {
    let result;
    try {
      result = await uploadImage(inline, {
        folder,
        resource_type: "image",
      });
    } catch (cause) {
      const error = new Error(
        cause?.statusCode === 503
          ? "Avatar storage is not configured on the server."
          : "Avatar storage upload failed. Please try again.",
      );
      error.statusCode = cause?.statusCode === 503 ? 503 : 502;
      error.cause = cause;
      throw error;
    }
    return toUrl(result);
  }

  const err = new Error("Choose a JPEG, PNG, WebP or GIF photo to upload.");
  err.statusCode = 400;
  throw err;
};

const loadAuthUser = (userId) =>
  prisma.user.findUnique({
    where: { id: userId },
    include: {
      organization: organizationWithSubscription,
      employee: {
        include: { branch: true, shift: true, department: true },
      },
    },
  });

/** Signed-in user sets their own photo (admins without an employee row still work). */
const setMyAvatar = async (userId, organizationId, avatarUrl) => {
  const url = avatarUrl ? String(avatarUrl).trim() : null;
  await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: url },
  });
  await prisma.employee.updateMany({
    where: { userId, organizationId, deletedAt: null },
    data: { avatarUrl: url },
  });
  const user = await loadAuthUser(userId);
  if (!user) {
    const err = new Error("User not found");
    err.statusCode = 404;
    throw err;
  }
  return presentAuthUser(user);
};

/** Admin/manager sets a staff member's photo. */
const setEmployeeAvatar = async (organizationId, employeeId, avatarUrl) => {
  const url = avatarUrl ? String(avatarUrl).trim() : null;
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId, deletedAt: null },
  });
  if (!employee) {
    const err = new Error("Employee not found");
    err.statusCode = 404;
    throw err;
  }

  const ops = [
    prisma.employee.update({
      where: { id: employee.id },
      data: { avatarUrl: url },
    }),
  ];
  if (employee.userId) {
    ops.push(
      prisma.user.update({
        where: { id: employee.userId },
        data: { avatarUrl: url },
      }),
    );
  }
  await prisma.$transaction(ops);

  return prisma.employee.findFirst({
    where: { id: employee.id },
    include: {
      branch: true,
      department: true,
      shift: true,
      user: { select: { id: true, email: true, role: true, avatarUrl: true } },
    },
  });
};

module.exports = {
  uploadAvatarFile,
  setMyAvatar,
  setEmployeeAvatar,
};
