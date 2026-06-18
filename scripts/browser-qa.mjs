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

  await page.getByRole("button", { name: "Models", exact: true }).click();
  await page.getByRole("button", { name: "Validate" }).click();
  await page.waitForTimeout(700);

  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.getByRole("button", { name: "Import as EIS" }).click();
  await page.waitForTimeout(700);

  await page.getByRole("button", { name: "Runs", exact: true }).click();
  await page.getByRole("button", { name: "Run selected fit" }).click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Run batch joint fit" }).click();
  await page.waitForTimeout(700);
  const sliderCount = await page.locator('input[type="range"]').count();
  if (sliderCount !== 0) throw new Error(`Expected no plot range sliders, found ${sliderCount}.`);

  const sidebarOverflow = await page.locator(".sidebar-scroll").evaluate((node) => getComputedStyle(node).overflowY);
  if (!["auto", "scroll"].includes(sidebarOverflow)) {
    throw new Error(`Expected sidebar dense lists to be scrollable, got overflow-y: ${sidebarOverflow}.`);
  }

  const fitSetupOverflow = await page.locator(".config-panel").evaluate((node) => getComputedStyle(node).overflowY);
  if (!["auto", "scroll"].includes(fitSetupOverflow)) {
    throw new Error(`Expected fit setup panel to be scrollable, got overflow-y: ${fitSetupOverflow}.`);
  }

  const inspectorOverflow = await page.locator(".inspector-panel").evaluate((node) => getComputedStyle(node).overflowY);
  if (!["auto", "scroll"].includes(inspectorOverflow)) {
    throw new Error(`Expected run inspector panel to be scrollable, got overflow-y: ${inspectorOverflow}.`);
  }

  const firstPlotFrame = await page.locator(".plot-frame").first().boundingBox();
  if (!firstPlotFrame || Math.abs(firstPlotFrame.width - firstPlotFrame.height) > 1) {
    throw new Error(`Expected equal-aspect Nyquist plot frame, got ${JSON.stringify(firstPlotFrame)}.`);
  }
  if (firstPlotFrame.width < 300) {
    throw new Error(`Expected larger Nyquist plot frame, got width ${firstPlotFrame.width}.`);
  }

  const firstLegendLocator = page.locator(".plot-legend").first();
  const firstLegend = await firstLegendLocator.innerText();
  if (!firstLegend.includes("measured") || !firstLegend.includes("points")) {
    throw new Error(`Expected measured-series legend metadata, got: ${firstLegend}`);
  }
  const firstLegendBox = await firstLegendLocator.boundingBox();
  const legendIsSeparated =
    firstLegendBox &&
    (firstLegendBox.y + firstLegendBox.height <= firstPlotFrame.y - 4 ||
      firstLegendBox.y >= firstPlotFrame.y + firstPlotFrame.height + 4);
  if (!legendIsSeparated) {
    throw new Error(`Expected legend separated from plot frame, got frame=${JSON.stringify(firstPlotFrame)} legend=${JSON.stringify(firstLegendBox)}.`);
  }

  await page.getByRole("img", { name: /EIS Nyquist/ }).first().focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(700);

  await page.getByRole("button", { name: "Models", exact: true }).click();
  await page.getByLabel("EIS circuit_1").fill("TDS");
  await page.getByLabel("2nd-NLEIS circuit_2").fill("R0");
  await page.waitForTimeout(200);
  const parameterRows = await page.locator(".model-editor-panel .parameter-table tbody tr").count();
  if (parameterRows !== 6) {
    throw new Error(`Expected TDS/R0 to render 6 initial-guess rows, found ${parameterRows}.`);
  }
  const initialGuessText = await page.getByLabel("Initial guesses").inputValue();
  const initialGuessCount = initialGuessText.split(",").map((entry) => entry.trim()).filter(Boolean).length;
  if (initialGuessCount !== 6) {
    throw new Error(`Expected TDS/R0 initial guess text to contain 6 values, got ${initialGuessText}.`);
  }
  await page.getByRole("button", { name: "Validate" }).click();
  await page.waitForTimeout(700);
  const validationText = await page.locator(".model-editor-panel .validation").innerText();
  if (!validationText.includes("6 estimated parameters")) {
    throw new Error(`Expected validation to report 6 estimated parameters, got: ${validationText}`);
  }

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
