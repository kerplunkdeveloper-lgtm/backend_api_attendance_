const prisma = require("../config/database");
const { getTodayDateOnly } = require("./attendance.service");

class ReportService {
  /**
   * Daily Attendance Report
   */
  async getDailyReport(organizationId, targetDate = new Date()) {
    const dateOnly = getTodayDateOnly(new Date(targetDate));

    const [totalEmployees, records] = await Promise.all([
      prisma.employee.count({
        where: { organizationId, status: "ACTIVE" },
      }),
      prisma.attendance.findMany({
        where: { organizationId, date: dateOnly },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              department: { select: { id: true, name: true } },
            },
          },
          branch: { select: { id: true, name: true } },
          shift: { select: { id: true, name: true } },
        },
      }),
    ]);

    let present = 0;
    let late = 0;
    let halfDay = 0;
    let onLeave = 0;
    let wfh = 0;

    records.forEach((r) => {
      if (r.status === "PRESENT") present++;
      if (r.status === "LATE") late++;
      if (r.status === "HALF_DAY") halfDay++;
      if (r.status === "ON_LEAVE") onLeave++;
      if (r.status === "WORK_FROM_HOME") wfh++;
    });

    const totalMarked = records.length;
    const absent = Math.max(0, totalEmployees - totalMarked);

    return {
      success: true,
      date: dateOnly.toISOString().split("T")[0],
      summary: {
        totalEmployees,
        present,
        late,
        halfDay,
        wfh,
        onLeave,
        absent,
        attendanceRate: totalEmployees > 0 ? Math.round(((present + late + wfh) / totalEmployees) * 100) : 0,
      },
      records,
    };
  }

  /**
   * Monthly Attendance Summary Report by Employee
   */
  async getMonthlyReport(organizationId, month, year) {
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year) || new Date().getFullYear();

    const startDate = new Date(Date.UTC(y, m - 1, 1));
    const endDate = new Date(Date.UTC(y, m, 0));

    const [employees, attendances, leaves] = await Promise.all([
      prisma.employee.findMany({
        where: { organizationId, status: "ACTIVE" },
        include: {
          department: { select: { name: true } },
          branch: { select: { name: true } },
          shift: { select: { name: true } },
        },
      }),
      prisma.attendance.findMany({
        where: {
          organizationId,
          date: { gte: startDate, lte: endDate },
        },
      }),
      prisma.leaveRequest.findMany({
        where: {
          organizationId,
          status: "APPROVED",
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      }),
    ]);

    const report = employees.map((emp) => {
      const empAttendances = attendances.filter((a) => a.employeeId === emp.id);

      let presentDays = 0;
      let lateDays = 0;
      let halfDays = 0;
      let wfhDays = 0;
      let totalOvertimeMinutes = 0;
      let totalWorkingMinutes = 0;

      empAttendances.forEach((att) => {
        if (att.status === "PRESENT") presentDays++;
        if (att.status === "WORK_FROM_HOME") {
          presentDays++;
          wfhDays++;
        }
        if (att.status === "LATE") {
          presentDays++;
          lateDays++;
        }
        if (att.status === "HALF_DAY") {
          presentDays += 0.5;
          halfDays++;
        }
        totalOvertimeMinutes += att.overtimeMinutes || 0;
        totalWorkingMinutes += att.workingMinutes || 0;
      });

      const empLeaves = leaves.filter((l) => l.employeeId === emp.id);
      const approvedLeaveDays = empLeaves.reduce((sum, l) => sum + Number(l.totalDays), 0);

      return {
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        name: `${emp.firstName} ${emp.lastName || ""}`.trim(),
        department: emp.department?.name || "General",
        branch: emp.branch?.name || "HQ",
        presentDays,
        lateDays,
        halfDays,
        wfhDays,
        approvedLeaveDays,
        totalWorkingHours: (totalWorkingMinutes / 60).toFixed(1),
        overtimeHours: (totalOvertimeMinutes / 60).toFixed(1),
      };
    });

    return {
      success: true,
      month: m,
      year: y,
      totalEmployees: employees.length,
      report,
    };
  }
}

module.exports = new ReportService();
