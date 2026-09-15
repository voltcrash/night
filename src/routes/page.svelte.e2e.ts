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

test("formats Markdown while editing in the page pane", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeEnabled();

  const line = page.getByRole("textbox", { name: "Markdown line 3" });
  await line.fill("Onyx renders **Markdown** while you keep writing.");
  await expect(line).toContainText("Onyx renders **Markdown** while you keep writing.");
  await expect(line.locator("strong")).toHaveText("Markdown");

  await line.fill("#");
  await expect(line).not.toHaveClass(/heading-1/);
  await line.press(" ");
  await expect(line).toHaveClass(/heading-1/);
  await expect(line.locator(".md-syntax")).toHaveText("# ");
  await line.pressSequentially("Inline heading");
  await expect(line).toContainText("# Inline heading");
});

test("can reveal the active Markdown line while editing the page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeEnabled();

  await page.getByRole("tab", { name: "Tools" }).click();
  const inlinePreview = page.getByRole("button", { name: "Inline preview" });
  await expect(inlinePreview).toHaveAttribute("aria-pressed", "false");
  await inlinePreview.click();
  await expect(inlinePreview).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Edit line 3" }).click();
  await expect(page.getByRole("textbox", { name: "Markdown line 3" })).toBeVisible();
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
