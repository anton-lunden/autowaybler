import { logger } from "./logger.js";
import { startScheduler } from "./scheduler.js";

const email = process.env.WAYBLER_EMAIL;
const password = process.env.WAYBLER_PASSWORD;

if (!email || !password) {
  logger.error("Missing required env vars: WAYBLER_EMAIL and WAYBLER_PASSWORD");
  process.exit(1);
}

const cronExpression = process.env.CRON ?? "0 17-23 * * *";
const timezone = process.env.TZ ?? "Europe/Stockholm";
const parsedHours = Number(process.env.LOOK_AHEAD_HOURS ?? "14");
if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
  logger.error("LOOK_AHEAD_HOURS must be a positive number");
  process.exit(1);
}
const lookAheadHours = Math.min(parsedHours, 24);

const parsedMaxPrice = Number(process.env.MAX_SPOT_PRICE ?? "1.5");
if (!Number.isFinite(parsedMaxPrice) || parsedMaxPrice <= 0) {
  logger.error("MAX_SPOT_PRICE must be a positive number");
  process.exit(1);
}
const maxSpotPrice = parsedMaxPrice;

logger.info("autowaybler starting...");

const task = startScheduler({
  cronExpression,
  timezone,
  lookAheadHours,
  maxSpotPrice,
  credentials: { username: email, password },
});

const shutdown = () => {
  logger.info("Shutting down...");
  task.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
