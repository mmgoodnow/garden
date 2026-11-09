import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";

const url = process.argv[2] ?? "http://localhost:4001/browser-fingerprint";

type BrowserBrand = { brand: string; version: string };
type Signals = {
  server: { userAgent: string | null; brands: string | null };
  client: { userAgent: string; brands: BrowserBrand[] | null; webdriver: boolean };
};
type Classification = "Google Chrome" | "Chromium" | "Chrome-like user agent";

async function check(page: Page, label: string, expected: Classification) {
  const response = await page.goto(url, { timeout: 10_000 });
  assert.ok(response?.ok(), `${label}: the mock page should load`);
  await page.waitForFunction(
    () => document.querySelector("#signals")?.textContent?.trim().startsWith("{"),
    null,
    { timeout: 5_000 },
  );

  const signals: Signals = JSON.parse(await page.locator("#signals").innerText());
  const classification = await page.locator("#classification").innerText();
  assert.equal(classification, expected, label);
  if (expected !== "Chrome-like user agent") {
    assert.ok(signals.server.brands?.includes(`"${expected}";`), label);
    assert.ok(signals.client.brands?.some(({ brand }) => brand === expected), label);
  }
  assert.equal(signals.server.userAgent, signals.client.userAgent, label);
  console.log(`${label} → ${classification} (webdriver: ${signals.client.webdriver})`);
  return signals;
}

const chrome = await chromium.launch({ channel: "chrome", headless: true });
try {
  const chromePage = await chrome.newPage();
  const chromeSignals = await check(chromePage, "Installed Chrome", "Google Chrome");
  const { userAgent, brands } = chromeSignals.client;
  assert.ok(brands);
  const { platform, mobile } = await chromePage.evaluate(() => {
    const { userAgentData } = navigator as Navigator & {
      userAgentData: { platform: string; mobile: boolean };
    };
    return { platform: userAgentData.platform, mobile: userAgentData.mobile };
  });

  const shell = await chromium.launch({ headless: true });
  try {
    const shellSignals = await check(
      await shell.newPage(),
      "Playwright's default headless shell",
      "Chromium",
    );

    const uaOnly = await check(
      await shell.newPage({ userAgent }),
      "Shell with Chrome user-agent string (Playwright)",
      "Chromium",
    );
    assert.equal(uaOnly.client.userAgent, userAgent);
    assert.equal(uaOnly.server.brands, shellSignals.server.brands);
    assert.deepEqual(uaOnly.client.brands, shellSignals.client.brands);

    const noHintsPage = await shell.newPage();
    const noHintsCdp = await noHintsPage.context().newCDPSession(noHintsPage);
    await noHintsCdp.send("Emulation.setUserAgentOverride", { userAgent });
    const noHints = await check(
      noHintsPage,
      "Shell with Chrome user-agent string (CDP)",
      "Chrome-like user agent",
    );
    assert.equal(noHints.client.userAgent, userAgent);
    assert.equal(noHints.server.brands, null);
    assert.equal(noHints.client.brands?.length ?? 0, 0);

    const spoofedPage = await shell.newPage();
    const cdp = await spoofedPage.context().newCDPSession(spoofedPage);
    await cdp.send("Emulation.setUserAgentOverride", {
      userAgent,
      userAgentMetadata: {
        brands,
        platform,
        mobile,
        architecture: "",
        platformVersion: "",
        model: "",
      },
    });
    const spoofed = await check(
      spoofedPage,
      "Shell with Chrome user-agent string and brands (CDP)",
      "Google Chrome",
    );
    assert.equal(spoofed.client.userAgent, userAgent);
    assert.equal(spoofed.server.brands, chromeSignals.server.brands);
    assert.deepEqual(spoofed.client.brands, brands);
    assert.equal(spoofed.client.webdriver, true);
  } finally {
    await shell.close();
  }
} finally {
  await chrome.close();
}
