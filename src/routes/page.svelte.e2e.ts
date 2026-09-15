import { expect, test, type Page } from "@playwright/test";

// The output switcher shows only the current view until it is hovered.
async function openOutputSwitcher(page: Page): Promise<void> {
  await page.locator(".output-switcher").hover();
}

async function blockNextVaultWrite(page: Page): Promise<void> {
  await page.evaluate(() => {
    const prototype = FileSystemFileHandle.prototype;
    const createWritable = Reflect.get(
      prototype,
      "createWritable",
    ) as FileSystemFileHandle["createWritable"];
    const state = window as typeof window & {
      onyxReleaseWrite?: () => void;
      onyxWriteBlocked?: boolean;
    };
    prototype.createWritable = async function (...parameters) {
      const writable = await createWritable.apply(this, parameters);
      const write = writable.write.bind(writable);
      Object.defineProperty(writable, "write", {
        value: async (data: FileSystemWriteChunkType) => {
          state.onyxWriteBlocked = true;
          await new Promise<void>((resolve) => {
            state.onyxReleaseWrite = resolve;
          });
          return write(data);
        },
      });
      prototype.createWritable = createWritable;
      return writable;
    };
  });
}

async function waitForBlockedVaultWrite(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    Boolean((window as typeof window & { onyxWriteBlocked?: boolean }).onyxWriteBlocked),
  );
}

async function releaseVaultWrite(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as typeof window & { onyxReleaseWrite?: () => void }).onyxReleaseWrite?.(),
  );
}

async function mockGithubSession(page: Page): Promise<void> {
  await page.route("**/api/auth/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/get-session")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          session: { id: "test-session", userId: "test-user" },
          user: { id: "test-user", email: "octocat@example.com", name: "octocat" },
        }),
      });
      return;
    }
    if (pathname.endsWith("/get-access-token") || pathname.endsWith("/refresh-token")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ accessToken: "test-token" }),
      });
      return;
    }
    await route.abort();
  });
}

async function setRenderedSelection(
  page: Page,
  startLine: number,
  startOffset: number,
  endLine = startLine,
  endOffset = startOffset,
): Promise<void> {
  await page.evaluate(
    ({ startLine, startOffset, endLine, endOffset }) => {
      const lineAt = (line: number): HTMLElement => {
        const element = document.querySelector<HTMLElement>(`[data-live-line="${line}"]`);
        if (!element) throw new Error(`Rendered line ${line} is not available`);
        return element;
      };
      const pointAt = (element: HTMLElement, offset: number): { node: Node; offset: number } => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let remaining = Math.max(0, offset);
        let node = walker.nextNode();
        while (node) {
          const length = node.textContent?.length ?? 0;
          if (remaining <= length) return { node, offset: remaining };
          remaining -= length;
          node = walker.nextNode();
        }
        return { node: element, offset: element.childNodes.length };
      };

      const start = pointAt(lineAt(startLine), startOffset);
      const end = pointAt(lineAt(endLine), endOffset);
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const selection = window.getSelection();
      if (!selection) throw new Error("The browser did not expose a selection");
      lineAt(startLine).focus();
      selection.removeAllRanges();
      selection.addRange(range);
    },
    { startLine, startOffset, endLine, endOffset },
  );
}

async function pointInsideRenderedText(
  page: Page,
  selector: string,
  offset: number,
): Promise<{ x: number; y: number; left: number; right: number; top: number }> {
  return page.locator(selector).evaluate((element, requestedOffset) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node && !node.data.length) node = walker.nextNode() as Text | null;
    if (!node) throw new Error("Rendered text is not available");
    const offset = Math.min(Math.max(0, requestedOffset), Math.max(0, node.length - 1));
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, Math.min(node.length, offset + 1));
    const rect = range.getBoundingClientRect();
    return {
      x: rect.left + Math.max(1, rect.width) / 2,
      y: rect.top + rect.height / 2,
      left: rect.left,
      right: rect.right,
      top: rect.top,
    };
  }, offset);
}

async function renderedSelectionDetails(page: Page) {
  return page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const lines = [...document.querySelectorAll<HTMLElement>("[data-live-line]")];
    const lineOf = (node: Node | null): HTMLElement | undefined => {
      const element = node instanceof HTMLElement ? node : node?.parentElement;
      return element?.closest<HTMLElement>("[data-live-line]") ?? undefined;
    };
    const offsetOf = (line: HTMLElement, node: Node, offset: number): number => {
      const range = document.createRange();
      range.selectNodeContents(line);
      range.setEnd(node, offset);
      return range.cloneContents().textContent?.length ?? 0;
    };
    const globalOffset = (line: HTMLElement | undefined, node: Node, offset: number) => {
      if (!line) return undefined;
      const index = Number(line.dataset.liveLine);
      const local = offsetOf(line, node, offset);
      return (
        lines
          .slice(0, index)
          .reduce((total, candidate) => total + candidate.textContent!.length + 1, 0) + local
      );
    };
    const anchorLine = lineOf(selection.anchorNode);
    const focusLine = lineOf(selection.focusNode);
    const anchor = globalOffset(anchorLine, selection.anchorNode!, selection.anchorOffset);
    const focus = globalOffset(focusLine, selection.focusNode!, selection.focusOffset);
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return {
      anchorLine: anchorLine?.dataset.liveLine ?? null,
      focusLine: focusLine?.dataset.liveLine ?? null,
      start: anchor === undefined || focus === undefined ? null : Math.min(anchor, focus),
      end: anchor === undefined || focus === undefined ? null : Math.max(anchor, focus),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      text: selection.toString(),
    };
  });
}

test("traps modal focus and returns it to the opener", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeEnabled();

  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.click();
  await expect(settings).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Close settings" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close settings" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(settings).toBeFocused();
  await expect(settings).toHaveAttribute("aria-expanded", "false");

  const palette = page.getByRole("button", { name: "Open the command palette" });
  await palette.click();
  await expect(page.getByRole("combobox", { name: "Search notes and commands" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette).toBeFocused();
});

test("offers additional color themes and persists the selection", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeEnabled();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Themes", exact: true }).click();

  const colorThemes = page.getByRole("radiogroup", { name: "Color theme" });
  await expect(colorThemes.getByRole("radio")).toHaveCount(10);

  for (const theme of [
    { id: "ember", label: "Ember" },
    { id: "monochrome", label: "Monochrome" },
    { id: "ocean", label: "Ocean" },
    { id: "phosphor", label: "Forest" },
    { id: "marigold", label: "Marigold" },
    { id: "espresso", label: "Espresso" },
    { id: "ink", label: "Ink" },
    { id: "lavender", label: "Lavender" },
    { id: "rose", label: "Rose" },
    { id: "solarized", label: "Solarized" },
  ]) {
    const option = colorThemes.getByRole("radio").filter({ hasText: theme.label });
    await expect(option).toHaveCount(1);
    await option.click();
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", theme.id);
    await expect(option).toHaveAttribute("aria-checked", "true");
  }

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-color-theme", "solarized");
});

test("opens general settings on Editor and the storage shortcut on Storage choices", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Editor", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("heading", { name: "Editor", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore default fonts" })).toHaveCount(0);

  await page.locator("#font-heading").selectOption("inter");
  await expect(page.getByRole("button", { name: "Restore default fonts" })).toBeVisible();
  await page.getByRole("button", { name: "Restore default fonts" }).click();
  await expect(page.getByRole("button", { name: "Restore default fonts" })).toHaveCount(0);

  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Open local storage settings" }).click();
  await expect(page.getByRole("button", { name: "Storage choices", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("persists edits made while an earlier save is still in flight", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(editor).toBeEnabled();

  await blockNextVaultWrite(page);

  await editor.fill("# First edit");
  await page.keyboard.press("ControlOrMeta+S");
  await waitForBlockedVaultWrite(page);
  await editor.fill("# Latest concurrent edit");
  await releaseVaultWrite(page);

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("onyx-vault");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const transaction = database.transaction("noteContents", "readonly");
        const records = await new Promise<Array<{ markdown: string }>>((resolve, reject) => {
          const request = transaction.objectStore("noteContents").getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        database.close();
        return records.some((record) => record.markdown === "# Latest concurrent edit");
      }),
    )
    .toBe(true);
  await page.reload();
  await expect(editor).toHaveValue("# Latest concurrent edit");
});

test("waits for an in-flight save before deleting the vault", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(editor).toBeEnabled();
  await blockNextVaultWrite(page);

  await editor.fill("# Unsynced deletion draft");
  await page.keyboard.press("ControlOrMeta+S");
  await waitForBlockedVaultWrite(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Vault", exact: true }).click();
  await page.getByRole("button", { name: "Delete all notes" }).click();

  await expect(page.getByRole("button", { name: "Checking changes…" })).toBeDisabled();
  await releaseVaultWrite(page);
  await expect(
    page.getByText(/pending changes? (?:has|have) not been backed up to GitHub/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Click to confirm" }).click();
  await page.getByRole("button", { name: "Close settings" }).click();

  await expect(editor).toHaveValue("");
  await page.reload();
  await expect(editor).toHaveValue(/# Welcome to Onyx/);
});

test("keeps startup usable when localStorage and persistent storage are unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("Storage is disabled", "SecurityError");
      },
    });
    Object.defineProperties(navigator.storage, {
      persist: { configurable: true, value: undefined },
      persisted: { configurable: true, value: undefined },
    });
  });

  await page.goto("/");

  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeEnabled();
  await expect(page.getByRole("status")).toContainText("Browser settings cannot be saved");
  await expect(page.getByRole("status")).toContainText("Persistent storage is unavailable");
});

test("deletes all notes without restoring stale editor content", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(editor).toBeEnabled();

  await editor.fill("# This note must stay deleted\n\nThe editor must not bring this text back.");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Vault", exact: true }).click();
  await page.getByRole("button", { name: "Delete all notes", exact: true }).click();
  await page.getByRole("button", { name: "Click to confirm", exact: true }).click();

  await expect(editor).toHaveValue("");
  await expect(page.getByText("0 notes", { exact: true })).toBeVisible();
  await expect(page.getByText("No notes yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /This note must stay deleted/ })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("onyx-vault");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const transaction = database.transaction(["notes", "noteContents"], "readonly");
        const counts = await Promise.all(
          ["notes", "noteContents"].map(
            (storeName) =>
              new Promise<number>((resolve, reject) => {
                const request = transaction.objectStore(storeName).count();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              }),
          ),
        );
        database.close();
        return counts;
      }),
    )
    .toEqual([0, 0]);
});

for (const unavailableFeature of ["IndexedDB", "OPFS"] as const) {
  test(`shows a startup fallback when ${unavailableFeature} is unavailable`, async ({ page }) => {
    await page.addInitScript((feature) => {
      if (feature === "IndexedDB") {
        Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined });
      } else {
        Object.defineProperty(navigator.storage, "getDirectory", {
          configurable: true,
          value: undefined,
        });
      }
    }, unavailableFeature);

    await page.goto("/");

    await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeEnabled();
    await expect(page.getByRole("alert")).toContainText(
      unavailableFeature === "IndexedDB"
        ? "IndexedDB is unavailable"
        : "Origin private file storage (OPFS) is unavailable",
    );
  });
}

test("keeps the editor usable and pauses GitHub features offline", async ({ context, page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeEnabled();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  await page.evaluate(async () => {
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
    });
  });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByRole("button", { name: "Open local storage settings" })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Backup & sync", exact: true }).click();
  await expect(
    page.getByText("GitHub settings are paused until your connection returns."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeDisabled();
  await page.getByRole("button", { name: "Close settings" }).click();

  const editor = page.getByRole("textbox", { name: "Markdown editor" });
  await editor.fill("# Written offline\n\nOnyx keeps working without a connection.");
  await expect(page.getByText("Unsaved", { exact: true })).toBeHidden();
  await expect(page.getByText("Saving…", { exact: true })).toBeHidden();
  await page.keyboard.press("ControlOrMeta+S");
});

test("searches note titles and Markdown content", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeEnabled();

  await page.getByRole("button", { name: "New note" }).click();
  await expect(page.getByRole("button", { name: "Untitled", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  const editor = page.getByRole("textbox", { name: "Markdown editor" });
  await editor.fill("# Project Aurora\n\nThe neutrino research summary is ready.");
  await expect(editor).toHaveValue(/Project Aurora/);
  await expect(page.getByText("Unsaved", { exact: true })).toBeHidden();
  await expect(page.getByText("Saving…", { exact: true })).toBeHidden();
  await page.keyboard.press("ControlOrMeta+S");

  await page.getByPlaceholder("Search all notes").fill("neut");
  await expect(page.getByText("1 result")).toBeVisible();
  await expect(page.getByRole("button", { name: /Project Aurora/ })).toBeVisible();
});

test("uses the first Markdown heading for notes with front matter", async ({ page }) => {
  await page.goto("/");
  const markdown = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(markdown).toBeEnabled();

  await markdown.fill("---\ntitle: Metadata title\n---\n\n# Rendered title");

  await expect(page.getByRole("button", { name: "Rendered title", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Tools" }).click();
  await page.getByRole("button", { name: "Turn on read-only" }).click();
  await expect(page.locator(".preview-pane h1")).toHaveText("Rendered title");
});

test("formats Markdown while editing in the page pane", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeEnabled();

  const line = page.getByRole("textbox", { name: "Markdown line 3" });
  await line.fill("Onyx renders **Markdown** and _italic_ while you keep writing.");
  await expect(line).toContainText(
    "Onyx renders **Markdown** and _italic_ while you keep writing.",
  );
  await expect(line.locator("strong")).toHaveText("Markdown");
  await expect(line.locator("em")).toHaveText("italic");
  await expect(line.locator("em")).toHaveCSS("font-synthesis", "style");

  await line.fill("A ~~struck~~ ==marked== [link](https://example.com).");
  await expect(line.locator("del")).toHaveText("struck");
  await expect(line.locator("mark")).toHaveText("marked");
  await expect(line.locator("a")).toHaveCount(1);
  await expect(line.locator("a")).toHaveText("link");
  await expect(line).toContainText("[link](https://example.com)");

  await line.fill("#");
  await expect(line).not.toHaveClass(/heading-1/);
  await line.press(" ");
  await expect(line).toHaveClass(/heading-1/);
  await expect(line.locator(".md-syntax")).toHaveText("# ");
  await line.pressSequentially("Inline heading");
  await expect(line).toContainText("# Inline heading");
});

test("keeps rendered selections continuous across lines", async ({ page }) => {
  await page.goto("/");
  const markdown = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(markdown).toBeEnabled();
  const source = "alpha **bold**\nsecond line\nthird ending";
  const start = 6;
  const end = source.indexOf("ending");
  await markdown.fill(source);

  await setRenderedSelection(page, 0, start, 2, 6);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selection = window.getSelection();
        const lineOf = (node: Node | null) => {
          const element = node instanceof HTMLElement ? node : node?.parentElement;
          return element?.closest<HTMLElement>("[data-live-line]")?.dataset.liveLine ?? null;
        };
        return {
          anchor: lineOf(selection?.anchorNode ?? null),
          focus: lineOf(selection?.focusNode ?? null),
        };
      }),
    )
    .toEqual({ anchor: "0", focus: "2" });

  await page.evaluate(() => {
    const state = window as typeof window & { onyxCopied?: string };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void (state.onyxCopied = text) },
    });
  });
  await page.keyboard.press("ControlOrMeta+C");
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { onyxCopied?: string }).onyxCopied))
    .toBe(source.slice(start, end));

  await markdown.fill(source);
  await setRenderedSelection(page, 0, start, 2, 6);
  await page.keyboard.type("REPLACED");
  await expect(markdown).toHaveValue("alpha REPLACEDending");

  await markdown.fill(source);
  await setRenderedSelection(page, 0, start, 2, 6);
  await page.keyboard.press("Backspace");
  await expect(markdown).toHaveValue("alpha ending");
});

test("allows mouse selection to cross rendered lines", async ({ page }) => {
  await page.goto("/");
  const markdown = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(markdown).toBeEnabled();
  const source = "first line here\nsecond line here\nthird line ending";
  await markdown.fill(source);

  const points = await page.evaluate(() => {
    const pointAt = (line: number, offset: number) => {
      const element = document.querySelector<HTMLElement>(`[data-live-line="${line}"]`);
      if (!element) throw new Error(`Rendered line ${line} is not available`);
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let remaining = offset;
      let node = walker.nextNode();
      while (node) {
        const length = node.textContent?.length ?? 0;
        if (remaining <= length) break;
        remaining -= length;
        node = walker.nextNode();
      }
      const range = document.createRange();
      if (node) range.setStart(node, remaining);
      else {
        range.selectNodeContents(element);
        range.collapse(false);
      }
      range.collapse(true);
      const caret = range.getBoundingClientRect();
      const lineRect = element.getBoundingClientRect();
      return { x: caret.left || lineRect.left + 2, y: lineRect.top + lineRect.height / 2 };
    };
    return { start: pointAt(0, 2), end: pointAt(2, 11) };
  });

  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selection = window.getSelection();
        const lineOf = (node: Node | null) => {
          const element = node instanceof HTMLElement ? node : node?.parentElement;
          return element?.closest<HTMLElement>("[data-live-line]")?.dataset.liveLine ?? null;
        };
        return {
          anchor: lineOf(selection?.anchorNode ?? null),
          focus: lineOf(selection?.focusNode ?? null),
        };
      }),
    )
    .toEqual({ anchor: "0", focus: "2" });

  await page.evaluate(() => {
    const state = window as typeof window & { onyxCopied?: string };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void (state.onyxCopied = text) },
    });
  });
  await page.keyboard.press("ControlOrMeta+C");
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { onyxCopied?: string }).onyxCopied))
    .toBe(source.slice(2, source.indexOf("ending")));
});

test("places the rendered caret on the visible text that was clicked", async ({ page }) => {
  await page.goto("/");
  const markdown = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(markdown).toBeEnabled();
  const source = [
    "# Welcome to Onyx",
    "",
    "A paragraph with enough text to test the caret.",
    "",
    "> Good tools disappear into the work.",
  ].join("\n");
  await markdown.fill(source);
  const sourceLines = source.split("\n");
  const lineOffsets = sourceLines.map((_, index) =>
    sourceLines.slice(0, index).reduce((total, line) => total + line.length + 1, 0),
  );

  const cases = [
    { selector: ".live-rendered-content h1", line: 0, prefixLength: 2, offset: 4 },
    {
      selector: ".live-rendered-content > p",
      line: 2,
      prefixLength: 0,
      offset: 4,
    },
    {
      selector: ".live-rendered-content > blockquote > p",
      line: 4,
      prefixLength: 2,
      offset: 4,
    },
  ];

  for (const candidate of cases) {
    const point = await pointInsideRenderedText(page, candidate.selector, candidate.offset);
    await page.mouse.click(point.x, point.y);
    await expect
      .poll(() => renderedSelectionDetails(page))
      .toMatchObject({ anchorLine: String(candidate.line), focusLine: String(candidate.line) });
    const selection = await renderedSelectionDetails(page);
    expect(selection).not.toBeNull();
    if (!selection) throw new Error("The browser did not expose the rendered caret");
    const expectedOffset = lineOffsets[candidate.line]! + candidate.prefixLength + candidate.offset;
    expect(selection.start).toBeGreaterThanOrEqual(expectedOffset);
    expect(selection.start).toBeLessThanOrEqual(expectedOffset + 1);
    expect(selection.rect.x).toBeGreaterThanOrEqual(point.left - 2);
    expect(selection.rect.x).toBeLessThanOrEqual(point.right + 2);
    expect(Math.abs(selection.rect.y - point.top)).toBeLessThan(3);
  }
});

test("places the rendered caret on table cell text", async ({ page }) => {
  await page.goto("/");
  const markdown = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(markdown).toBeEnabled();
  const source = "# Table\n\n| Name | State |\n| --- | --- |\n| Onyx | Ready |";
  await markdown.fill(source);

  for (const selector of [
    ".live-rendered-content table td:nth-of-type(1)",
    ".live-rendered-content table td:nth-of-type(2)",
  ]) {
    const point = await pointInsideRenderedText(page, selector, 2);
    await page.mouse.click(point.x, point.y);
    await expect
      .poll(() => renderedSelectionDetails(page))
      .toMatchObject({ anchorLine: "4", focusLine: "4" });
    const selection = await renderedSelectionDetails(page);
    expect(selection).not.toBeNull();
    if (!selection) throw new Error("The browser did not expose the rendered caret");
    expect(selection.rect.x).toBeGreaterThanOrEqual(point.left - 2);
    expect(selection.rect.x).toBeLessThanOrEqual(point.right + 2);
    expect(Math.abs(selection.rect.y - point.top)).toBeLessThan(3);
  }
});

test("keeps drag selection continuous across formatted rendered blocks", async ({ page }) => {
  await page.goto("/");
  const markdown = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(markdown).toBeEnabled();
  await markdown.fill(
    "# Welcome to Onyx\n\nA paragraph with enough text to select.\n\n> Good tools disappear into the work.",
  );

  const start = await pointInsideRenderedText(page, ".live-rendered-content h1", 4);
  const end = await pointInsideRenderedText(page, ".live-rendered-content > blockquote > p", 8);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(() => renderedSelectionDetails(page))
    .toMatchObject({ anchorLine: "0", focusLine: "4" });
});

test("keeps list markers inside rendered selections", async ({ page }) => {
  await page.goto("/");
  const markdown = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(markdown).toBeEnabled();
  const source = "### Tasks\n\n- A regular item\n- [x] A checked item\n- [ ] An open item";
  await markdown.fill(source);

  await setRenderedSelection(page, 2, 0, 4, source.split("\n")[4]!.length);

  const selectedLines = page.locator(".live-editing-overlay [data-live-line].selection-active");
  await expect(selectedLines).toHaveCount(3);
  const listGeometry = await page.evaluate(() => {
    const editable = [
      ...document.querySelectorAll<HTMLElement>(".live-editing-overlay [data-live-line]"),
    ].slice(2, 5);
    const listRect = document
      .querySelector<HTMLElement>(".live-rendered-content ul")!
      .getBoundingClientRect();
    const rendered = [...document.querySelectorAll<HTMLElement>(".live-rendered-content li")];
    return editable.map((line, index) => {
      const lineRect = line.getBoundingClientRect();
      const itemRect = rendered[index]!.getBoundingClientRect();
      return { dx: lineRect.left - listRect.left, dy: lineRect.top - itemRect.top };
    });
  });
  for (const geometry of listGeometry) {
    expect(Math.abs(geometry.dx)).toBeLessThan(1);
    expect(Math.abs(geometry.dy)).toBeLessThan(1);
  }
  await expect
    .poll(() =>
      page
        .locator('.live-editing-overlay [data-live-line="2"] .live-list-marker')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .not.toBe("rgba(0, 0, 0, 0)");
  for (const line of [3, 4]) {
    await expect
      .poll(() =>
        page
          .locator(`.live-editing-overlay [data-live-line="${line}"] .live-task-check`)
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .not.toBe("rgba(0, 0, 0, 0)");
  }
});

test("triple-click selects a complete rendered Markdown line", async ({ page }) => {
  await page.goto("/");
  const markdown = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(markdown).toBeEnabled();
  const source = "# Welcome to Onyx\n\nA second line";
  await markdown.fill(source);

  const point = await pointInsideRenderedText(page, ".live-rendered-content h1", 5);
  await page.mouse.click(point.x, point.y, { clickCount: 3 });

  await expect
    .poll(() => renderedSelectionDetails(page))
    .toMatchObject({
      anchorLine: "0",
      focusLine: "1",
      start: 0,
      end: "# Welcome to Onyx\n".length,
      text: "Welcome to Onyx",
    });

  await page.keyboard.type("Replaced");
  await expect(markdown).toHaveValue("Replaced\nA second line");
});

test("keeps the rendered caret usable through typing and line boundaries", async ({ page }) => {
  await page.goto("/");
  const markdown = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(markdown).toBeEnabled();

  await markdown.fill("This is **bold** text.");
  await setRenderedSelection(page, 0, "This is **bold** text.".length);
  await page.keyboard.type(" added");
  await expect(markdown).toHaveValue("This is **bold** text. added");
  for (let index = 0; index < " added".length; index += 1) await page.keyboard.press("Backspace");
  await expect(markdown).toHaveValue("This is **bold** text.");

  await markdown.fill("first\nsecond\nthird");
  await setRenderedSelection(page, 0, 5);
  await page.keyboard.press("Delete");
  await expect(markdown).toHaveValue("firstsecond\nthird");

  await markdown.fill("first\nsecond");
  await setRenderedSelection(page, 1, 0);
  await page.keyboard.press("Backspace");
  await expect(markdown).toHaveValue("firstsecond");

  await markdown.fill("one\ntwo");
  await setRenderedSelection(page, 1, 0);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("X");
  await expect(markdown).toHaveValue("oneX\ntwo");

  await markdown.fill("one\ntwo");
  await setRenderedSelection(page, 0, 3);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("X");
  await expect(markdown).toHaveValue("one\nXtwo");

  await markdown.fill("ab");
  await setRenderedSelection(page, 0, 1);
  await page.keyboard.press("Enter");
  await page.keyboard.type("X");
  await expect(markdown).toHaveValue("a\nXb");
});

test("supports standard editing shortcuts in the page pane", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeEnabled();

  const line = page.getByRole("textbox", { name: "Markdown line 1", exact: true });
  await line.fill("# Shortcut target");
  await line.press("End");
  await line.pressSequentially("!");
  await line.press("ControlOrMeta+Z");
  await expect(line).toContainText("# Shortcut target");
  await line.press("ControlOrMeta+Y");
  await expect(line).toContainText("# Shortcut target!");

  await page.evaluate(() => {
    const state = window as typeof window & { onyxCopied?: string; onyxPaste?: string };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => void (state.onyxCopied = text),
        readText: async () => state.onyxPaste ?? "",
      },
    });
  });

  await line.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node && !node.data.includes("target")) node = walker.nextNode() as Text | null;
    const textNode = node;
    if (!textNode) throw new Error("The target text is not editable");
    const start = textNode.data.indexOf("target");
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + "target".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    (element as HTMLElement).focus();
  });
  await line.press("ControlOrMeta+C");
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { onyxCopied?: string }).onyxCopied))
    .toBe("target");
  await line.press("ControlOrMeta+X");
  await expect(line).toContainText("# Shortcut !");

  await page.evaluate(() => {
    (window as typeof window & { onyxPaste?: string }).onyxPaste = "target";
  });
  await line.press("ControlOrMeta+V");
  await expect(line).toContainText("# Shortcut target!");
  await line.press("ControlOrMeta+Z");
  await expect(line).toContainText("# Shortcut !");
  await line.press("ControlOrMeta+Shift+Z");
  await expect(line).toContainText("# Shortcut target!");
});

test("keeps the editable page preview aligned with read-only rendering", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(editor).toBeEnabled();

  await editor.fill(
    "# Formatting tour\n\nThis has **bold**, _italic_, ~~strike~~, ==highlight==, `code`, and [a link](https://example.com).\n\n## Lists\n\n- First item\n- **Bold item**\n- [x] Finished\n- [ ] Pending\n\n1. Ordered first\n2. Ordered second\n\n> A quoted line\n\n---\n\n```ts\nconst value = 42;\n```\n\n| Name | State |\n| --- | --- |\n| Onyx | Ready |",
  );

  const live = page.locator(".preview-pane .live-editor");
  await expect(live.locator(".live-editable-line em")).toHaveText("italic");
  await expect(live.locator(".live-table-row.header")).toBeVisible();
  await expect(live.locator(".live-table-row.body")).toBeVisible();
  await expect(live.locator(".live-editable-line.code-content")).toHaveText("const value = 42;");
  await expect(live.locator(".live-editable-line.code-content .hljs-keyword")).toHaveText("const");
  await expect(live.locator(".live-editable-line.code-content .hljs-number")).toHaveText("42");
  await expect(live.locator('.live-editable-line.code-end[data-code-language="TS"]')).toHaveCount(
    1,
  );
  const editableMarkup = await live.locator(".live-rendered-content").innerHTML();
  await page.locator(".preview-pane").evaluate((pane) => {
    pane.scrollTop = 0;
    pane.querySelector<HTMLElement>(".live-editor")!.scrollTop = 0;
  });

  const editableGeometry = await live.evaluate((container) => {
    const rectOf = (selector: string) => {
      const rect = container.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    };
    const listRect = (selector: string) => {
      const listLines = [...container.querySelectorAll<HTMLElement>(selector)];
      const firstList = listLines[0]?.getBoundingClientRect();
      const lastList = listLines.at(-1)?.getBoundingClientRect();
      return firstList && lastList
        ? {
            x: firstList.x,
            y: firstList.y,
            width: firstList.width,
            height: lastList.bottom - firstList.y,
          }
        : null;
    };
    return [
      rectOf(".heading-1"),
      rectOf(
        ".live-editable-line:not([class*='heading-']):not(.blank-line):not(.list-line):not(.quote-line):not(.rule-line):not(.code-line):not(.table-line)",
      ),
      rectOf(".heading-2"),
      listRect(".list-line:not(.ordered-list)"),
      listRect(".list-line.ordered-list"),
      rectOf(".quote-line"),
      rectOf(".rule-line"),
      rectOf(".code-content"),
    ];
  });

  await page.getByRole("tab", { name: "Tools" }).click();
  await page.getByRole("button", { name: "Turn on read-only" }).click();
  const article = page.locator(".preview-pane article.prose");
  expect(await article.innerHTML()).toBe(editableMarkup);
  await expect(article.locator("table")).toBeVisible();
  await expect(article.locator("ul")).toHaveCSS("list-style-type", "disc");
  await expect(article.locator("ol")).toHaveCSS("list-style-type", "decimal");
  await expect(article.locator("pre code.hljs")).toHaveCount(1);
  await expect(article.locator('pre[data-code-language="TS"]')).toHaveCount(1);
  await expect(article.locator(".hljs-keyword")).toHaveText("const");
  await expect(article.locator(".hljs-number")).toHaveText("42");
  await page.locator(".preview-pane").evaluate((pane) => {
    pane.scrollTop = 0;
  });

  const readOnlyGeometry = await article.evaluate((container) => {
    const selectors = ["h1", "p", "h2", "ul", "ol", "blockquote", "hr", "pre"];
    return selectors.map((selector) => {
      const rect = container.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    });
  });

  expect(editableGeometry).toHaveLength(readOnlyGeometry.length);
  editableGeometry.forEach((editable, index) => {
    const readOnly = readOnlyGeometry[index];
    expect(editable).not.toBeNull();
    expect(readOnly).not.toBeNull();
    expect(Math.abs(editable!.x - readOnly!.x), `geometry ${index} x`).toBeLessThan(1);
    expect(Math.abs(editable!.y - readOnly!.y), `geometry ${index} y`).toBeLessThan(1);
    expect(Math.abs(editable!.width - readOnly!.width), `geometry ${index} width`).toBeLessThan(1);
    expect(Math.abs(editable!.height - readOnly!.height), `geometry ${index} height`).toBeLessThan(
      1,
    );
  });
});

test("keeps both panes synchronized and lets each pane be tucked away", async ({ page }) => {
  await page.goto("/");
  const markdown = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(markdown).toBeEnabled();

  await markdown.fill("# Written on the right");
  await expect(page.getByRole("textbox", { name: "Markdown line 1" })).toContainText(
    "Written on the right",
  );

  await page.getByRole("button", { name: "Hide the output pane" }).click();
  await expect(markdown).toBeHidden();
  await page.getByRole("button", { name: "Show the output pane" }).click();
  await expect(markdown).toBeVisible();

  await page.getByRole("tab", { name: "Tools" }).click();
  await page.getByRole("textbox", { name: "Markdown line 1" }).fill("# Written on the left");
  await expect(markdown).toHaveValue("# Written on the left");

  await page.getByRole("button", { name: "Turn on read-only" }).click();
  await expect(page.locator(".preview-pane h1")).toHaveText("Written on the left");
  await page.getByRole("button", { name: "Hide the page pane" }).click();
  await expect(page.locator(".preview-pane")).toBeHidden();
  await page.getByRole("button", { name: "Show the page pane" }).click();
  await expect(page.locator(".preview-pane")).toBeVisible();
});

type ScrollSide = "output" | "rendered";

// Scrolls one pane so the marker sits where the pane reads its position, then reports how far
// the marker sits from that point in each pane.
async function markerOffsets(page: Page, from: ScrollSide | null, marker: string) {
  return page.evaluate(
    ({ from, marker }: { from: ScrollSide | null; marker: string }) => {
      const scrollers = {
        output: document.querySelector<HTMLElement>(".output-body > :first-child")!,
        rendered: document.querySelector<HTMLElement>(".preview-pane")!,
      };
      const markerTop = (scroller: HTMLElement): number => {
        if (scroller instanceof HTMLTextAreaElement) {
          const style = getComputedStyle(scroller);
          const line = scroller.value.split("\n").findIndex((text) => text.includes(marker));
          return parseFloat(style.paddingTop) + line * parseFloat(style.lineHeight);
        }
        const walker = document.createTreeWalker(scroller, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const text = walker.currentNode as Text;
          const index = text.data.indexOf(marker);
          if (index === -1) continue;
          const range = document.createRange();
          range.setStart(text, index);
          range.setEnd(text, index + marker.length);
          return (
            range.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top +
            scroller.scrollTop
          );
        }
        throw new Error(`${marker} is not shown`);
      };
      const offset = (scroller: HTMLElement): number => {
        const range = scroller.scrollHeight - scroller.clientHeight;
        const reference = (scroller.clientHeight * scroller.scrollTop) / range;
        return markerTop(scroller) - scroller.scrollTop - reference;
      };
      if (from) {
        const scroller = scrollers[from];
        const range = scroller.scrollHeight - scroller.clientHeight;
        scroller.scrollTop = (markerTop(scroller) * range) / scroller.scrollHeight;
      }
      return { output: offset(scrollers.output), rendered: offset(scrollers.rendered) };
    },
    { from, marker },
  );
}

test("scrolls each pane to the part of the note shown in the other one", async ({ page }) => {
  await page.goto("/");
  const markdown = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(markdown).toBeEnabled();
  // Sections differ in length and shape, so a proportional scroll would drift away from them.
  const sections = Array.from({ length: 30 }, (_, index) => {
    const body = Array.from(
      { length: (index % 4) + 1 },
      (_, line) => `Line ${line} of part ${index}.`,
    );
    const extra =
      index % 3 === 0
        ? ["", "```", ...Array.from({ length: 14 }, (_, line) => `code ${line}`), "```"]
        : index % 3 === 1
          ? ["", "- one", "- two", "- three"]
          : [];
    return [`## Marker-${index}`, "", ...body, ...extra].join("\n");
  });
  await markdown.fill(sections.join("\n\n"));
  await expect(page.locator(".preview-pane")).toContainText("Marker-29");

  const views = ["Markdown", "Plain text", "Rich text", "HTML", "PDF"];
  for (const readOnly of [false, true]) {
    if (readOnly) {
      await page.getByRole("tab", { name: "Tools" }).click();
      await page.getByRole("button", { name: "Turn on read-only" }).click();
      await expect(page.locator(".preview-pane article.prose")).toBeVisible();
    }
    for (const [index, view] of views.entries()) {
      await openOutputSwitcher(page);
      await page.getByRole("tab", { name: view }).click();
      for (const [from, marker] of [
        ["rendered", `Marker-${7 + index * 3}`],
        ["output", `Marker-${24 - index * 2}`],
      ] as const) {
        const other = from === "output" ? "rendered" : "output";
        await markerOffsets(page, from, marker);
        await expect
          .poll(async () => Math.abs((await markerOffsets(page, null, marker))[other]), {
            message: `${view} ${readOnly ? "read-only" : "editable"}: ${other} follows ${from} to ${marker}`,
          })
          .toBeLessThan(40);
      }
    }
  }

  // Typing at the end keeps the editor on the caret, and the page follows it down.
  await openOutputSwitcher(page);
  await page.getByRole("tab", { name: "Markdown" }).click();
  await markdown.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n\nThe last word.");
  const caretShown = await markdown.evaluate((textarea: HTMLTextAreaElement) => {
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight);
    const caretTop = textarea.scrollHeight - parseFloat(getComputedStyle(textarea).paddingBottom);
    return (
      caretTop - lineHeight >= textarea.scrollTop &&
      caretTop <= textarea.scrollTop + textarea.clientHeight
    );
  });
  expect(caretShown).toBe(true);
  await expect(page.locator(".preview-pane").getByText("The last word.")).toBeInViewport();
});

test("moves a pane by dragging its grip beside the divider or with the arrow keys", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeEnabled();
  const shell = page.locator(".editor-shell");
  const panesBox = await shell.boundingBox();
  if (!panesBox) throw new Error("The panes are not laid out");
  const gripOffset = async (name: string) => {
    const divider = await page.locator(".pane-divider").boundingBox();
    const box = await page.getByRole("button", { name }).boundingBox();
    if (!divider || !box) throw new Error("The divider or grip is not laid out");
    expect(box.y + box.height / 2).toBeCloseTo(divider.y + divider.height / 2, 0);
    return box.x + box.width / 2 - divider.x;
  };
  const leadingOffset = await gripOffset("Move the page pane");
  expect(leadingOffset).toBeLessThan(-14);
  expect(leadingOffset).toBeGreaterThan(-40);
  const trailingOffset = await gripOffset("Move the output pane");
  expect(trailingOffset).toBeGreaterThan(14);
  expect(trailingOffset).toBeLessThan(40);

  const gripLocator = page.getByRole("button", { name: "Move the page pane" });
  const pill = () =>
    gripLocator.evaluate((element) => getComputedStyle(element, "::after").opacity);
  expect(await pill()).toBe("0");
  await gripLocator.hover();
  await expect.poll(pill).toBe("1");

  const grip = await gripLocator.boundingBox();
  if (!grip) throw new Error("The page pane grip is not laid out");
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(panesBox.x + panesBox.width / 2, panesBox.y + panesBox.height - 20, {
    steps: 10,
  });
  await expect(page.locator(".pane-drop-slot")).toBeVisible();
  await page.mouse.up();
  await expect(shell).toHaveClass(/panes-stacked/);
  await expect(shell).not.toHaveClass(/panes-swapped/);
  await expect(page.locator(".pane-drop-slot")).toHaveCount(0);
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    ),
  );

  const outputGrip = await page.getByRole("button", { name: "Move the output pane" }).boundingBox();
  if (!outputGrip) throw new Error("The output pane grip is not laid out");
  await page.mouse.move(outputGrip.x + outputGrip.width / 2, outputGrip.y + outputGrip.height / 2);
  await page.mouse.down();
  await page.mouse.move(panesBox.x + panesBox.width - 20, panesBox.y + panesBox.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(shell).not.toHaveClass(/panes-stacked/);
  await expect(shell).toHaveClass(/panes-swapped/);

  await page.getByRole("button", { name: "Move the page pane" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(shell).not.toHaveClass(/panes-swapped/);
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  expect(await gripOffset("Move the page pane")).toBeGreaterThan(14);

  await openOutputSwitcher(page);

  await page.getByRole("tab", { name: "HTML" }).click();
  await expect(page.getByRole("tab", { name: "HTML" })).toHaveAttribute("aria-selected", "true");
  await expect(shell).not.toHaveClass(/panes-swapped/);
});

test("copies and downloads the Markdown source from the output pane", async ({ page }) => {
  await page.goto("/");
  const markdown = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(markdown).toBeEnabled();
  await markdown.fill("# Packing list\n\n- **Passport**");
  await page.evaluate(() => {
    const state = window as typeof window & { onyxCopied?: string };
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => void (state.onyxCopied = text) },
    });
  });

  await openOutputSwitcher(page);

  await page.getByRole("button", { name: "Copy" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { onyxCopied?: string }).onyxCopied))
    .toBe("# Packing list\n\n- **Passport**");
  await expect(page.getByText("Copied this note as Markdown.")).toBeVisible();

  const download = page.waitForEvent("download");
  await openOutputSwitcher(page);
  await page.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("packing-list.md");
});

test("shows the note as plain text in the output pane, copies and downloads it", async ({
  page,
}) => {
  await page.goto("/");
  const markdown = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(markdown).toBeEnabled();
  await markdown.fill("# Grocery list\n\n- **Fresh** bread\n- [Oats](https://example.com/oats)");
  await page.evaluate(() => {
    const state = window as typeof window & { onyxCopied?: string };
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => void (state.onyxCopied = text) },
    });
  });

  await openOutputSwitcher(page);

  await page.getByRole("tab", { name: "Plain text" }).click();
  const expected = "Grocery list\n\n- Fresh bread\n- Oats (https://example.com/oats)";
  await expect(page.getByLabel("Plain text")).toHaveText(expected);

  await openOutputSwitcher(page);

  await page.getByRole("button", { name: "Copy" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { onyxCopied?: string }).onyxCopied))
    .toBe(expected);
  await expect(page.getByText("Copied this note as plain text.")).toBeVisible();

  const download = page.waitForEvent("download");
  await openOutputSwitcher(page);
  await page.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("grocery-list.txt");
});

test("shows the formatted note in the output pane, copies it as rich text and downloads RTF", async ({
  page,
}) => {
  await page.goto("/");
  const markdown = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(markdown).toBeEnabled();
  await markdown.fill("# Meeting notes\n\nDecided on **Friday**.");
  await page.evaluate(() => {
    const state = window as typeof window & { onyxCopied?: Record<string, string> };
    Object.defineProperty(navigator, "clipboard", {
      value: {
        write: async (items: ClipboardItem[]) => {
          const copied: Record<string, string> = {};
          for (const type of items[0]!.types) {
            copied[type] = await (await items[0]!.getType(type)).text();
          }
          state.onyxCopied = copied;
        },
      },
    });
  });

  await openOutputSwitcher(page);

  await page.getByRole("tab", { name: "Rich text" }).click();
  const preview = page.getByLabel("Rich text");
  await expect(preview.locator("h1")).toHaveText("Meeting notes");
  await expect(preview.locator("strong")).toHaveText("Friday");

  await openOutputSwitcher(page);

  await page.getByRole("button", { name: "Copy" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { onyxCopied?: Record<string, string> }).onyxCopied,
      ),
    )
    .toEqual({
      "text/html": expect.stringContaining("<strong>Friday</strong>"),
      "text/plain": "Meeting notes\n\nDecided on Friday.",
    });

  const download = page.waitForEvent("download");
  await openOutputSwitcher(page);
  await page.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("meeting-notes.rtf");
});

test("shows the generated HTML in the output pane, copies and downloads it", async ({ page }) => {
  await page.goto("/");
  const markdown = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(markdown).toBeEnabled();
  await markdown.fill("# Release notes\n\nShipped **today**.");
  await page.evaluate(() => {
    const state = window as typeof window & { onyxCopied?: string };
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => void (state.onyxCopied = text) },
    });
  });

  await openOutputSwitcher(page);

  await page.getByRole("tab", { name: "HTML" }).click();
  const html = page.locator(".output-code");
  await expect(html).toContainText('<h1 id="user-content-release-notes">');
  await expect(html).toContainText("<strong>");

  await openOutputSwitcher(page);

  await page.getByRole("button", { name: "Copy" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { onyxCopied?: string }).onyxCopied))
    .toContain("<strong>today</strong>");
  await expect(page.getByText("Copied this note as HTML.")).toBeVisible();

  const download = page.waitForEvent("download");
  await openOutputSwitcher(page);
  await page.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("release-notes.html");

  await openOutputSwitcher(page);

  await page.getByRole("tab", { name: "Markdown" }).click();
  await expect(markdown).toHaveValue(/Release notes/);
});

test("previews the printed page and prints it from the output pane", async ({ page }) => {
  await page.goto("/");
  const markdown = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(markdown).toBeEnabled();
  await markdown.fill("# Field report\n\nEverything is in order.");
  await page.evaluate(() => {
    const state = window as typeof window & { onyxPrinted?: boolean };
    window.print = () => {
      state.onyxPrinted = true;
    };
  });

  await openOutputSwitcher(page);

  await page.getByRole("tab", { name: "PDF" }).click();
  const sheet = page.locator(".pdf-sheet");
  await expect(sheet.locator("h1")).toHaveText("Field report");
  await expect(page.getByRole("button", { name: "Copy" })).toBeDisabled();

  await openOutputSwitcher(page);

  await page.getByRole("button", { name: "Save as PDF" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { onyxPrinted?: boolean }).onyxPrinted),
    )
    .toBe(true);
});

test("customizes and persists keyboard shortcuts", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeEnabled();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await page.getByRole("button", { name: "Change Focus search shortcut" }).click();
  await page.keyboard.press("ControlOrMeta+Shift+Y");
  const shortcut = page.getByRole("button", { name: "Change Focus search shortcut" });
  const isMac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform));
  if (isMac) {
    await expect(shortcut.locator("kbd")).toHaveText(["⌘", "⇧", "Y"]);
    await expect(shortcut.locator(".shortcut-separator")).toHaveCount(0);
  } else {
    await expect(shortcut.locator("kbd")).toHaveText(["Ctrl", "Shift", "Y"]);
    await expect(shortcut.locator(".shortcut-separator")).toHaveText(["+", "+"]);
  }
  await page.getByRole("button", { name: "Close settings" }).click();

  await page.keyboard.press("ControlOrMeta+Shift+Y");
  await expect(page.getByPlaceholder("Search all notes")).toBeFocused();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+Shift+Y");
  await expect(page.getByPlaceholder("Search all notes")).toBeFocused();
});

test("binds a backup repository to the authenticated GitHub account", async ({ page }) => {
  let account = { id: 1, login: "octocat" };
  let repositoryChecks = 0;

  await mockGithubSession(page);
  await page.route("https://api.github.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          avatar_url: "https://example.com/avatar.png",
          id: account.id,
          login: account.login,
          name: account.login,
        }),
      });
    } else if (url.pathname === "/user/repos") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            default_branch: "main",
            name: "onyx-vault",
            owner: { login: "octocat" },
            permissions: { push: true },
            private: true,
          },
        ]),
      });
    } else if (url.pathname === "/repos/octocat/onyx-vault") {
      repositoryChecks += 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          default_branch: "main",
          name: "onyx-vault",
          owner: { login: "octocat" },
          permissions: { push: true },
          private: true,
        }),
      });
    } else {
      await route.abort();
    }
  });

  await page.goto("/");
  await expect(page.getByText("@octocat").first()).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sync repository", exact: true }).click();
  await page.getByLabel("Repository", { exact: true }).selectOption("octocat/onyx-vault");
  await page.getByRole("button", { name: "Use this repository" }).click();

  account = { id: 2, login: "hubot" };
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("@hubot").first()).toBeVisible();
  await page.getByRole("button", { name: "Back up now" }).click();

  await expect(
    page.getByRole("alert").getByText(/belongs to @octocat.*re-select.*@hubot/i),
  ).toBeVisible();
  expect(repositoryChecks).toBe(1);
});

test("refuses to upload a backup when its repository is public", async ({ page }) => {
  let writeRequests = 0;

  await mockGithubSession(page);
  await page.route("https://api.github.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") writeRequests += 1;
    if (url.pathname === "/user") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          avatar_url: "https://example.com/avatar.png",
          id: 1,
          login: "octocat",
          name: "Octo Cat",
        }),
      });
    } else if (url.pathname === "/user/repos") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            default_branch: "main",
            name: "onyx-vault",
            owner: { login: "octocat" },
            permissions: { push: true },
            private: true,
          },
        ]),
      });
    } else if (url.pathname === "/repos/octocat/onyx-vault") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          default_branch: "main",
          name: "onyx-vault",
          owner: { login: "octocat" },
          permissions: { push: true },
          private: false,
        }),
      });
    } else {
      await route.abort();
    }
  });

  await page.goto("/");
  await expect(page.getByText("@octocat").first()).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sync repository", exact: true }).click();
  await page.getByLabel("Repository", { exact: true }).selectOption("octocat/onyx-vault");
  await page.getByRole("button", { name: "Use this repository" }).click();

  await expect(
    page.getByRole("alert").getByText("Onyx refuses to back up to a public GitHub repository"),
  ).toBeVisible();
  expect(writeRequests).toBe(0);
});

test("imports a Markdown folder and exports its structure and attachments as ZIP", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeEnabled();
  await page.getByRole("tab", { name: "Tools" }).click();
  await page.getByRole("button", { name: "Turn on read-only" }).click();
  await page.getByRole("tab", { name: "Files" }).click();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import & export", exact: true }).click();
  await page.locator('input[type="file"][webkitdirectory]').evaluate((element) => {
    const input = element as HTMLInputElement;
    const transfer = new DataTransfer();
    const note = new File(
      ["# Trip plans\n\nThe walking route is in ![the map](assets/map.png)."],
      "plan.md",
      { type: "text/markdown" },
    );
    const attachment = new File(["attachment fixture"], "map.png", { type: "image/png" });
    Object.defineProperty(note, "webkitRelativePath", {
      value: "markdown-import/travel/plan.md",
    });
    Object.defineProperty(attachment, "webkitRelativePath", {
      value: "markdown-import/travel/assets/map.png",
    });
    transfer.items.add(note);
    transfer.items.add(attachment);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.getByText("Imported 1 note and 1 attachment.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Trip plans/ })).toBeVisible();
  await expect(page.locator('.preview-pane img[alt="the map"]')).toHaveAttribute("src", /^blob:/);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^onyx-markdown-\d{4}-\d{2}-\d{2}\.zip$/);
  await expect(page.getByText("Exported 3 files to ZIP.")).toBeVisible();
});

test("restores a selected GitHub commit into the local vault", async ({ page }) => {
  const commitSha = "a".repeat(40);
  const treeSha = "b".repeat(40);
  const noteBlobSha = "c".repeat(40);
  const attachmentBlobSha = "d".repeat(40);
  const manifestBlobSha = "e".repeat(40);
  const restoredAt = "2026-09-05T12:00:00Z";
  const markdown =
    "# Restored from GitHub\n\nThis note includes a ![restored image](assets/restored.png).";
  const manifest = JSON.stringify({
    version: 1,
    notes: [
      {
        id: "restored",
        title: "Restored from GitHub",
        path: "notes/restored.md",
        tags: [],
        createdAt: restoredAt,
        updatedAt: restoredAt,
        revision: 1,
        size: markdown.length,
        sourcePath: "journal/note.md",
      },
    ],
    attachments: [
      {
        id: "image",
        noteId: "restored",
        name: "restored.png",
        path: "attachments/restored/image",
        type: "image/png",
        size: 18,
        createdAt: restoredAt,
        updatedAt: restoredAt,
        sourcePath: "journal/assets/restored.png",
      },
    ],
  });
  const blobContents = new Map([
    [noteBlobSha, markdown],
    [attachmentBlobSha, "attachment fixture"],
    [manifestBlobSha, manifest],
  ]);

  await mockGithubSession(page);
  await page.route("https://api.github.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          avatar_url: "https://example.com/avatar.png",
          id: 1,
          login: "octocat",
          name: "Octo Cat",
        }),
      });
    } else if (url.pathname === "/repos/octocat/onyx-vault") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          default_branch: "main",
          name: "onyx-vault",
          owner: { login: "octocat" },
          permissions: { push: true },
          private: true,
        }),
      });
    } else if (url.pathname.endsWith("/commits")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            sha: commitSha,
            html_url: "https://github.com/octocat/onyx-vault/commit/test",
            author: { login: "octocat" },
            commit: {
              message: "Back up Onyx vault",
              author: { name: "Octo Cat", date: restoredAt },
              committer: { name: "Octo Cat", date: restoredAt },
            },
          },
        ]),
      });
    } else if (url.pathname.includes("/git/commits/")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          sha: commitSha,
          html_url: "https://github.com/octocat/onyx-vault/commit/test",
          tree: { sha: treeSha },
          author: { name: "Octo Cat", date: restoredAt },
          committer: { name: "Octo Cat", date: restoredAt },
        }),
      });
    } else if (url.pathname.includes("/git/trees/")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          sha: treeSha,
          tree: [
            { path: "vault/notes/restored.md", type: "blob", sha: noteBlobSha },
            {
              path: "vault/attachments/restored/image",
              type: "blob",
              sha: attachmentBlobSha,
            },
            { path: "vault/.onyx.json", type: "blob", sha: manifestBlobSha },
          ],
        }),
      });
    } else if (url.pathname.includes("/git/ref/heads/")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ object: { sha: commitSha } }),
      });
    } else if (url.pathname.includes("/git/blobs/")) {
      const contents = blobContents.get(url.pathname.slice(url.pathname.lastIndexOf("/") + 1));
      if (contents === undefined) {
        await route.abort();
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          sha: url.pathname.slice(url.pathname.lastIndexOf("/") + 1),
          encoding: "base64",
          content: btoa(contents),
        }),
      });
    } else {
      await route.abort();
    }
  });

  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(editor).toBeEnabled();
  await page.getByRole("tab", { name: "Tools" }).click();
  await page.getByRole("button", { name: "Turn on read-only" }).click();
  await blockNextVaultWrite(page);
  await editor.fill("# Unsynced restore draft");
  await page.keyboard.press("ControlOrMeta+S");
  await waitForBlockedVaultWrite(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sync status" }).click();
  await page.getByRole("button", { name: "Restore a commit" }).click();
  await expect(page.getByRole("dialog", { name: "Choose a backup commit" })).toBeHidden({
    timeout: 200,
  });
  await releaseVaultWrite(page);
  await expect(page.getByText("Back up Onyx vault")).toBeVisible();
  await expect(
    page.getByText(/pending changes? (?:has|have) not been backed up to GitHub/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore selected" }).click();
  await page.getByRole("button", { name: "Confirm restore" }).click();

  await expect(editor).toHaveValue(markdown);
  await expect(page.locator('.preview-pane img[alt="restored image"]')).toHaveAttribute(
    "src",
    /^blob:/,
  );
  await expect(page.getByText("Restored 1 note and 1 attachment from GitHub.")).toBeVisible();
});
