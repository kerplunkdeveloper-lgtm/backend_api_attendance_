/**
 * Separation of duties for payroll. HR prepares (salary structures, previews, templates); an admin approves
 * and locks the month. These checks are enforced here, on the server, matching what the Permissions page
 * tells customers, so the menu is not the only thing standing between HR and the final say.
 */

const ADMIN_ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN"];
// HR is a full payroll operator. Managers may prepare/review attendance but
// are not allowed to create or finalize payroll.
const PAYROLL_APPROVER_ROLES = [...ADMIN_ROLES, "HR"];
/** Final payroll status moves are available to company admins and HR payroll operators. */
const ADMIN_ONLY_STATUSES = ["APPROVED", "REJECTED", "DISBURSED"];

const forbidden = (message) => Object.assign(new Error(message), { statusCode: 403 });

const assertCanSetStatus = (role, status) => {
  if (!PAYROLL_APPROVER_ROLES.includes(role) && ADMIN_ONLY_STATUSES.includes(status)) {
    throw forbidden("Only a company/platform admin or HR payroll operator can approve, reject or disburse payroll.");
  }
};

/**
 * HR may prepare salaries for others but not set their own pay.
 * `findOwn(employeeIds)` resolves truthy when one of the employees is the caller.
 */
const assertNotOwnSalary = async ({ role, employeeIds, findOwn }) => {
  if (ADMIN_ROLES.includes(role)) return;
  const ids = [...new Set((employeeIds || []).filter(Boolean).map(String))];
  if (!ids.length) return;
  if (await findOwn(ids)) throw forbidden("You cannot change your own salary. Ask an admin to do it.");
};

module.exports = { assertCanSetStatus, assertNotOwnSalary, ADMIN_ONLY_STATUSES, PAYROLL_APPROVER_ROLES };
