require("dotenv").config();
const app = require("./src/app");
const notificationService = require("./src/services/notification.service");

// When executed directly (e.g. node index.js)
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    notificationService.startScheduler();
  });
}

// Export Express app for Vercel / serverless runtime
module.exports = app;
