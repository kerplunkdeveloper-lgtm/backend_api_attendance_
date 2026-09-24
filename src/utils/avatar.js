/**
 * Utility to generate and resolve profile avatar URLs for employees and users.
 */

const generateDefaultAvatar = (firstName = "", lastName = "", code = "") => {
  const name = `${firstName || ""} ${lastName || ""}`.trim() || code || "Employee";
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff&size=256&bold=true`;
};

const resolveAvatarUrl = (data = {}) => {
  const explicit = data.avatarUrl || data.profileImage || data.profilePicture || data.avatar;
  if (explicit && typeof explicit === "string" && explicit.trim()) {
    return explicit.trim();
  }
  return generateDefaultAvatar(data.firstName, data.lastName, data.employeeCode);
};

module.exports = {
  generateDefaultAvatar,
  resolveAvatarUrl,
};
