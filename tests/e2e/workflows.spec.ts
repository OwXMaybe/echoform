import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { sine } from "../../src/core/audio/test-signals";
import { goTo, openRecording, RATE, stereoTone, wavFile } from "./helpers";

const ALL_PAGES = [
  "Audio Workspace",
  "Signal Analysis",
  "Spectral Analysis",
  "Stereo Analysis",
  "Events and Pitch",
  "Filter Laboratory",
  "Comparison Lab",
  "Reports",
  "Settings",
];

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto("/");
});

test("opens a file and measures it", async ({ page }) => {
  await openRecording(page, wavFile("tone.wav", stereoTone()));
  await expect(page.getByTestId("peak-Left")).toContainText("dBFS");
  await expect(page.getByTestId("peaks")).toContainText("1000 Hz");
});

test("rejects a bad file and keeps the open recording", async ({ page }) => {
  await openRecording(page, wavFile("tone.wav", stereoTone()));
  await page.getByTestId("file-input").setInputFiles({
    name: "broken.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("this is not audio"),
  });
  await expect(page.getByRole("alert").filter({ hasText: "broken.wav" })).toBeVisible();
  await expect(page.getByTestId("waveform")).toBeVisible();
  await expect(page.getByRole("banner").getByText("tone.wav")).toBeVisible();
});

test("plays, and space on a focused button does not also toggle the transport", async ({ page }) => {
  await openRecording(page, wavFile("tone.wav", stereoTone()));
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByTestId("playhead")).not.toHaveText("0:00.000");
  const pause = page.getByRole("button", { name: "Pause", exact: true });
  await pause.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

test("selects a range from the keyboard", async ({ page }) => {
  await openRecording(page, wavFile("tone.wav", stereoTone()));
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("[");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("]");
  await expect(page.getByTestId("scope")).toContainText("0:01.000 – 0:02.000");
});

test("stereo page shows real correlation, and none for mono", async ({ page }) => {
  await openRecording(page, wavFile("tone.wav", stereoTone()));
  await goTo(page, "Stereo Analysis");
  await expect(page.getByTestId("correlation")).toContainText("+0.99");
  await page.getByTestId("file-input").setInputFiles(wavFile("mono.wav", [sine(440, 0.5, RATE, RATE * 2)]));
  await expect(page.getByRole("banner").getByText("mono.wav")).toBeVisible();
  await goTo(page, "Stereo Analysis");
  await expect(page.getByTestId("stereo-unavailable")).toBeVisible();
});

test("filters render separately and can be heard and reset", async ({ page }) => {
  await openRecording(page, wavFile("tone.wav", stereoTone()));
  await goTo(page, "Filter Laboratory");
  await page.getByRole("button", { name: "Add filter" }).click();
  await expect(page.getByTestId("render-status")).toContainText("separate buffer");
  await page.getByRole("group", { name: "Listen to" }).getByRole("button", { name: "Processed" }).click();
  await expect(page.getByTestId("processed-indicator")).toBeVisible();
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByTestId("processed-indicator")).toBeHidden();
  await expect(page.getByTestId("render-status")).toContainText("No filter");
});

test("compares a recording with a delayed copy", async ({ page }) => {
  const [left, right] = stereoTone();
  const a = wavFile("a.wav", [left, right]);
  // Noise makes the lag unambiguous; a pure tone would match at every cycle.
  const b = wavFile("b.wav", [left.slice(12000), right.slice(12000)]);
  await openRecording(page, a);
  await goTo(page, "Comparison Lab");
  await page.getByTestId("reference-input").setInputFiles(b);
  await expect(page.getByTestId("comparison-table")).toContainText("Duration");
  await page.getByRole("button", { name: "Estimate offset" }).click();
  await expect(page.getByTestId("alignment-summary")).toContainText("Cross-correlation");
  await expect(page.getByTestId("comparison-scope")).toContainText("A from 0:00.250");
});

test("events page reaches a result on a freshly opened file", async ({ page }) => {
  await openRecording(page, wavFile("tone.wav", [sine(440, 0.5, RATE, RATE * 6)]));
  await goTo(page, "Events and Pitch");
  await expect(page.getByTestId("pitch-summary")).toContainText("440 Hz");
  await expect(page.getByTestId("tempo")).toContainText("No clear tempo");
});

test("exports a report in every format, built from real measurements", async ({ page }) => {
  await openRecording(page, wavFile("take one.wav", stereoTone()));
  await goTo(page, "Reports");
  await expect(page.getByTestId("report-status")).toContainText("Ready", { timeout: 30_000 });

  const preview = page.frameLocator('[data-testid="report-preview"]');
  await expect(preview.getByRole("heading", { name: "Time-domain measurements" })).toBeVisible();
  await expect(preview.locator("svg polyline")).toHaveCount(1);

  const save = async (name: string) => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name, exact: true }).click(),
    ]);
    return { name: download.suggestedFilename(), text: readFileSync(await download.path(), "utf8") };
  };

  const json = await save("JSON");
  expect(json.name).toBe("take-one-report.json");
  const report = JSON.parse(json.text);
  expect(report.recording.fileName).toBe("take one.wav");
  expect(report.frequencyDomain.peaks[0].frequencyHz).toBeCloseTo(1000, -1);
  expect(report.channelAnalysis.correlation).toBeGreaterThan(0.99);
  expect(report.timeDomain[0].rmsDbfs).toBeCloseTo(-10.97, 0);

  const csv = await save("CSV");
  expect(csv.text).toContain("time domain,Left,rms,");

  const html = await save("HTML");
  expect(html.text).toContain("<h2>Limitations</h2>");
  const printable = await page.context().newPage();
  await printable.setContent(html.text);
  const pdf = await printable.pdf({ format: "A4" });
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  await printable.close();

  await page.getByLabel("Include file names").uncheck();
  await expect(preview.getByRole("heading", { level: 1 })).toHaveText("Recording");
  const anonymous = await save("JSON");
  expect(anonymous.name).toBe("recording-report.json");
  expect(anonymous.text).not.toContain("take one");
});

test("settings are not stored unless asked, and are removed on request", async ({ page }) => {
  await goTo(page, "Settings");
  const stored = () => page.evaluate(() => localStorage.getItem("echoform.settings.v1"));
  await page.getByLabel("FFT size").selectOption("8192");
  expect(await stored()).toBeNull();

  await page.getByLabel("Remember these settings on this device").check();
  expect(JSON.parse((await stored())!).fftSize).toBe(8192);
  await page.reload();
  await expect(page.getByLabel("FFT size")).toHaveValue("8192");

  await page.getByLabel("Remember these settings on this device").uncheck();
  expect(await stored()).toBeNull();
});

test("never sends audio anywhere", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" || !request.url().startsWith("http://localhost")) {
      if (!request.url().startsWith("blob:") && !request.url().startsWith("data:")) {
        posts.push(`${request.method()} ${request.url()}`);
      }
    }
  });
  await openRecording(page, wavFile("tone.wav", stereoTone()));
  await goTo(page, "Reports");
  await expect(page.getByTestId("report-status")).toContainText("Ready", { timeout: 30_000 });
  expect(posts).toEqual([]);
});

test("every page passes the automated accessibility rules", async ({ page }) => {
  const check = async (name: string) => {
    const { violations } = await new AxeBuilder({ page }).exclude("iframe").analyze();
    const summary = violations.map(
      (v) => `${name}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`,
    );
    expect(summary).toEqual([]);
  };
  await check("Dashboard");
  await openRecording(page, wavFile("tone.wav", stereoTone()));
  for (const name of ALL_PAGES) {
    await goTo(page, name);
    await page.waitForTimeout(600);
    await check(name);
  }
});

test.describe("narrow screens", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("no page scrolls sideways, and More reaches every destination", async ({ page }) => {
    await openRecording(page, wavFile("tone.wav", stereoTone()));
    for (const name of ALL_PAGES.slice(2)) {
      await page.getByRole("button", { name: "More" }).click();
      await goTo(page, name);
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        const main = document.getElementById("main")!;
        return Math.max(root.scrollWidth - root.clientWidth, main.scrollWidth - main.clientWidth);
      });
      expect(overflow, name).toBeLessThanOrEqual(0);
    }
  });
});

test("charts really paint", async ({ page }) => {
  await openRecording(page, wavFile("tone.wav", stereoTone()));
  const painted = (id: string) =>
    page.getByTestId(id).evaluate((element) => {
      const canvas = element.querySelector("canvas") as HTMLCanvasElement;
      const { width, height } = canvas;
      const data = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
      const colours = new Set<number>();
      for (let i = 0; i < data.length; i += 40) colours.add(data[i] * 65536 + data[i + 1] * 256 + data[i + 2]);
      return colours.size;
    });
  await expect.poll(() => painted("waveform")).toBeGreaterThan(3);
  await goTo(page, "Spectral Analysis");
  await expect.poll(() => painted("spectrum")).toBeGreaterThan(3);
});
