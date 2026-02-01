import { join } from "node:path";

export const DATA_DIR = process.env.DATA_DIR ?? "./data";
export const DB_PATH = process.env.DB_PATH ?? join(DATA_DIR, "garden.db");
export const SCREENSHOT_DIR =
  process.env.SCREENSHOT_DIR ?? join(DATA_DIR, "screenshots");
export const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
