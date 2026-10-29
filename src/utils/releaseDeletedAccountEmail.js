/**
 * Free an email address held by a soft-deleted employee account.
 * User.email is tenant-unique even when the linked employee is deleted.
 * Keep the historical rows for audit and foreign-key integrity, but move the
 * old login email to a deterministic tombstone so it can be reused.
 */
async function releaseDeletedEmployeeEmail(db, organizationId, email) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) return false;

  // Most callers store emails lower-case, but older imports may have preserved
  // casing. Use an insensitive fallback so a deleted legacy account cannot
  // keep an address locked just because the casing changed.
  const existing = typeof db.user.findFirst === "function"
    ? await db.user.findFirst({
      where: { organizationId, email: { equals: cleanEmail, mode: "insensitive" } },
      select: { id: true, employee: { select: { deletedAt: true } } },
    })
    : await db.user.findUnique({
      where: { organizationId_email: { organizationId, email: cleanEmail } },
      select: { id: true, employee: { select: { deletedAt: true } } },
    });
  if (!existing?.employee?.deletedAt) return false;

  await db.user.update({
    where: { id: existing.id },
    data: {
      email: `deleted+${existing.id}@deleted.workpulse.local`,
      isActive: false,
    },
  });
  return true;
}

module.exports = { releaseDeletedEmployeeEmail };
