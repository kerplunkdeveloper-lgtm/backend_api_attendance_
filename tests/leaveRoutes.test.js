const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const routeSource = fs.readFileSync(
  require.resolve("../src/routes/leave.routes.js"),
  "utf8",
);

test("team leave balances exposes the frontend route and compatibility alias", () => {
  assert.match(routeSource, /router\.get\(\s*"\/balances\/team"/);
  assert.match(routeSource, /router\.get\(\s*"\/team-balances"/);
  assert.match(routeSource, /leaveController\.getTeamLeaveBalances/);
});
