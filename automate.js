const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DEFAULTS = {
  input: "listings.csv",
  prompt: "prompt.md",
  output: "output",
  profile: "chrome-profile",
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  url: "https://chat.deepseek.com/",
  headless: false,
  start: 0,
  limit: Infinity,
  force: false,
  delayMs: 1500,
  uploadWaitMs: 8000,
  responseTimeoutMs: 10 * 60 * 1000,
  stableMs: 8000,
};

function parseArgs(argv) {
  const config = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];

    if (arg === "--input") config.input = next();
    else if (arg === "--prompt") config.prompt = next();
    else if (arg === "--output") config.output = next();
    else if (arg === "--profile") config.profile = next();
    else if (arg === "--executable-path") config.executablePath = next();
    else if (arg === "--url") config.url = next();
    else if (arg === "--start") config.start = Number(next());
    else if (arg === "--limit") config.limit = Number(next());
    else if (arg === "--delay-ms") config.delayMs = Number(next());
    else if (arg === "--upload-wait-ms") config.uploadWaitMs = Number(next());
    else if (arg === "--response-timeout-ms") config.responseTimeoutMs = Number(next());
    else if (arg === "--stable-ms") config.stableMs = Number(next());
    else if (arg === "--force") config.force = true;
    else if (arg === "--headless") config.headless = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(config.start) || config.start < 0) {
    throw new Error("--start must be a non-negative row index");
  }
  if (config.limit !== Infinity && (!Number.isFinite(config.limit) || config.limit < 1)) {
    throw new Error("--limit must be a positive number");
  }

  return config;
}

function printHelp() {
  console.log(`
Usage:
  node automate.js [options]

Options:
  --input <file>                  Listing table file. Default: listings.csv
  --prompt <file>                 Prompt markdown file. Default: prompt.md
  --output <dir>                  Output directory. Default: output
  --profile <dir>                 Browser profile directory. Default: chrome-profile
  --executable-path <file>        Browser app executable. Default: Google Chrome on macOS
  --start <n>                     Start at zero-based row index. Default: 0
  --limit <n>                     Process only n rows. Useful for testing.
  --force                         Re-run rows even if output files already exist.
  --delay-ms <n>                  Pause after each saved row. Default: 1500
  --upload-wait-ms <n>            Wait after attaching prompt.md. Default: 8000
  --response-timeout-ms <n>       Max wait for one DeepSeek answer. Default: 600000
  --stable-ms <n>                 Text must stop changing for this long. Default: 8000
  --headless                      Run browser without showing it.

Examples:
  node automate.js --limit 1
  node automate.js --start 25 --limit 10
  node automate.js --force --limit 1
`);
}

function readUtf8(filePath) {
  return fs.readFileSync(path.resolve(filePath), "utf8").replace(/^\uFEFF/, "");
}

function requireFile(filePath, label) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`${label} file does not exist: ${resolved}`);
  return resolved;
}

function detectDelimiter(headerLine) {
  const candidates = ["\t", ",", ";"];
  return candidates
    .map((delimiter) => ({ delimiter, count: splitDelimitedLine(headerLine, delimiter).length }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

function splitDelimitedLine(line, delimiter) {
  const cells = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const following = line[i + 1];

    if (char === '"' && quoted && following === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseTable(text) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((line) => line.trim() !== "");
  if (lines.length < 2) throw new Error("Listing table must contain a header and at least one data row.");

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitDelimitedLine(lines[0], delimiter).filter(Boolean);

  const rows = lines.slice(1).map((line, index) => {
    const values = splitDelimitedLine(line, delimiter);
    const row = {};
    headers.forEach((header, headerIndex) => {
      row[header] = values[headerIndex] || "";
    });
    return { index, raw: line, row };
  });

  return { headers, rows, delimiter };
}

function outputPathForRow(outputDir, row, rowNumber) {
  const slug = row["URL Slug"] || row.Slug || row.slug || `row-${rowNumber + 1}`;
  const safeSlug = slug
    .toLowerCase()
    .replace(/^[./\\]+/, "")
    .replace(/[\\/]+/g, "__")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return path.resolve(outputDir, `${String(rowNumber + 1).padStart(4, "0")}-${safeSlug || `row-${rowNumber + 1}`}.md`);
}

function looksCompleteOutput(filePath) {
  if (!fs.existsSync(filePath)) return false;

  const text = fs.readFileSync(filePath, "utf8");
  return (
    text.length > 1000 &&
    text.includes("META_TITLE:") &&
    text.includes("CANONICAL:") &&
    text.toLowerCase().includes("json-ld") &&
    text.toLowerCase().includes("validation checklist")
  );
}

function cleanAnswerText(answer) {
  return String(answer || "")
    .split(/\r?\n/)
    .filter((line) => !/^(copy|download)$/i.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasMarkdownMarkers(text) {
  return /(^|\n)#{1,6}\s/.test(text) || /(^|\n)```/.test(text) || /\*\*[^*]+:\*\*/.test(text);
}

async function visibleLocator(page, selectors, timeout = 5000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count().catch(() => 0);

      for (let i = count - 1; i >= 0; i -= 1) {
        const candidate = locator.nth(i);
        if (await candidate.isVisible().catch(() => false)) return candidate;
      }
    }

    await page.waitForTimeout(500);
  }

  return null;
}

async function waitForComposer(page) {
  const composer = await visibleLocator(
    page,
    [
      "textarea",
      '[contenteditable="true"]',
      '[role="textbox"][contenteditable="true"]',
      '[data-testid*="chat-input"]',
      '[class*="chat-input"] textarea',
    ],
    5 * 60 * 1000
  );

  if (!composer) {
    throw new Error("Could not find the DeepSeek message box. Make sure you are logged in.");
  }

  return composer;
}

async function fillComposer(composer, message) {
  await composer.click();

  try {
    await composer.fill(message, { timeout: 30_000 });
  } catch {
    await composer.evaluate((element, value) => {
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        element.value = value;
      } else {
        element.textContent = value;
      }
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    }, message);
  }
}

async function clickSend(page, composer) {
  const sendButton = await visibleLocator(
    page,
    [
      'button[aria-label*="Send" i]',
      'button[title*="Send" i]',
      'button[data-testid*="send" i]',
      'button:has-text("Send")',
      '[role="button"][aria-label*="Send" i]',
    ],
    3000
  );

  if (sendButton) {
    await sendButton.click();
    return;
  }

  await composer.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
}

async function attachPromptFile(page, promptPath, uploadWaitMs) {
  const resolvedPromptPath = path.resolve(promptPath);
  const existingInput = page.locator('input[type="file"]').first();

  if ((await existingInput.count().catch(() => 0)) > 0) {
    await existingInput.setInputFiles(resolvedPromptPath);
  } else {
    const attachButton = await visibleLocator(
      page,
      [
        'button[aria-label*="Attach" i]',
        'button[title*="Attach" i]',
        'button[aria-label*="Upload" i]',
        'button[title*="Upload" i]',
        'button[aria-label*="File" i]',
        'button[title*="File" i]',
        '[role="button"][aria-label*="Attach" i]',
        '[role="button"][aria-label*="Upload" i]',
      ],
      5000
    );

    if (!attachButton) {
      throw new Error("Could not find DeepSeek's attach/upload control for prompt.md.");
    }

    const chooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 });
    await attachButton.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(resolvedPromptPath);
  }

  await page.waitForTimeout(uploadWaitMs);

  const fileVisible = await page.getByText(path.basename(resolvedPromptPath), { exact: false }).first().isVisible().catch(() => false);
  if (fileVisible) console.log(`[attach] ${resolvedPromptPath}`);
  else console.log(`[attach] ${resolvedPromptPath} (uploaded; filename not visible in page text)`);
}

async function candidateAnswerTexts(page) {
  return page.evaluate(() => {
    const markers = ["META_TITLE:", "CANONICAL:", "validation checklist"];
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const hasMarkers = (text) => markers.every((marker) => text.toLowerCase().includes(marker.toLowerCase()));
    const elements = Array.from(document.body.querySelectorAll("*")).filter(visible);
    const candidates = [];

    for (const element of elements) {
      const text = (element.innerText || element.textContent || "").trim();
      if (text.length < 1000 || !hasMarkers(text)) continue;

      const childHasSameAnswer = Array.from(element.children).some((child) => {
        const childText = (child.innerText || child.textContent || "").trim();
        return childText.length >= 1000 && hasMarkers(childText);
      });

      if (!childHasSameAnswer) {
        const rect = element.getBoundingClientRect();
        candidates.push({ text, top: rect.top, bottom: rect.bottom, length: text.length });
      }
    }

    if (candidates.length) {
      return candidates.sort((a, b) => a.top - b.top || a.length - b.length).map((candidate) => candidate.text);
    }

    const fallbackSelectors = [
      '[data-message-author-role="assistant"]',
      '[class*="assistant"]',
      '[class*="markdown"]',
      ".ds-markdown",
      ".markdown",
      "article",
    ];
    const seen = new Set();
    const fallback = [];

    for (const selector of fallbackSelectors) {
      document.querySelectorAll(selector).forEach((element) => {
        if (seen.has(element) || !visible(element)) return;
        seen.add(element);

        const text = (element.innerText || element.textContent || "").trim();
        if (text.length > 100 && !text.includes("----- PROMPT START -----")) {
          const rect = element.getBoundingClientRect();
          fallback.push({ text, top: rect.top, length: text.length });
        }
      });
    }

    return fallback.sort((a, b) => a.top - b.top || a.length - b.length).map((candidate) => candidate.text);
  });
}

async function lastAnswerText(page) {
  const texts = await candidateAnswerTexts(page);
  return texts[texts.length - 1] || "";
}

function documentTextHint(text) {
  return String(text || "").slice(-5000);
}

async function waitForAnswer(page, beforeText, timeoutMs, stableMs) {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  let lastChangedAt = Date.now();

  while (Date.now() < deadline) {
    const text = await lastAnswerText(page);

    if (text && text !== beforeText && text !== lastText) {
      lastText = text;
      lastChangedAt = Date.now();
    }

    const lower = documentTextHint(text).toLowerCase();
    const hasValidation = lower.includes("validation checklist") || lower.includes("json-ld schema");
    if (lastText.length > 1000 && hasValidation && Date.now() - lastChangedAt >= stableMs) {
      return lastText;
    }

    await page.waitForTimeout(1000);
  }

  if (lastText) return lastText;
  throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for a DeepSeek response.`);
}

async function readClipboard(page) {
  return page.evaluate(() => navigator.clipboard.readText());
}

async function writeClipboard(page, text) {
  return page.evaluate((value) => navigator.clipboard.writeText(value), text);
}

function isUsableMarkdownAnswer(text, row) {
  const value = String(text || "");
  const lower = value.toLowerCase();
  const expectedTokens = [row.SKU, row["URL Slug"], row["Listing Title"]].filter(Boolean);

  return (
    value.length > 1000 &&
    value.includes("META_TITLE") &&
    value.includes("CANONICAL") &&
    lower.includes("json-ld") &&
    lower.includes("validation checklist") &&
    expectedTokens.some((token) => value.includes(token)) &&
    hasMarkdownMarkers(value)
  );
}

async function copyNewestAnswerMarkdown(page, row) {
  const clipboardMarker = `__deepseek_automation_waiting_for_copy_${Date.now()}__`;
  await writeClipboard(page, clipboardMarker).catch(() => {});

  await scrollAnswerBottomIntoView(page, row);

  const answerBox = await findAnswerBox(page, row);

  if (!answerBox) return "";

  await page.mouse.move(answerBox.x + Math.min(answerBox.width - 20, Math.max(20, answerBox.width / 2)), Math.max(20, Math.min(answerBox.y + 40, 900)));
  await page.waitForTimeout(800);
  await page.mouse.move(
    answerBox.x + Math.min(answerBox.width - 20, Math.max(20, answerBox.width / 2)),
    Math.max(20, Math.min(answerBox.y + answerBox.height - 20, 900))
  );
  await page.waitForTimeout(800);

  const candidates = await page.locator('button, [role="button"]').evaluateAll((elements, box) => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const inViewport = rect.bottom >= 0 && rect.top <= window.innerHeight && rect.right >= 0 && rect.left <= window.innerWidth;
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0 && inViewport;
    };

    return elements
      .map((element, index) => {
        if (!visible(element)) return null;

        const text = (element.innerText || element.textContent || "").trim();
        const label = element.getAttribute("aria-label") || element.getAttribute("title") || "";
        const rect = element.getBoundingClientRect();
        const isCopy = /copy/i.test(`${text} ${label}`);
        if (!isCopy) return null;

        const inCodeBlock = Boolean(element.closest("pre, code"));
        const verticalDistance = Math.min(Math.abs(rect.top - box.y), Math.abs(rect.top - (box.y + box.height)));
        const overlapsAnswer =
          rect.bottom >= box.y - 120 &&
          rect.top <= box.y + box.height + 180 &&
          rect.right >= box.x &&
          rect.left <= box.x + box.width;
        const score = (inCodeBlock ? 10000 : 0) + verticalDistance - (rect.top > box.y + box.height - 80 ? 100 : 0);

        return { index, text, label, inCodeBlock, overlapsAnswer, score, top: rect.top, left: rect.left };
      })
      .filter((button) => button && button.overlapsAnswer)
      .sort((a, b) => a.score - b.score);
  }, answerBox);

  for (const button of candidates) {
    const locator = page.locator('button, [role="button"]').nth(button.index);
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);

    const copied = await readClipboard(page).catch(() => "");
    if (copied && copied !== clipboardMarker && isUsableMarkdownAnswer(copied, row)) {
      console.log(`[copy] Used DeepSeek copy button: ${button.label || button.text || "Copy"}`);
      return copied.trim();
    }
  }

  const iconActionCandidates = await page.locator('button, [role="button"]').evaluateAll((elements, box) => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const inViewport = rect.bottom >= 0 && rect.top <= window.innerHeight && rect.right >= 0 && rect.left <= window.innerWidth;
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0 && inViewport;
    };

    return elements
      .map((element, index) => {
        if (!visible(element)) return null;

        const text = (element.innerText || element.textContent || "").trim();
        const label = element.getAttribute("aria-label") || element.getAttribute("title") || "";
        const className = element.className || "";
        const rect = element.getBoundingClientRect();
        const isBottomAction =
          !text &&
          !label &&
          /ds-button--icon/.test(className) &&
          rect.top >= Math.min(box.y + box.height - 80, window.innerHeight - 180) &&
          rect.top <= Math.min(box.y + box.height + 120, window.innerHeight) &&
          rect.left >= box.x - 20 &&
          rect.left <= box.x + 240;

        if (!isBottomAction) return null;

        return { index, text, label, className, top: rect.top, left: rect.left };
      })
      .filter(Boolean)
      .sort((a, b) => a.top - b.top || a.left - b.left);
  }, answerBox);

  for (const button of iconActionCandidates) {
    const locator = page.locator('button, [role="button"]').nth(button.index);
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);

    const copied = await readClipboard(page).catch(() => "");
    if (copied && copied !== clipboardMarker && isUsableMarkdownAnswer(copied, row)) {
      console.log(`[copy] Used DeepSeek message action button at x=${Math.round(button.left)}`);
      return copied.trim();
    }
  }

  return "";
}

async function findAnswerBox(page, row) {
  return page.evaluate((rowData) => {
    const expectedTokens = [rowData.SKU, rowData["URL Slug"], rowData["Listing Title"]].filter(Boolean);
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const hasAnswer = (text) =>
      text.length > 1000 &&
      text.includes("META_TITLE") &&
      text.includes("CANONICAL") &&
      /validation checklist/i.test(text) &&
      expectedTokens.some((token) => text.includes(token));

    const elements = Array.from(document.body.querySelectorAll("*")).filter(visible);
    const matches = elements
      .map((element) => {
        const text = (element.innerText || element.textContent || "").trim();
        if (!hasAnswer(text)) return null;

        const childHasSameAnswer = Array.from(element.children).some((child) => {
          const childText = (child.innerText || child.textContent || "").trim();
          return hasAnswer(childText);
        });
        if (childHasSameAnswer) return null;

        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, textLength: text.length };
      })
      .filter(Boolean)
      .sort((a, b) => a.y - b.y || a.textLength - b.textLength);

    return matches[matches.length - 1] || null;
  }, row);
}

async function scrollAnswerBottomIntoView(page, row) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.evaluate(() => {
      const scrollables = Array.from(document.querySelectorAll("*")).filter((element) => {
        const style = window.getComputedStyle(element);
        return (
          element.scrollHeight > element.clientHeight + 50 &&
          /(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`)
        );
      });

      for (const element of scrollables) {
        element.scrollTop = element.scrollHeight;
      }

      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await page.keyboard.press("End").catch(() => {});
    await page.waitForTimeout(500);

    const box = await findAnswerBox(page, row);
    if (!box) {
      await page.waitForTimeout(500);
      continue;
    }

    const viewportHeight = await page.evaluate(() => window.innerHeight);
    if (box.y + box.height > 120 && box.y + box.height < viewportHeight - 120) return;

    const delta = Math.max(500, box.y + box.height - viewportHeight + 220);
    await page.mouse.move(Math.max(300, box.x + box.width / 2), Math.min(viewportHeight - 100, 700));
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(500);
  }
}

async function writeCopyDebug(page, row) {
  const debugDir = path.resolve("debug");
  fs.mkdirSync(debugDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(debugDir, `copy-fail-${stamp}`);

  const info = await page.evaluate((rowData) => {
    const expectedTokens = [rowData.SKU, rowData["URL Slug"], rowData["Listing Title"]].filter(Boolean);
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };

    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const attrs = {};
        for (const attr of element.attributes) attrs[attr.name] = attr.value;

        return {
          index,
          visible: visible(element),
          text: (element.innerText || element.textContent || "").trim(),
          ariaLabel: element.getAttribute("aria-label") || "",
          title: element.getAttribute("title") || "",
          className: element.className || "",
          attrs,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          html: element.outerHTML.slice(0, 800),
        };
      })
      .filter((button) => button.visible);

    const answerElements = Array.from(document.body.querySelectorAll("*"))
      .filter(visible)
      .map((element) => {
        const text = (element.innerText || element.textContent || "").trim();
        const hasAnswer =
          text.length > 1000 &&
          text.includes("META_TITLE") &&
          text.includes("CANONICAL") &&
          /validation checklist/i.test(text) &&
          expectedTokens.some((token) => text.includes(token));
        if (!hasAnswer) return null;

        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          className: element.className || "",
          attrs: Array.from(element.attributes).reduce((acc, attr) => {
            acc[attr.name] = attr.value;
            return acc;
          }, {}),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          textStart: text.slice(0, 500),
          htmlStart: element.outerHTML.slice(0, 1500),
        };
      })
      .filter(Boolean)
      .slice(-10);

    return {
      url: location.href,
      row: rowData,
      buttonCount: buttons.length,
      buttons,
      answerElements,
    };
  }, row);

  fs.writeFileSync(`${base}.json`, JSON.stringify(info, null, 2), "utf8");
  await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
  console.log(`[debug] Copy debug written to ${base}.json`);
}

async function getAnswerMarkdown(page, beforeText, timeoutMs, stableMs, row) {
  await waitForAnswer(page, beforeText, timeoutMs, stableMs);
  const copiedMarkdown = await copyNewestAnswerMarkdown(page, row);

  if (copiedMarkdown) return copiedMarkdown;

  await writeCopyDebug(page, row).catch((error) => console.log(`[debug] Could not write copy debug: ${error.message}`));
  throw new Error(
    "DeepSeek response finished, but the script could not copy the markdown from the message Copy button. " +
      "Stopping so it does not save stripped formatting."
  );
}

async function newChat(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForComposer(page);
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const promptPath = requireFile(config.prompt, "Prompt");
  const table = parseTable(readUtf8(config.input));
  const outputDir = path.resolve(config.output);
  const profileDir = path.resolve(config.profile);
  fs.mkdirSync(outputDir, { recursive: true });

  const selectedRows = table.rows.slice(config.start, config.start + config.limit);
  console.log(`Loaded ${table.rows.length} rows from ${config.input}.`);
  console.log(`Processing ${selectedRows.length} row(s), starting at row index ${config.start}.`);
  console.log(`Saving markdown files to ${outputDir}.`);

  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: fs.existsSync(config.executablePath) ? config.executablePath : undefined,
    headless: config.headless,
    viewport: { width: 1440, height: 950 },
    permissions: ["clipboard-read", "clipboard-write"],
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = context.pages()[0] || (await context.newPage());

  try {
    await newChat(page, config.url);
    console.log("DeepSeek is open. Log in in the browser if needed; the script will continue when the chat box is available.");
    await attachPromptFile(page, promptPath, config.uploadWaitMs);

    for (const item of selectedRows) {
      const rowNumber = item.index;
      const outputPath = outputPathForRow(outputDir, item.row, rowNumber);

      if (!config.force && looksCompleteOutput(outputPath)) {
        console.log(`[skip] ${rowNumber + 1}: ${path.basename(outputPath)} already exists`);
        continue;
      }

      console.log(`[run] ${rowNumber + 1}: ${item.row["Listing Title"] || item.row["URL Slug"] || "Untitled row"}`);

      const beforeText = await lastAnswerText(page);
      const composer = await waitForComposer(page);
      await fillComposer(composer, item.raw);
      await clickSend(page, composer);

      const answer = await getAnswerMarkdown(page, beforeText, config.responseTimeoutMs, config.stableMs, item.row);
      fs.writeFileSync(outputPath, `${answer}\n`, "utf8");
      console.log(`[save] ${outputPath}`);

      await page.waitForTimeout(config.delayMs);
    }
  } finally {
    await context.close();
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
