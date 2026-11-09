import { chromium, type Browser, type BrowserContext } from "playwright";

export type BrowserCookie = Parameters<BrowserContext["addCookies"]>[0][number];
type ChromeMetadata = {
  architecture: string;
  bitness: string;
  mobile: boolean;
  model: string;
  platform: string;
  platformVersion: string;
  wow64: boolean;
};

export function launchGardenBrowser() {
  return chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--screen-info={1920x1080 workAreaBottom=40}",
      "--window-size=1440,900",
    ],
  });
}

export async function newGardenPage(browser: Browser, cookies: BrowserCookie[] = []) {
  // Read Chrome's native metadata on a secure internal page before contacting the site.
  const versionPage = await browser.newPage();
  let identity;
  try {
    await versionPage.goto("chrome://version/");
    identity = await versionPage.evaluate(async () => {
      const { userAgentData, userAgent, platform } = navigator as Navigator & {
        userAgentData: {
          getHighEntropyValues(hints: string[]): Promise<ChromeMetadata>;
        };
      };
      const metadata = await userAgentData.getHighEntropyValues([
        "architecture", "bitness", "model", "platformVersion", "wow64",
      ]);
      return { userAgent, platform, metadata };
    });
  } finally {
    await versionPage.close();
  }

  let userAgent = identity.userAgent.replace("HeadlessChrome/", "Chrome/");
  let platform = identity.platform;
  const metadata = identity.metadata;
  if (metadata.platform === "Linux") {
    userAgent = userAgent.replace(/\([^)]*\)/, "(Windows NT 10.0; Win64; x64)");
    platform = "Win32";
    metadata.platform = "Windows";
    metadata.platformVersion = "19.0.0";
    metadata.architecture = "x86";
    metadata.bitness = "64";
    metadata.wow64 = false;
  }

  const context = await browser.newContext({ viewport: null, userAgent });
  if (cookies.length > 0) await context.addCookies(cookies);

  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  // Chrome fills in its own brand list and version hints when they are omitted.
  await session.send("Emulation.setUserAgentOverride", {
    userAgent,
    platform,
    userAgentMetadata: metadata,
  });
  return page;
}
