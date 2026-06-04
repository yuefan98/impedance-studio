import { chromium } from "playwright-core";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000";
const outputDir = process.env.QA_OUTPUT_DIR ?? "tmp";

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ["--no-sandbox", "--disable-gpu"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const consoleMessages = [];
  page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${outputDir}/qa-desktop.png`, fullPage: true });

  await page.getByText("Validate DSL").click();
  await page.getByText("Run Fit").click();
  await page.waitForTimeout(700);
  await page.getByText("Batch Fit").click();
  await page.waitForTimeout(700);
  await page.getByText("Save Model").first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outputDir}/qa-after-workflow.png`, fullPage: true });

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  await mobile.goto(baseUrl, { waitUntil: "networkidle" });
  await mobile.screenshot({ path: `${outputDir}/qa-mobile.png`, fullPage: true });

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        screenshots: [
          `${outputDir}/qa-desktop.png`,
          `${outputDir}/qa-after-workflow.png`,
          `${outputDir}/qa-mobile.png`,
        ],
        consoleMessages,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
