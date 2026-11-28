const jobService = require("../services/async-job.service");

const allowedTypes = new Set(["PAYROLL_GENERATE", "REPORT_DAILY", "REPORT_MONTHLY"]);

async function create(req, res) {
  const type = String(req.body?.type || "").trim();
  if (!allowedTypes.has(type)) return res.status(400).json({ success: false, message: "Unsupported async job type." });
  const payload = req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {};
  const job = await jobService.createJob({ organizationId: req.user.organizationId, userId: req.user.id, type, payload });
  return res.status(202).json({ success: true, data: job, message: "Job queued successfully." });
}

async function get(req, res) {
  const job = await jobService.getJob(req.user, req.params.id);
  if (!job) return res.status(404).json({ success: false, message: "Job not found." });
  return res.json({ success: true, data: job });
}

async function list(req, res) {
  return res.json({ success: true, data: await jobService.listJobs(req.user) });
}

module.exports = { create, get, list };
