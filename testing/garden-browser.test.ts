import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { launchGardenBrowser, newGardenPage } from "../browser.ts";

test("Garden presents a consistent Chrome identity to the page and server", { timeout: 30_000 }, async (t) => {
  const browser = await launchGardenBrowser().catch((error: unknown) => {
    if (error instanceof Error && error.message.includes("Chromium distribution 'chrome' is not found")) {
      t.skip("Google Chrome is not installed");
      return null;
    }
    throw error;
  });
  if (!browser) return;
  t.after(() => browser.close());

  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Accept-CH", "Sec-CH-UA-Platform-Version");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({
      userAgent: req.headers["user-agent"],
      brands: req.headers["sec-ch-ua"],
      platform: req.headers["sec-ch-ua-platform"],
      platformVersion: req.headers["sec-ch-ua-platform-version"],
    }));
  }).listen(0, "127.0.0.1");
  t.after(() => {
    const closed = server[Symbol.asyncDispose]();
    server.closeAllConnections();
    return closed;
  });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const page = await newGardenPage(browser);
  const response = await page.goto(`http://127.0.0.1:${address.port}/`);
  assert.ok(response);
  assert.ok(response.ok());
  const headers: { userAgent?: string; brands?: string; platform?: string } = await response.json();
  const signals = await page.evaluate(async () => {
    const { userAgent, webdriver, platform, userAgentData } = navigator as Navigator & {
      userAgentData?: {
        brands: { brand: string; version: string }[];
        platform: string;
        getHighEntropyValues(hints: string[]): Promise<{ platformVersion?: string }>;
      };
    };
    const entropy = await userAgentData?.getHighEntropyValues(["platformVersion"]);
    return {
      userAgent,
      webdriver,
      platform,
      brands: userAgentData?.brands,
      hintedPlatform: userAgentData?.platform,
      hintedPlatformVersion: entropy?.platformVersion,
      viewport: { width: innerWidth, height: innerHeight },
      screen: { width: screen.width, height: screen.height },
    };
  });

  const major = browser.version().split(".")[0];
  assert.match(signals.userAgent, new RegExp(`\\bChrome/${major}\\.`));
  assert.doesNotMatch(signals.userAgent, /HeadlessChrome/);
  assert.equal(signals.webdriver, false);
  assert.equal(headers.userAgent, signals.userAgent);
  assert.ok(headers.brands?.includes(`"Google Chrome";v="${major}"`), "HTTP brand should match installed Chrome");
  assert.ok(signals.brands?.some(({ brand, version }) =>
    brand === "Google Chrome" && version === major,
  ));
  assert.equal(headers.platform, JSON.stringify(signals.hintedPlatform));
  assert.notDeepEqual(signals.viewport, signals.screen);

  if (process.platform === "linux") {
    assert.match(signals.userAgent, /Windows NT 10\.0/);
    assert.equal(signals.platform, "Win32");
    assert.equal(signals.hintedPlatform, "Windows");
    assert.match(signals.hintedPlatformVersion ?? "", /^[1-9]\d*\.\d+\.\d+$/);
    const platformVersion = await page.evaluate(async () => {
      const response = await fetch("/platform-version");
      return (await response.json()).platformVersion;
    });
    assert.equal(platformVersion, JSON.stringify(signals.hintedPlatformVersion));
  }
});
