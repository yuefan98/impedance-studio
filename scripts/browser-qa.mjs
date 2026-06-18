import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000";
const outputDir = process.env.QA_OUTPUT_DIR ?? "tmp";

await mkdir(outputDir, { recursive: true });

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

  await page.getByRole("button", { name: "Models" }).click();
  await page.getByRole("button", { name: "Validate" }).click();
  await page.waitForTimeout(700);

  await page.getByRole("button", { name: "Data" }).click();
  await page.getByRole("button", { name: "Import as EIS" }).click();
  await page.waitForTimeout(700);

  await page.getByRole("button", { name: "Runs" }).click();
  await page.getByRole("button", { name: "Run selected fit" }).click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Run batch joint fit" }).click();
  await page.waitForTimeout(700);
  const sliderCount = await page.locator('input[type="range"]').count();
  if (sliderCount !== 0) throw new Error(`Expected no plot range sliders, found ${sliderCount}.`);

  const fitSetupOverflow = await page.locator(".config-panel").evaluate((node) => getComputedStyle(node).overflowY);
  if (!["auto", "scroll"].includes(fitSetupOverflow)) {
    throw new Error(`Expected fit setup panel to be scrollable, got overflow-y: ${fitSetupOverflow}.`);
  }

  const firstPlotFrame = await page.locator(".plot-frame").first().boundingBox();
  if (!firstPlotFrame || Math.abs(firstPlotFrame.width - firstPlotFrame.height) > 1) {
    throw new Error(`Expected equal-aspect Nyquist plot frame, got ${JSON.stringify(firstPlotFrame)}.`);
  }

  const firstLegend = await page.locator(".plot-legend").first().innerText();
  if (!firstLegend.includes("measured") || !firstLegend.includes("points")) {
    throw new Error(`Expected measured-series legend metadata, got: ${firstLegend}`);
  }

  await page.getByRole("img", { name: /EIS Nyquist/ }).first().focus();
  await page.keyboard.press("ArrowRight");
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
