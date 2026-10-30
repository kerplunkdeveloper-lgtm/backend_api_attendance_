const prisma = require("../config/database");
const { uploadBuffer, deleteImage } = require("../config/cloudinary");
const { assertSniffedType } = require("../middleware/upload.middleware");

const MANAGE_ROLES = new Set(["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"]);
const clean = (value, max) => String(value || "").trim().slice(0, max);

const assertManager = (role) => {
  if (!MANAGE_ROLES.has(role)) {
    const error = new Error("Only an admin, HR or manager can manage company policies.");
    error.statusCode = 403;
    throw error;
  }
};

class CompanyPolicyService {
  async list(organizationId, role) {
    const managed = MANAGE_ROLES.has(role);
    return prisma.companyPolicy.findMany({
      where: {
        organizationId,
        ...(managed ? {} : { isPublished: true, archivedAt: null }),
      },
      orderBy: [{ archivedAt: "asc" }, { createdAt: "desc" }],
      select: {
        id: true, title: true, description: true, category: true, fileUrl: true,
        fileName: true, mimeType: true, fileSize: true, isPublished: true,
        publishedAt: true, archivedAt: true, createdAt: true, updatedAt: true,
        uploadedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async create(organizationId, user, body, file) {
    assertManager(user.role);
    if (!file) { const error = new Error("Select a policy file to import."); error.statusCode = 400; throw error; }
    assertSniffedType(file);
    const title = clean(body.title || file.originalname.replace(/\.[^.]+$/, ""), 160);
    if (!title) { const error = new Error("Policy title is required."); error.statusCode = 400; throw error; }
    const result = await uploadBuffer(file.buffer, {
      folder: `workpulse/${organizationId}/policies`, resource_type: "auto",
    });
    const isPublished = body.isPublished !== "false" && body.isPublished !== false;
    return prisma.companyPolicy.create({ data: {
      organizationId, title, description: clean(body.description, 1000) || null,
      category: clean(body.category || "GENERAL", 60).toUpperCase(), fileUrl: result.secure_url,
      filePublicId: result.public_id || null, fileName: file.originalname, mimeType: file.mimetype,
      fileSize: file.size, isPublished, publishedAt: isPublished ? new Date() : null,
      uploadedById: user.id,
    } });
  }

  async update(organizationId, user, id, body) {
    assertManager(user.role);
    const existing = await prisma.companyPolicy.findFirst({ where: { id, organizationId } });
    if (!existing) { const error = new Error("Company policy not found."); error.statusCode = 404; throw error; }
    const data = {};
    if (body.title !== undefined) data.title = clean(body.title, 160);
    if (body.description !== undefined) data.description = clean(body.description, 1000) || null;
    if (body.category !== undefined) data.category = clean(body.category, 60).toUpperCase();
    if (body.isPublished !== undefined) {
      const publish = body.isPublished === true || body.isPublished === "true";
      data.isPublished = publish; data.publishedAt = publish ? (existing.publishedAt || new Date()) : null;
    }
    if (body.archived !== undefined) data.archivedAt = body.archived === true || body.archived === "true" ? new Date() : null;
    data.updatedById = user.id;
    return prisma.companyPolicy.update({ where: { id }, data });
  }

  async remove(organizationId, user, id) {
    assertManager(user.role);
    const existing = await prisma.companyPolicy.findFirst({ where: { id, organizationId } });
    if (!existing) { const error = new Error("Company policy not found."); error.statusCode = 404; throw error; }
    await prisma.companyPolicy.delete({ where: { id } });
    if (existing.filePublicId) deleteImage(existing.filePublicId, { resource_type: "raw" }).catch(() => {});
  }
}

module.exports = new CompanyPolicyService();
