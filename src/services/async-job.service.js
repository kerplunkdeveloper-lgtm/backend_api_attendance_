const prisma = require("../config/database");
const { getRedis, logRedisError } = require("../config/redis");

const QUEUE = "workpulse:jobs";
let workerRunning = false;
let workerClient = null;

const jsonSafe = (value) => JSON.parse(JSON.stringify(value));

async function createJob({ organizationId, userId, type, payload }) {
  const job = await prisma.asyncJob.create({ data: { organizationId, userId, type, payload: payload || {} } });
  const message = JSON.stringify({ id: job.id, organizationId, userId, type, payload: payload || {} });
  try {
    const redis = await getRedis();
    if (redis) await redis.lPush(QUEUE, message);
    else setImmediate(() => runJob(job.id).catch((error) => logRedisError(error)));
  } catch (error) {
    await prisma.asyncJob.update({ where: { id: job.id }, data: { status: "FAILED", error: "Queue is unavailable.", completedAt: new Date() } }).catch(() => {});
    throw error;
  }
  return job;
}

async function executeJob(job) {
  if (job.type === "PAYROLL_GENERATE") {
    const payrollService = require("./payroll.service");
    return payrollService.generateOrganizationPayslips(job.organizationId, job.payload.month, job.payload.year);
  }
  if (job.type === "REPORT_DAILY") {
    const reportService = require("./report.service");
    return reportService.getDailyReport(job.organizationId, job.payload.date || undefined);
  }
  if (job.type === "REPORT_MONTHLY") {
    const reportService = require("./report.service");
    return reportService.getMonthlyReport(job.organizationId, job.payload.month, job.payload.year);
  }
  const error = new Error(`Unknown async job type: ${job.type}`);
  error.statusCode = 400;
  throw error;
}

async function runJob(id) {
  const job = await prisma.asyncJob.findUnique({ where: { id } });
  if (!job || job.status === "COMPLETED") return job;
  await prisma.asyncJob.update({ where: { id }, data: { status: "RUNNING", progress: 10, startedAt: new Date(), error: null } });
  try {
    const result = await executeJob(job);
    return prisma.asyncJob.update({ where: { id }, data: { status: "COMPLETED", progress: 100, result: jsonSafe(result), completedAt: new Date() } });
  } catch (error) {
    return prisma.asyncJob.update({ where: { id }, data: { status: "FAILED", progress: 100, error: String(error?.message || "Job failed").slice(0, 1000), completedAt: new Date() } });
  }
}

async function startWorker() {
  if (workerRunning) return;
  const redis = await getRedis();
  if (!redis) return;
  workerClient = redis.duplicate();
  workerClient.on("error", logRedisError);
  await workerClient.connect();
  workerRunning = true;
  console.log("[jobs] Redis worker started");
  while (workerRunning) {
    try {
      const item = await workerClient.brPop(QUEUE, 0);
      const message = JSON.parse(item?.element || "{}");
      if (message.id) await runJob(message.id);
    } catch (error) {
      logRedisError(error);
      if (workerRunning) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function stopWorker() {
  workerRunning = false;
  if (workerClient?.isOpen) await workerClient.quit().catch(() => workerClient.disconnect());
  workerClient = null;
}

async function getJob(user, id) {
  return prisma.asyncJob.findFirst({ where: { id, organizationId: user.organizationId, userId: user.id } });
}

async function listJobs(user) {
  return prisma.asyncJob.findMany({ where: { organizationId: user.organizationId, userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
}

module.exports = { createJob, getJob, listJobs, runJob, startWorker, stopWorker };
