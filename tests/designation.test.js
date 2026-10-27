const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

let titles;
let employees;
let db;

mockPrisma(
  (db = {
    department: { findFirst: async ({ where }) => (where.id === "dept-1" && where.organizationId === "org-1" ? { id: "dept-1", name: "Production" } : null) },
    designation: {
      findMany: async ({ where }) => titles.filter((t) => t.departmentId === where.departmentId),
      findFirst: async ({ where }) => {
        const row = titles.find((t) => t.id === where.id && t.organizationId === where.organizationId);
        return row ? { ...row } : null;
      },
      create: async ({ data }) => {
        const row = { id: `t-${titles.length + 1}`, ...data };
        titles.push(row);
        return row;
      },
      update: async ({ where, data }) => Object.assign(titles.find((t) => t.id === where.id), data),
      delete: async ({ where }) => {
        titles = titles.filter((t) => t.id !== where.id);
      },
    },
    employee: {
      updateMany: async ({ where, data }) => {
        employees.filter((e) => e.departmentId === where.departmentId && e.designation.toLowerCase() === where.designation.equals.toLowerCase()).forEach((e) => Object.assign(e, data));
      },
    },
    $transaction: async (fn) => fn(db),
  }),
);

const service = require("../src/services/department.service");

describe("designations inside a department", () => {
  beforeEach(() => {
    titles = [{ id: "t-1", organizationId: "org-1", departmentId: "dept-1", name: "Editor" }];
    employees = [
      { id: "e-1", departmentId: "dept-1", designation: "Editor" },
      { id: "e-2", departmentId: "dept-2", designation: "Editor" },
    ];
  });

  it("adds a title, trimming and collapsing spaces", async () => {
    const row = await service.createDesignation("org-1", "dept-1", "  Senior   Editor ");
    assert.equal(row.name, "Senior Editor");
  });

  it("refuses a blank name, a long name and a repeat in any letter case", async () => {
    await assert.rejects(() => service.createDesignation("org-1", "dept-1", "  "), /required/);
    await assert.rejects(() => service.createDesignation("org-1", "dept-1", "x".repeat(61)), /60 characters/);
    await assert.rejects(() => service.createDesignation("org-1", "dept-1", "editor"), (e) => e.statusCode === 409);
  });

  it("will not add to a department of another company", async () => {
    await assert.rejects(() => service.createDesignation("org-2", "dept-1", "Editor"), (e) => e.statusCode === 404);
  });

  it("renaming moves people who hold the old title in that department only", async () => {
    await service.updateDesignation("org-1", "t-1", "Lead Editor");
    assert.equal(employees[0].designation, "Lead Editor");
    assert.equal(employees[1].designation, "Editor", "another department is untouched");
  });

  it("renaming to an existing title is refused", async () => {
    titles.push({ id: "t-2", organizationId: "org-1", departmentId: "dept-1", name: "Producer" });
    await assert.rejects(() => service.updateDesignation("org-1", "t-2", "EDITOR"), (e) => e.statusCode === 409);
  });

  it("deleting a title leaves employees' profiles alone", async () => {
    await service.deleteDesignation("org-1", "t-1");
    assert.equal(titles.length, 0);
    assert.equal(employees[0].designation, "Editor");
    await assert.rejects(() => service.deleteDesignation("org-1", "missing"), (e) => e.statusCode === 404);
  });
});
