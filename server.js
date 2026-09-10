require("dotenv").config();

const app = require("./src/app");
const notificationService = require("./src/services/notification.service");

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  notificationService.startScheduler();
});