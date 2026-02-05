import { listSites } from "./db.ts";
import { runSite } from "./runner.ts";

const DEFAULT_INTERVAL_MINUTES = 360;
const DEFAULT_EVERY_DAYS = 6;

export function startScheduler() {
  const intervalMinutes = Number.parseInt(
    process.env.SCHEDULER_INTERVAL_MINUTES ?? String(DEFAULT_INTERVAL_MINUTES),
    10,
  );
  const everyDays = Number.parseInt(
    process.env.SCHEDULE_EVERY_DAYS ?? String(DEFAULT_EVERY_DAYS),
    10,
  );

  const intervalMs = Math.max(intervalMinutes, 1) * 60_000;
  const windowMs = Math.max(everyDays, 1) * 24 * 60 * 60_000;

  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const sites = await listSites();

      const now = Date.now();
      for (const site of sites) {
        if (!site.enabled) continue;

        const lastRun = site.last_run_at ? Date.parse(site.last_run_at) : NaN;
        if (Number.isNaN(lastRun) || now - lastRun >= windowMs) {
          console.log(`[scheduler] triggering run for site ${site.id}`);
          await runSite(site.id);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[scheduler] error: ${message}`);
    } finally {
      running = false;
    }
  };

  console.log(
    `[scheduler] interval ${intervalMinutes}m, window ${everyDays}d`,
  );
  void tick();
  setInterval(() => void tick(), intervalMs);
}
