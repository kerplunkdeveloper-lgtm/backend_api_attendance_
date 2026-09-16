const prisma = require("../config/database");
const { getTodayDateOnly } = require("./attendance.service");

class ReportService {
  /**
   * Daily Attendance Report
   */
  async getDailyReport(organizationId, targetDate = new Date()) {
    const dateOnly = getTodayDateOnly(new Date(targetDate));

    const [allEmployees, attendances, approvedLeaves, org] = await Promise.all([
      prisma.employee.findMany({
        where: { organizationId, status: "ACTIVE" },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          department: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
          shift: { select: { id: true, name: true, startTime: true, endTime: true } },
        },
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
      prisma.leaveRequest.findMany({
        where: {
          organizationId,
          status: "APPROVED",
          startDate: { lte: dateOnly },
          endDate: { gte: dateOnly },
        },
        select: {
          employeeId: true,
          type: true,
          reason: true,
        },
      }),
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
    ]);

    const attendanceMap = new Map(attendances.map((a) => [a.employeeId, a]));
    const leaveMap = new Map(approvedLeaves.map((l) => [l.employeeId, l]));

    let present = 0;
    let late = 0;
    let halfDay = 0;
    let onLeave = 0;
    let wfh = 0;
    let absent = 0;

    const fullRecords = allEmployees.map((emp) => {
      const att = attendanceMap.get(emp.id);
      if (att) {
        if (att.status === "PRESENT") present++;
        else if (att.status === "LATE") late++;
        else if (att.status === "HALF_DAY") halfDay++;
        else if (att.status === "WORK_FROM_HOME") wfh++;
        else if (att.status === "ON_LEAVE") onLeave++;
        else if (att.status === "ABSENT") absent++;

        return {
          id: att.id,
          date: att.date,
          employeeId: emp.id,
          employee: att.employee || emp,
          branch: att.branch || emp.branch,
          shift: att.shift || emp.shift,
          checkIn: att.checkIn,
          checkOut: att.checkOut,
          workHours: att.workHours || (att.workingMinutes ? att.workingMinutes / 60 : 0),
          workingMinutes: att.workingMinutes || 0,
          lateMinutes: att.lateMinutes || 0,
          status: att.status,
          wfhNote: att.wfhNote,
        };
      }

      const leave = leaveMap.get(emp.id);
      if (leave) {
        onLeave++;
        return {
          id: `leave-${emp.id}`,
          date: dateOnly,
          employeeId: emp.id,
          employee: emp,
          branch: emp.branch,
          shift: emp.shift,
          checkIn: null,
          checkOut: null,
          workHours: 0,
          workingMinutes: 0,
          lateMinutes: 0,
          status: "ON_LEAVE",
          wfhNote: leave.type ? `Approved Leave (${leave.type})` : "Approved Leave",
        };
      }

      absent++;
      return {
        id: `absent-${emp.id}`,
        date: dateOnly,
        employeeId: emp.id,
        employee: emp,
        branch: emp.branch,
        shift: emp.shift,
        checkIn: null,
        checkOut: null,
        workHours: 0,
        workingMinutes: 0,
        lateMinutes: 0,
        status: "ABSENT",
        wfhNote: "Unexcused Absence / Missed Punch",
      };
    });

    const totalEmployees = allEmployees.length;

    return {
      success: true,
      organizationName: org?.name || "WorkPulse Workforce",
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
      records: fullRecords,
      attendances: fullRecords,
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
    const daysInMonth = endDate.getUTCDate();

    const [employees, attendances, leaves, org] = await Promise.all([
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
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
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
      const absentDays = Math.max(0, 26 - Math.floor(presentDays) - Math.floor(approvedLeaveDays));

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
        absentDays,
        totalWorkingHours: (totalWorkingMinutes / 60).toFixed(1),
        overtimeHours: (totalOvertimeMinutes / 60).toFixed(1),
      };
    });

    return {
      success: true,
      organizationName: org?.name || "WorkPulse Workforce",
      month: m,
      year: y,
      totalEmployees: employees.length,
      daysInMonth,
      standardWorkingDays: 26,
      report,
    };
  }
}

module.exports = new ReportService();
