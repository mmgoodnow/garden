type RunEvent = {
  type: string;
  [key: string]: unknown;
};

type Client = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  keepalive: ReturnType<typeof setInterval>;
};

const encoder = new TextEncoder();
const clientsByRun = new Map<number, Set<Client>>();

export function subscribeRunEvents(runId: number) {
  let currentController: ReadableStreamDefaultController<Uint8Array> | null = null;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      currentController = controller;
      const client: Client = {
        controller,
        keepalive: setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            // ignore; cleanup handled by cancel
          }
        }, 15000),
      };

      let clients = clientsByRun.get(runId);
      if (!clients) {
        clients = new Set();
        clientsByRun.set(runId, clients);
      }
      clients.add(client);

      sendEvent(controller, { type: "ready", runId }, "ready");
    },
    cancel() {
      if (currentController) {
        removeClient(runId, currentController);
        currentController = null;
      }
    },
  });
}

export function emitRunEvent(runId: number, event: RunEvent) {
  const clients = clientsByRun.get(runId);
  if (!clients || clients.size === 0) return;

  for (const client of Array.from(clients)) {
    if (!sendEvent(client.controller, event, "message")) {
      cleanupClient(runId, client);
    }
  }
}

function sendEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: RunEvent,
  name: string,
) {
  try {
    const payload = `event: ${name}\ndata: ${JSON.stringify(event)}\n\n`;
    controller.enqueue(encoder.encode(payload));
    return true;
  } catch {
    return false;
  }
}

function removeClient(runId: number, controller: ReadableStreamDefaultController<Uint8Array>) {
  const clients = clientsByRun.get(runId);
  if (!clients) return;

  for (const client of clients) {
    if (client.controller === controller) {
      cleanupClient(runId, client);
      break;
    }
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
