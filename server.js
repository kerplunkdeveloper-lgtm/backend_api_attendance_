require("dotenv").config();

const app = require("./src/app");
const notificationService = require("./src/services/notification.service");

function startBackgroundScheduler() {
  try {
    notificationService.startScheduler();
  } catch (err) {
    console.error("Failed to start notification scheduler:", err.message);
  }
}

// Support Phusion Passenger (used by Hostinger / cPanel shared hosting)
if (typeof PhusionPassenger !== "undefined") {
  PhusionPassenger.configure({ autoInstall: false });
  app.listen("passenger", () => {
    console.log("Server running via Phusion Passenger on Hostinger");
    startBackgroundScheduler();
  });
} else {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startBackgroundScheduler();
  });
}