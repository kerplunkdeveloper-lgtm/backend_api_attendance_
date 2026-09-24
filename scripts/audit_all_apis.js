const http = require("http");

const BASE_URL = "http://localhost:5000/api";

async function request(path, options = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  return new Promise((resolve, reject) => {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };

    const req = http.request(
      url,
      {
        method: options.method || "GET",
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: parsed,
            });
          } catch (e) {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              raw: data,
            });
          }
        });
      },
    );

    req.on("error", reject);
    if (options.body) {
      req.write(
        typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body),
      );
    }
    req.end();
  });
}

async function runAudit() {
  console.log("====================================================");
  console.log("      WORKPULSE 360° API SUITE AUDIT & HEALTH CHECK");
  console.log("====================================================\n");

  let passed = 0;
  let failed = 0;
  const results = [];

  function logTest(moduleName, endpoint, status, pass, info = "") {
    if (pass) {
      passed++;
      console.log(
        `  [PASS] ${moduleName.padEnd(16)} | ${endpoint.padEnd(35)} | HTTP ${status} ${info}`,
      );
    } else {
      failed++;
      console.log(
        `  [FAIL] ${moduleName.padEnd(16)} | ${endpoint.padEnd(35)} | HTTP ${status} - ${info}`,
      );
    }
    results.push({ module: moduleName, endpoint, status, pass, info });
  }

  try {
    // 1. Health
    const health = await request("/health");
    logTest(
      "Health",
      "/api/health",
      health.status,
      health.status === 200,
      health.data?.message || "",
    );

    // 2. Auth Logins
    const adminLogin = await request("/auth/login", {
      method: "POST",
      body: { email: "admin@workpulse.com", password: "Password@123" },
    });
    const adminToken = adminLogin.data?.data?.accessToken;
    logTest(
      "Auth (Admin)",
      "/api/auth/login",
      adminLogin.status,
      Boolean(adminToken),
      `Token received`,
    );

    const empLogin = await request("/auth/login", {
      method: "POST",
      body: { email: "employee@workpulse.com", password: "Password@123" },
    });
    const empToken = empLogin.data?.data?.accessToken;
    logTest(
      "Auth (Emp)",
      "/api/auth/login",
      empLogin.status,
      Boolean(empToken),
      `Token received`,
    );

    const hrLogin = await request("/auth/login", {
      method: "POST",
      body: { email: "hr@workpulse.com", password: "Password@123" },
    });
    const hrToken = hrLogin.data?.data?.accessToken;
    logTest(
      "Auth (HR)",
      "/api/auth/login",
      hrLogin.status,
      Boolean(hrToken),
      `Token received`,
    );

    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    const empHeaders = { Authorization: `Bearer ${empToken}` };
    const hrHeaders = { Authorization: `Bearer ${hrToken}` };

    // Auth /me
    const me = await request("/auth/me", { headers: adminHeaders });
    logTest(
      "Auth Profile",
      "/api/auth/me",
      me.status,
      me.status === 200,
      `User: ${me.data?.user?.email || me.data?.email}`,
    );

    // 3. Attendance APIs
    const today = await request("/attendance/today", { headers: empHeaders });
    logTest(
      "Attendance",
      "/api/attendance/today",
      today.status,
      today.status === 200,
      `ClockedIn: ${today.data?.clockedIn}`,
    );

    const summaryAll = await request("/attendance/summary", {
      headers: adminHeaders,
    });
    logTest(
      "Attendance",
      "/api/attendance/summary",
      summaryAll.status,
      summaryAll.status === 200,
      `Total: ${summaryAll.data?.totalEmployees}`,
    );

    const branchesRes = await request("/branches", { headers: adminHeaders });
    const firstBranchId = branchesRes.data?.data?.[0]?.id || "";
    if (firstBranchId) {
      const summaryBranch = await request(
        `/attendance/summary?branchId=${firstBranchId}`,
        { headers: adminHeaders },
      );
      logTest(
        "Attendance",
        "/api/attendance/summary?branchId",
        summaryBranch.status,
        summaryBranch.status === 200,
        `Branch Total: ${summaryBranch.data?.totalEmployees}`,
      );
    }

    const attList = await request("/attendance?limit=5", {
      headers: adminHeaders,
    });
    logTest(
      "Attendance",
      "/api/attendance",
      attList.status,
      attList.status === 200,
      `Records: ${attList.data?.records?.length ?? 0}`,
    );

    const attMy = await request("/attendance/my", { headers: empHeaders });
    logTest(
      "Attendance",
      "/api/attendance/my",
      attMy.status,
      attMy.status === 200,
      `My Records: ${attMy.data?.records?.length ?? 0}`,
    );

    // 4. Corrections / Regularizations
    const corrAll = await request("/attendance/corrections", {
      headers: adminHeaders,
    });
    logTest(
      "Corrections",
      "/api/attendance/corrections",
      corrAll.status,
      corrAll.status === 200,
      `Requests: ${corrAll.data?.data?.length ?? corrAll.data?.length ?? 0}`,
    );

    const corrMy = await request("/attendance/corrections/my", {
      headers: empHeaders,
    });
    logTest(
      "Corrections",
      "/api/attendance/corrections/my",
      corrMy.status,
      corrMy.status === 200,
      `Count: ${corrMy.data?.data?.length ?? corrMy.data?.length ?? 0}`,
    );

    // 5. Expenses
    const expSummary = await request("/expenses/summary", {
      headers: adminHeaders,
    });
    logTest(
      "Expenses",
      "/api/expenses/summary",
      expSummary.status,
      expSummary.status === 200,
      `Total Claimed: ${expSummary.data?.data?.totalClaimedAmount ?? 0}`,
    );

    const expAll = await request("/expenses", { headers: adminHeaders });
    logTest(
      "Expenses",
      "/api/expenses",
      expAll.status,
      expAll.status === 200,
      `Claims count: ${expAll.data?.data?.length ?? 0}`,
    );

    const expMy = await request("/expenses/my", { headers: empHeaders });
    logTest(
      "Expenses",
      "/api/expenses/my",
      expMy.status,
      expMy.status === 200,
      `My claims: ${expMy.data?.data?.length ?? 0}`,
    );

    // 6. Payroll
    const empsPre = await request("/employees", { headers: adminHeaders });
    const firstEmpId = empsPre.data?.data?.[0]?.id || "";
    const payrollCalc = await request(
      `/payroll/calculate?employeeId=${firstEmpId}&month=9&year=2026`,
      { headers: adminHeaders },
    );
    logTest(
      "Payroll",
      "/api/payroll/calculate",
      payrollCalc.status,
      payrollCalc.status === 200,
      `Calculated for employee`,
    );

    const payslips = await request("/payroll/payslips", {
      headers: adminHeaders,
    });
    logTest(
      "Payroll",
      "/api/payroll/payslips",
      payslips.status,
      payslips.status === 200,
      `Count: ${payslips.data?.data?.length ?? payslips.data?.length ?? 0}`,
    );

    const payslipsMy = await request("/payroll/payslips/my", {
      headers: empHeaders,
    });
    logTest(
      "Payroll",
      "/api/payroll/payslips/my",
      payslipsMy.status,
      payslipsMy.status === 200,
      `My payslips: ${payslipsMy.data?.data?.length ?? payslipsMy.data?.length ?? 0}`,
    );

    const payrollReports = await request("/payroll/reports?month=9&year=2026", {
      headers: adminHeaders,
    });
    logTest(
      "Payroll",
      "/api/payroll/reports",
      payrollReports.status,
      payrollReports.status === 200,
      `Generated: ${Boolean(payrollReports.data)}`,
    );

    // 7. Leaves
    const leaveTypes = await request("/leaves/types", {
      headers: adminHeaders,
    });
    logTest(
      "Leaves",
      "/api/leaves/types",
      leaveTypes.status,
      leaveTypes.status === 200,
      `Types: ${leaveTypes.data?.data?.length ?? leaveTypes.data?.length ?? 0}`,
    );

    const leaveBalances = await request("/leaves/balances", {
      headers: empHeaders,
    });
    logTest(
      "Leaves",
      "/api/leaves/balances",
      leaveBalances.status,
      leaveBalances.status === 200,
      `Balances loaded`,
    );

    const leaveRequests = await request("/leaves/requests", {
      headers: adminHeaders,
    });
    logTest(
      "Leaves",
      "/api/leaves/requests",
      leaveRequests.status,
      leaveRequests.status === 200,
      `Requests: ${leaveRequests.data?.data?.length ?? leaveRequests.data?.length ?? 0}`,
    );

    const leaveMy = await request("/leaves/my", { headers: empHeaders });
    logTest(
      "Leaves",
      "/api/leaves/my",
      leaveMy.status,
      leaveMy.status === 200,
      `My requests: ${leaveMy.data?.data?.length ?? leaveMy.data?.length ?? 0}`,
    );

    // 8. Holidays
    const holidays = await request("/holidays", { headers: adminHeaders });
    logTest(
      "Holidays",
      "/api/holidays",
      holidays.status,
      holidays.status === 200,
      `Count: ${holidays.data?.data?.length ?? holidays.data?.length ?? 0}`,
    );

    const holidaysUpcoming = await request("/holidays/upcoming", {
      headers: adminHeaders,
    });
    logTest(
      "Holidays",
      "/api/holidays/upcoming",
      holidaysUpcoming.status,
      holidaysUpcoming.status === 200,
      `Upcoming: ${holidaysUpcoming.data?.data?.length ?? holidaysUpcoming.data?.length ?? 0}`,
    );

    // 9. Workforce / Org
    const emps = await request("/employees", { headers: adminHeaders });
    logTest(
      "Employees",
      "/api/employees",
      emps.status,
      emps.status === 200,
      `Count: ${emps.data?.data?.length ?? 0}`,
    );

    const depts = await request("/departments", { headers: adminHeaders });
    logTest(
      "Departments",
      "/api/departments",
      depts.status,
      depts.status === 200,
      `Count: ${depts.data?.data?.length ?? 0}`,
    );

    logTest(
      "Branches",
      "/api/branches",
      branchesRes.status,
      branchesRes.status === 200,
      `Count: ${branchesRes.data?.data?.length ?? 0}`,
    );

    const shifts = await request("/shifts", { headers: adminHeaders });
    logTest(
      "Shifts",
      "/api/shifts",
      shifts.status,
      shifts.status === 200,
      `Count: ${shifts.data?.data?.length ?? 0}`,
    );

    // 10. Onboarding
    const onboarding = await request("/onboarding", { headers: adminHeaders });
    logTest(
      "Onboarding",
      "/api/onboarding",
      onboarding.status,
      onboarding.status === 200,
      `Candidates: ${onboarding.data?.data?.length ?? 0}`,
    );

    // 11. Reports
    const dailyReport = await request("/reports/daily", {
      headers: adminHeaders,
    });
    logTest(
      "Reports",
      "/api/reports/daily",
      dailyReport.status,
      dailyReport.status === 200,
      `Daily OK`,
    );

    const monthlyReport = await request("/reports/monthly", {
      headers: adminHeaders,
    });
    logTest(
      "Reports",
      "/api/reports/monthly",
      monthlyReport.status,
      monthlyReport.status === 200,
      `Monthly OK`,
    );

    // 12. Notifications
    const notifs = await request("/notifications", { headers: empHeaders });
    logTest(
      "Notifications",
      "/api/notifications",
      notifs.status,
      notifs.status === 200,
      `Items: ${notifs.data?.data?.length ?? notifs.data?.length ?? 0}`,
    );

    // 13. Devices
    const devices = await request("/devices", { headers: adminHeaders });
    logTest(
      "Devices",
      "/api/devices",
      devices.status,
      devices.status === 200,
      `Devices: ${devices.data?.devices?.length ?? 0}`,
    );

    const myDevices = await request("/devices/my", { headers: empHeaders });
    logTest(
      "Devices",
      "/api/devices/my",
      myDevices.status,
      myDevices.status === 200,
      `My devices: ${myDevices.data?.devices?.length ?? 0}`,
    );

    // 14. Audit Logs
    const audit = await request("/audit-logs", { headers: adminHeaders });
    logTest(
      "Audit Logs",
      "/api/audit-logs",
      audit.status,
      audit.status === 200,
      `Logs count: ${audit.data?.data?.length ?? audit.data?.logs?.length ?? 0}`,
    );
  } catch (err) {
    console.error("Test execution exception:", err);
    failed++;
  }

  console.log("\n====================================================");
  console.log(
    `AUDIT COMPLETE: ${passed} PASSED | ${failed} FAILED | TOTAL: ${passed + failed}`,
  );
  console.log("====================================================");

  if (failed === 0) {
    console.log("ALL API MODULES ARE RUNNING SMOOTHLY WITH 100% SUCCESS!");
    process.exit(0);
  } else {
    console.log(`WARNING: ${failed} API calls did not return HTTP 200.`);
    process.exit(1);
  }
}

runAudit();
