import cron from "node-cron";
import { logger } from "./logger.js";
import { WayblerClient } from "./waybler.js";

export interface SchedulerConfig {
  cronExpression: string;
  timezone: string;
  lookAheadHours: number;
  maxSpotPrice: number;
  credentials: { username: string; password: string };
}

export function startScheduler(config: SchedulerConfig): cron.ScheduledTask {
  logger.info(
    `Scheduler started: cron="${config.cronExpression}", tz=${config.timezone}, lookAhead=${config.lookAheadHours}h, maxSpotPrice=${config.maxSpotPrice}`,
  );

  const task = cron.schedule(
    config.cronExpression,
    async () => {
      try {
        await charge(config);
      } catch (err) {
        logger.error(err, "Charging failed");
      }
    },
    { timezone: config.timezone },
  );

  return task;
}

async function charge(config: SchedulerConfig): Promise<void> {
  logger.info("Running scheduled charge...");

  const wayblerClient = new WayblerClient(config.credentials);
  try {
    await wayblerClient.initialize();

    // 1. Check if vehicle is plugged in
    if (!wayblerClient.isVehicleConnected()) {
      logger.info("No vehicle plugged in. Skipping.");
      return;
    }

    // 2. Check if already charging
    if (wayblerClient.isCharging()) {
      logger.info("Already charging. Skipping.");
      return;
    }

    // 3. Find lowest price in the look-ahead window
    const lowestPrice = wayblerClient.getLowestPrice(config.lookAheadHours);

    if (!lowestPrice) {
      logger.info(`No price data in next ${config.lookAheadHours}h. Skipping.`);
      return;
    }

    logger.info(
      `Lowest price in next ${config.lookAheadHours}h: ${lowestPrice.consumptionFee.total} ${lowestPrice.consumptionFee.currency} (at ${lowestPrice.at})`,
    );

    if (lowestPrice.consumptionFee.total > config.maxSpotPrice) {
      logger.info(
        `Lowest price ${lowestPrice.consumptionFee.total} exceeds max ${config.maxSpotPrice}. Skipping.`,
      );
      return;
    }

    // 4. Start charging - API expects price without VAT
    const result = await wayblerClient.startCharging(
      lowestPrice.consumptionFee.value,
    );

    if (result) {
      logger.info(
        `Charging started. Session ID: ${result.sessionId}, price limit: ${lowestPrice.consumptionFee.total}`,
      );
    } else {
      logger.info("Failed to start charging (no connected station found).");
    }
  } finally {
    wayblerClient.disconnect();
  }
}
