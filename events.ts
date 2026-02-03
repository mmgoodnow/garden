import type { Response } from "express";
import { insertRunEvent } from "./db";

type RunEvent = {
  type: string;
  runId?: number;
  [key: string]: unknown;
};

type Client = {
  res: Response;
  keepalive: ReturnType<typeof setInterval>;
};

const clientsByRun = new Map<number, Set<Client>>();

export function subscribeRunEvents(runId: number, res: Response) {
  const client: Client = {
    res,
    keepalive: setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        // ignore; cleanup handled by close
      }
    }, 15000),
  };

  let clients = clientsByRun.get(runId);
  if (!clients) {
    clients = new Set();
    clientsByRun.set(runId, clients);
  }
  clients.add(client);

  sendEvent(res, { type: "ready", runId }, "ready");

  res.on("close", () => {
    cleanupClient(runId, client);
  });
}

export function emitRunEvent(runId: number, event: RunEvent) {
  const clients = clientsByRun.get(runId);

  if (clients && clients.size > 0) {
    for (const client of Array.from(clients)) {
      if (!sendEvent(client.controller, event, "message")) {
        cleanupClient(runId, client);
      }
    }
  }

  void persistRunEvent(runId, event);
}

function sendEvent(
  res: Response,
  event: RunEvent,
  name: string,
) {
  try {
    const payload = `event: ${name}\ndata: ${JSON.stringify(event)}\n\n`;
    res.write(payload);
    return true;
  } catch {
    return false;
  }
}

function cleanupClient(runId: number, client: Client) {
  clearInterval(client.keepalive);
  const clients = clientsByRun.get(runId);
  if (!clients) return;
  clients.delete(client);
  if (clients.size === 0) {
    clientsByRun.delete(runId);
  }
}

async function persistRunEvent(runId: number, event: RunEvent) {
  try {
    await insertRunEvent({
      run_id: runId,
      type: event.type,
      payload: JSON.stringify(event),
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn(
      `[events] failed to persist run event ${event.type} for ${runId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
