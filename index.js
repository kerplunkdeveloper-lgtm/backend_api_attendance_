require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });
const app = require("./src/app");
const notificationService = require("./src/services/notification.service");

function startBackgroundScheduler() {
  const flag = process.env.ENABLE_SCHEDULER;
  const enabled = flag === undefined ? process.env.NODE_ENV !== "production" : flag === "true";
  if (!enabled) {
    console.log("[scheduler] disabled (set ENABLE_SCHEDULER=true on one worker to enable)");
    return;
  }
  try {
    notificationService.startScheduler();
  } catch (err) {
    console.error("Failed to start notification scheduler:", err.message);
  }
}

// Support Phusion Passenger (used by Hostinger / cPanel)
if (typeof PhusionPassenger !== "undefined") {
  PhusionPassenger.configure({ autoInstall: false });
  app.listen("passenger", () => {
    console.log("Server running via Phusion Passenger on Hostinger");
    startBackgroundScheduler();
  });
} else if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startBackgroundScheduler();
  });
}
  
// Export Express app for Vercel / serverless runtime
module.exports = app;
