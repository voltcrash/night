import {
  ArrowLeftRight,
  CloudDownload,
  Code2,
  Columns2,
  Copy,
  CloudUpload,
  Download,
  FileArchive,
  FilePlus2,
  FileText,
  FolderInput,
  FolderOutput,
  HardDrive,
  Keyboard,
  Monitor,
  Moon,
  Pilcrow,
  PanelLeft,
  PanelLeftClose,
  Lock,
  PanelRightClose,
  Printer,
  Rows2,
  Save,
  Search,
  Settings,
  Sun,
  Type,
} from "@lucide/svelte";
import type {
  BackupState,
  GithubState,
  PaneEdge,
  PaneLayout,
  PaneOrder,
  RestoreState,
  SaveState,
  TransferState,
} from "$lib/components/app-types";
import { isOutputView, type OutputView } from "$lib/components/output-views";
import type { InlinePreviewBehavior, SettingsSection } from "$lib/components/settings-types";
import {
  renderMarkdown,
  renderMarkdownBlocks,
  resolveLocalAttachmentUrl,
  titleFromMarkdown,
  type LocalAttachmentUrl,
} from "$lib/markdown";
import {
  applyColorTheme,
  applyFontChoices,
  applyTheme,
  backupVaultToGithub,
  browserStorageWarnings,
  createMarkdownExport,
  createHtmlDocument,
  createMarkdownZip,
  createPrivateGithubRepository,
  createVaultDescriptor,
  defaultFontChoices,
  defaultKeyboardShortcuts,
  detectBrowserStorageSupport,
  detectPrimaryModifier,
  disconnectGithub,
  connectGithub,
  formatShortcut,
  GithubRequestError,
  importMarkdownFiles,
  listGithubBackupCommits,
  formatHtmlBlocks,
  formatHtmlSource,
  HTML_SOURCE_SEPARATOR,
  joinTextBlocks,
  PLAIN_TEXT_SEPARATOR,
  plainTextBlocks as notePlainTextBlocks,
  markdownToRtf,
  nextThemePreference,
  normalizeVaultName,
  outputFileName,
  persistenceDeniedMessage,
  readColorTheme,
  readFontChoices,
  readKeyboardShortcuts,
  readLocalStorage,
  readMarkdownFolder,
  isDefaultVault,
  readMarkdownZip,
  readThemePreference,
  readVaultRegistry,
  uniqueVaultName,
  restoreGithubSession,
  restoreVaultFromGithub,
  shortcutMatchesEvent,
  suggestedRepositoryName,
  validateGithubBackupRepository,
  Vault,
  vaultOptions,
  watchSystemTheme,
  writeKeyboardShortcuts,
  writeLocalStorage,
  writeMarkdownFolder,
  writeVaultRegistry,
  type ColorTheme,
  type FontChoices,
  type FontRole,
  type GithubBackupCommit,
  type GithubBackupState,
  type GithubUser,
  type KeyboardShortcut,
  type KeyboardShortcuts,
  type NoteMetadata,
  type PrimaryModifier,
  type ResolvedTheme,
  type ShortcutAction,
  type ThemePreference,
  type VaultChangeEvent,
  type VaultDescriptor,
  type VaultSearchResult,
} from "$lib";
import { onMount, tick } from "svelte";

const NOTE_PAGE_SIZE = 100;
const PREVIEW_DELAY_MS = 120;
const DEFAULT_CONTENT_WIDTH = 700;
// Matches the single-column breakpoint in the responsive stylesheet.
const NARROW_VIEWPORT = "(max-width: 900px)";

export function createPageController() {
  function createInitialMarkdown(primaryModifier: PrimaryModifier): string {
    const commandPaletteShortcut = primaryModifier === "meta" ? "⌘ K" : "Ctrl + K";
    const saveShortcut = primaryModifier === "meta" ? "⌘ S" : "Ctrl + S";
    const previewShortcut = primaryModifier === "meta" ? "⌘ ⇧ P" : "Ctrl + Shift + P";
    return `# Welcome to Onyx

Onyx is a quiet place to think in Markdown. Your work stays on this device and saves automatically as you write.

## Find anything quickly

Create as many notes as you need. Search checks every title and every word, while the index stays on this device.

> Good tools disappear into the work.

### Today’s notes

- [x] Open a fresh page
- [ ] Capture the next idea
- [ ] Shape it into something useful

Onyx starts in private browser storage (OPFS) without an account. In browsers that support choosing persistent folders, you can mirror this vault to one from **Settings → Storage choices**. GitHub sign-in is optional and only enables backup and cross-device restore.

Press \`${commandPaletteShortcut}\` for the command palette, \`${saveShortcut}\` to save now, or \`${previewShortcut}\` to toggle preview. Press \`?\` for every shortcut.`;
  }

  const initialMarkdown = createInitialMarkdown("meta");

  let vault = $state<Vault>();
  let vaults = $state<VaultDescriptor[]>([]);
  let activeVaultId = $state("");
  let activeNoteId = $state("");
  let noteRevision = $state(0);
  let markdown = $state(initialMarkdown);
  let previewMarkdown = $state(initialMarkdown);
  let lastSavedMarkdown = $state(initialMarkdown);
  let results = $state<VaultSearchResult[]>([]);
  let notePage = $state(0);
  let searchQuery = $state("");
  let singlePaneMode = $state(false);
  let outputPaneVisible = $state(true);
  let renderedPaneVisible = $state(true);
  let renderedReadOnly = $state(false);
  let outputView = $state<OutputView>("markdown");
  let paneLayout = $state<PaneLayout>("columns");
  let paneOrder = $state<PaneOrder>("rendered-first");
  let splitRatio = $state(50);
  let contentWidth = $state(DEFAULT_CONTENT_WIDTH);
  let editingSurface: "source" | "rendered" = "source";
  let saveState = $state<SaveState>("loading");
  let notesLoaded = $state(false);
  let saveTimer: number | undefined = $state();
  let saveRun: Promise<boolean> | undefined;
  let saveRequested = false;
  let searchTimer: number | undefined = $state();
  let previewTimer: number | undefined = $state();
  let searchSequence = 0;
  let editor: HTMLTextAreaElement | undefined = $state();
  let liveEditor: HTMLTextAreaElement | undefined = $state();
  let liveEditorContainer: HTMLDivElement | undefined = $state();
  let liveLine = $state(0);
  let inlinePreviewBehavior = $state<InlinePreviewBehavior>("rendered");
  let searchInput: HTMLInputElement | undefined = $state();
  let sidebarOpen = $state(false);
  let storageError = $state("");
  let storageNotice = $state("");
  let isOnline = $state(true);
  let githubUser = $state<GithubUser>();
  let githubState = $state<GithubState>("disconnected");
  let githubMessage = $state("");
  let githubBackup = $state<GithubBackupState>();
  let backupState = $state<BackupState>("idle");
  let backupMessage = $state("");
  let backupCommitUrl = $state("");
  let settingsOpen = $state(false);
  let settingsSection = $state<SettingsSection>("storage");
  let pendingBackupCount = $state(0);
  let restoreModalOpen = $state(false);
  let restoreState = $state<RestoreState>("idle");
  let restoreMessage = $state("");
  let restoreCommits = $state<GithubBackupCommit[]>([]);
  let selectedRestoreSha = $state("");
  let restoreOwner = $state("");
  let restoreRepository = $state("onyx-vault");
  let restoreBranch = $state("main");
  let restoreDirectory = $state("vault");
  let transferState = $state<TransferState>("idle");
  let transferMessage = $state("");
  let folderInput: HTMLInputElement | undefined = $state();
  let zipInput: HTMLInputElement | undefined = $state();
  let theme = $state<ThemePreference>("system");
  let resolvedTheme = $state<ResolvedTheme>("light");
  let colorTheme = $state<ColorTheme>("ember");
  let fonts = $state<FontChoices>({ ...defaultFontChoices });
  let paletteOpen = $state(false);
  let paletteNotes = $state<NoteMetadata[]>([]);
  let sidebarCollapsed = $state(false);
  let shortcuts = $state<KeyboardShortcuts>(structuredClone(defaultKeyboardShortcuts));
  let primaryModifier = $state<PrimaryModifier>("meta");
  let noteList: HTMLElement | undefined = $state();
  let activeNoteSourcePath: string | undefined = $state();
  let localAttachmentUrls = $state<LocalAttachmentUrl[]>([]);
  let unsubscribeVault: (() => void) | undefined;
  let remoteSyncRun: Promise<void> | undefined;
  let remoteSyncRequested = false;
  const remoteChanges: VaultChangeEvent[] = [];
  let noteLoadSequence = 0;
  let clearingVault = false;
  const liveRenderCache = new Map<string, string>();

  const activeVault = $derived(
    vaults.find((candidate) => candidate.id === activeVaultId) ?? vaults[0],
  );
  const wordCount = $derived(markdown.trim() ? markdown.trim().split(/\s+/).length : 0);
  const readingMinutes = $derived(Math.max(1, Math.ceil(wordCount / 220)));
  const renderedBlocks = $derived(renderMarkdownBlocks(previewMarkdown, resolveAttachmentUrl));
  const renderedMarkdown = $derived(renderedBlocks.map((block) => block.html).join(""));
  const renderedBlockLines = $derived(
    renderedBlocks.filter((block) => block.element).map((block) => block.lines),
  );
  const plainTextBlocks = $derived(notePlainTextBlocks(markdown));
  const plainText = $derived(joinTextBlocks(plainTextBlocks, PLAIN_TEXT_SEPARATOR));
  const htmlSourceBlocks = $derived(formatHtmlBlocks(renderedBlocks));
  const htmlSource = $derived(joinTextBlocks(htmlSourceBlocks, HTML_SOURCE_SEPARATOR));
  const noteTitle = $derived(titleFromMarkdown(markdown));
  const markdownLines = $derived(markdown.split("\n"));
  const liveCodeLines = $derived.by(() => {
    let fence = "";
    return markdownLines.map((line) => {
      const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1] ?? "";
      const closesFence = Boolean(fence && marker.startsWith(fence));
      const codeLine = Boolean(fence || marker);
      if (!fence && marker) fence = marker;
      else if (closesFence) fence = "";
      return codeLine;
    });
  });
  const notePageCount = $derived(Math.max(1, Math.ceil(results.length / NOTE_PAGE_SIZE)));
  const visibleResults = $derived(
    results.slice(notePage * NOTE_PAGE_SIZE, (notePage + 1) * NOTE_PAGE_SIZE),
  );
  const hasContent = $derived(markdown.trim().length > 0);
  // Narrow viewports show one pane at a time, where neither arrangement is visible.
  const effectivePaneLayout = $derived<PaneLayout>(singlePaneMode ? "columns" : paneLayout);

  const paletteItems = $derived([
    ...paletteNotes.map((note) => ({
      id: `note-${note.id}`,
      group: "Notes",
      label: note.title,
      hint: note.id === activeNoteId ? "Open note" : formatNoteDate(note.updatedAt),
      icon: FileText,
      keywords: "note open jump",
      run: () => void selectNote(note.id),
    })),
    {
      id: "new-note",
      group: "Actions",
      label: "New note",
      shortcut: shortcutLabel("newNote"),
      icon: FilePlus2,
      keywords: "create add page",
      disabled: transferState === "working",
      run: () => void createNote(),
    },
    {
      id: "save",
      group: "Actions",
      label: "Save note",
      shortcut: shortcutLabel("saveNote"),
      icon: Save,
      keywords: "write store",
      disabled: saveState === "saving" || transferState === "working",
      run: () => void saveDraft(),
    },
    {
      id: "search",
      group: "Actions",
      label: "Search all notes",
      shortcut: shortcutLabel("searchNotes"),
      icon: Search,
      keywords: "find full text",
      run: () => focusSearch(),
    },
    {
      id: "toggle-output-pane",
      group: "View",
      label: outputPaneVisible ? "Hide output pane" : "Show output pane",
      icon: PanelLeftClose,
      keywords: "write markdown source output left pane",
      disabled: !singlePaneMode && outputPaneVisible && !renderedPaneVisible,
      run: () => toggleOutputPane(),
    },
    {
      id: "toggle-rendered-pane",
      group: "View",
      label: renderedPaneVisible ? "Hide page pane" : "Show page pane",
      shortcut: shortcutLabel("togglePreview"),
      icon: PanelRightClose,
      keywords: "page preview right pane",
      disabled: !singlePaneMode && renderedPaneVisible && !outputPaneVisible,
      run: () => toggleRenderedPane(),
    },
    {
      id: "swap-panes",
      group: "View",
      label: "Swap the pane positions",
      icon: ArrowLeftRight,
      keywords: "move switch sides order panes",
      disabled: singlePaneMode,
      run: () => swapPanes(),
    },
    {
      id: "toggle-pane-layout",
      group: "View",
      label: effectivePaneLayout === "rows" ? "Place the panes side by side" : "Stack the panes",
      icon: effectivePaneLayout === "rows" ? Columns2 : Rows2,
      keywords: "split horizontal vertical stack columns rows layout",
      disabled: singlePaneMode,
      run: () => togglePaneLayout(),
    },
    {
      id: "toggle-read-only",
      group: "View",
      label: renderedReadOnly ? "Enable page editing" : "Turn on read-only",
      icon: Lock,
      keywords: "lock unlock edit read only page",
      disabled: !renderedPaneVisible,
      run: () => toggleRenderedReadOnly(),
    },
    {
      id: "toggle-sidebar",
      group: "View",
      label: sidebarCollapsed ? "Show the notes sidebar" : "Hide the notes sidebar",
      shortcut: shortcutLabel("toggleSidebar"),
      icon: PanelLeft,
      keywords: "panel files list",
      run: () => toggleSidebar(),
    },
    {
      id: "theme-light",
      group: "Themes",
      label: "Use light mode",
      icon: Sun,
      keywords: "bright day colour color theme",
      disabled: theme === "light",
      run: () => setTheme("light"),
    },
    {
      id: "theme-dark",
      group: "Themes",
      label: "Use dark mode",
      icon: Moon,
      keywords: "night colour color theme",
      disabled: theme === "dark",
      run: () => setTheme("dark"),
    },
    {
      id: "theme-system",
      group: "Themes",
      label: "Use system mode",
      icon: Monitor,
      keywords: "automatic os operating system colour color theme",
      disabled: theme === "system",
      run: () => setTheme("system"),
    },
    {
      id: "backup",
      group: "Backup & sync",
      label: "Back up for cross-device sync",
      icon: CloudUpload,
      keywords: "commit push sync",
      disabled: !isOnline || githubState !== "connected",
      run: () => void beginBackup(),
    },
    {
      id: "restore",
      group: "Backup & sync",
      label: "Restore from a GitHub commit",
      icon: CloudDownload,
      keywords: "download history rollback",
      disabled: !isOnline || githubState !== "connected",
      run: () => void openRestore(),
    },
    {
      id: "import-folder",
      group: "Transfer",
      label: "Import a Markdown folder",
      icon: FolderInput,
      keywords: "open files load",
      run: () => folderInput?.click(),
    },
    {
      id: "import-zip",
      group: "Transfer",
      label: "Import a ZIP archive",
      icon: FileArchive,
      keywords: "open files load",
      run: () => zipInput?.click(),
    },
    {
      id: "export-folder",
      group: "Transfer",
      label: "Export to a folder",
      icon: FolderOutput,
      keywords: "save files write",
      run: () => void exportFolder(),
    },
    {
      id: "copy-markdown",
      group: "Transfer",
      label: "Copy this note as Markdown",
      icon: Copy,
      keywords: "clipboard markdown md source",
      disabled: !hasContent,
      run: () => void copyMarkdown(),
    },
    {
      id: "download-markdown",
      group: "Transfer",
      label: "Download this note as Markdown",
      icon: FileText,
      keywords: "export markdown md save",
      disabled: !hasContent,
      run: () => downloadMarkdown(),
    },
    {
      id: "copy-text",
      group: "Transfer",
      label: "Copy this note as plain text",
      icon: Copy,
      keywords: "clipboard plain text txt",
      disabled: !hasContent,
      run: () => void copyText(),
    },
    {
      id: "download-text",
      group: "Transfer",
      label: "Download this note as plain text",
      icon: Type,
      keywords: "export plain text txt save",
      disabled: !hasContent,
      run: () => downloadText(),
    },
    {
      id: "copy-rich-text",
      group: "Transfer",
      label: "Copy this note as rich text",
      icon: Copy,
      keywords: "clipboard formatted rich text document email paste",
      disabled: !hasContent,
      run: () => void copyRichText(),
    },
    {
      id: "download-rtf",
      group: "Transfer",
      label: "Download this note as rich text",
      icon: Pilcrow,
      keywords: "export rtf rich text word document save",
      disabled: !hasContent,
      run: () => downloadRtf(),
    },
    {
      id: "copy-html",
      group: "Transfer",
      label: "Copy this note as HTML",
      icon: Copy,
      keywords: "clipboard html web source",
      disabled: !hasContent,
      run: () => void copyHtml(),
    },
    {
      id: "download-html",
      group: "Transfer",
      label: "Download this note as HTML",
      icon: Code2,
      keywords: "export html web page save",
      disabled: !hasContent,
      run: () => downloadHtml(),
    },
    {
      id: "save-pdf",
      group: "Transfer",
      label: "Save this note as a PDF",
      icon: Printer,
      keywords: "print export pdf paper",
      disabled: !hasContent,
      run: () => savePdf(),
    },
    {
      id: "export-zip",
      group: "Transfer",
      label: "Export a ZIP archive",
      icon: Download,
      keywords: "save download backup",
      run: () => void exportZip(),
    },
    {
      id: "settings",
      group: "Onyx",
      label: "Open settings",
      icon: Settings,
      keywords: "preferences options github storage themes",
      run: () => openSettings("storage"),
    },
    {
      id: "storage",
      group: "Onyx",
      label: "Review storage choices",
      icon: HardDrive,
      keywords: "space quota usage persistent",
      run: () => openSettings("storage"),
    },
    {
      id: "shortcuts",
      group: "Onyx",
      label: "Keyboard shortcuts",
      shortcut: shortcutLabel("openShortcuts"),
      icon: Keyboard,
      keywords: "help keys reference",
      run: () => openSettings("shortcuts"),
    },
  ]);

  onMount(() => {
    const registry = readVaultRegistry();
    vaults = registry.vaults;
    activeVaultId = registry.activeId;
    primaryModifier = detectPrimaryModifier();
    if (primaryModifier === "control" && markdown === initialMarkdown) {
      markdown = createInitialMarkdown(primaryModifier);
      previewMarkdown = markdown;
      lastSavedMarkdown = markdown;
    }
    isOnline = navigator.onLine;
    const storageSupport = detectBrowserStorageSupport();
    storageNotice = browserStorageWarnings(storageSupport).join(" ");
    inlinePreviewBehavior =
      readLocalStorage("onyx:inline-preview-behavior") === "source-line"
        ? "source-line"
        : "rendered";
    const narrowQuery = globalThis.matchMedia?.(NARROW_VIEWPORT);
    singlePaneMode = narrowQuery?.matches === true;
    applyPanePreferences();
    const onViewportChange = (event: MediaQueryListEvent) => {
      singlePaneMode = event.matches;
      applyPanePreferences();
    };
    narrowQuery?.addEventListener("change", onViewportChange);
    const storedSplit = Number(readLocalStorage("onyx:split-ratio"));
    if (Number.isFinite(storedSplit)) splitRatio = clampSplitRatio(storedSplit);
    const storedContentWidth = Number(readLocalStorage("onyx:content-width"));
    if (Number.isFinite(storedContentWidth)) contentWidth = clampContentWidth(storedContentWidth);
    shortcuts = readKeyboardShortcuts();
    theme = readThemePreference();
    resolvedTheme = applyTheme(theme);
    colorTheme = readColorTheme();
    applyColorTheme(colorTheme);
    fonts = readFontChoices();
    applyFontChoices(fonts);
    const stopThemeWatch = watchSystemTheme(() => {
      if (theme === "system") resolvedTheme = applyTheme(theme);
    });
    void openVault().finally(() => registerServiceWorker());
    if (isOnline) void restoreGitHub();
    else githubState = "disconnected";
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (markdown === lastSavedMarkdown) return;
      event.preventDefault();
    };
    const onKeydown = (event: KeyboardEvent) => handleShortcut(event);
    const onOnline = () => {
      isOnline = true;
      void restoreGitHub();
    };
    const onOffline = () => {
      isOnline = false;
      restoreModalOpen = false;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden" && markdown !== lastSavedMarkdown) void saveDraft();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      narrowQuery?.removeEventListener("change", onViewportChange);
      stopThemeWatch();
      if (saveTimer) window.clearTimeout(saveTimer);
      if (searchTimer) window.clearTimeout(searchTimer);
      if (previewTimer) window.clearTimeout(previewTimer);
      unsubscribeVault?.();
      releaseLocalAttachmentUrls();
      vault?.close();
    };
  });

  function registerServiceWorker(): void {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/service-worker.js").catch(() => undefined);
    }
  }

  async function restoreGitHub(): Promise<void> {
    const result = new URLSearchParams(location.search).get("github");
    if (result) history.replaceState(history.state, "", location.pathname + location.hash);
    if (result && result !== "connected") {
      githubMessage =
        result === "configuration"
          ? "GitHub authentication has not been configured for this deployment."
          : result === "denied"
            ? "GitHub authorization was cancelled."
            : result === "invalid"
              ? "The GitHub authorization response could not be verified. Please try again."
              : "GitHub authentication failed. Please try again.";
    }
    if (!isOnline) {
      githubState = githubUser ? "connected" : "disconnected";
      return;
    }
    githubState = "loading";
    try {
      githubUser = await restoreGithubSession();
      githubState = githubUser ? "connected" : githubMessage ? "error" : "disconnected";
    } catch (error) {
      githubState = "error";
      githubMessage = error instanceof Error ? error.message : "GitHub authentication failed.";
    }
  }

  async function disconnectGitHub(): Promise<void> {
    if (!isOnline) return;
    try {
      await disconnectGithub();
      githubUser = undefined;
      githubState = "disconnected";
      githubMessage = "";
    } catch (error) {
      githubState = "error";
      githubMessage = error instanceof Error ? error.message : "GitHub could not be disconnected.";
    }
  }

  async function connectGitHub(): Promise<void> {
    if (!isOnline || githubState === "loading") return;
    githubState = "loading";
    githubMessage = "";
    try {
      await connectGithub();
    } catch (error) {
      githubState = "error";
      githubMessage =
        error instanceof Error ? error.message : "GitHub sign-in could not be started.";
    }
  }

  async function beginBackup(): Promise<void> {
    if (!isOnline || !vault || backupState === "backing-up") return;
    if (markdown !== lastSavedMarkdown && !(await saveDraft())) return;
    if (!githubBackup) {
      openSettings("repository");
      return;
    }
    await runBackup(githubBackup);
  }

  function openSettings(target: SettingsSection = "storage"): void {
    settingsSection = target;
    settingsOpen = true;
  }

  async function selectBackupRepository(
    state: Omit<GithubBackupState, "updatedAt">,
  ): Promise<void> {
    if (!vault) return;
    try {
      await validateGithubBackupRepository({ ...state, updatedAt: new Date().toISOString() });
      await vault.saveGithubBackupState(state);
      githubBackup = await vault.getGithubBackupState();
      backupState = "idle";
      backupCommitUrl = "";
      backupMessage = `Backups now target ${state.owner}/${state.repository}.`;
      settingsSection = "backup";
    } catch (error) {
      showBackupError(error);
    }
  }

  async function forgetBackupRepository(): Promise<void> {
    if (!vault) return;
    try {
      await vault.clearGithubBackupState();
      githubBackup = undefined;
      backupCommitUrl = "";
      backupState = "idle";
      backupMessage = "Onyx is no longer backing up to a repository.";
    } catch (error) {
      showBackupError(error);
    }
  }

  async function clearVault(): Promise<void> {
    if (!vault || clearingVault) return;
    clearingVault = true;
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = undefined;
    saveRequested = false;
    const pendingSave = saveRun;
    try {
      if (pendingSave) await pendingSave;
      await vault.clear();
      resetEditorAfterVaultClear();
      await runSearch("");
      pendingBackupCount = (await vault.getPendingBackupOperations()).length;
    } finally {
      clearingVault = false;
    }
  }

  async function prepareVaultDeletion(): Promise<boolean> {
    return settleDraft();
  }

  function resetEditorAfterVaultClear(): void {
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = undefined;
    searchSequence += 1;
    noteLoadSequence += 1;
    searchQuery = "";
    notePage = 0;
    results = [];
    paletteNotes = [];
    activeNoteId = "";
    noteRevision = 0;
    activeNoteSourcePath = undefined;
    releaseLocalAttachmentUrls();
    liveRenderCache.clear();
    markdown = "";
    lastSavedMarkdown = "";
    liveLine = 0;
    updatePreviewImmediately("");
    saveState = "saved";
    storageError = "";
  }

  async function createBackupRepository(name: string): Promise<void> {
    if (!isOnline || !vault || !name.trim()) return;
    backupState = "backing-up";
    backupMessage = "Creating your private repository…";
    settingsOpen = false;
    try {
      const configuration = await createPrivateGithubRepository(name);
      await vault.saveGithubBackupState(configuration);
      githubBackup = configuration;
      await runBackup(configuration);
    } catch (error) {
      showBackupError(error);
    }
  }

  async function runBackup(configuration: GithubBackupState): Promise<void> {
    if (!isOnline || !vault) return;
    backupState = "backing-up";
    backupMessage = "Preparing one GitHub commit…";
    backupCommitUrl = "";
    try {
      const result = await backupVaultToGithub(vault, configuration);
      githubBackup = result.state;
      pendingBackupCount = (await vault.getPendingBackupOperations()).length;
      backupState = "success";
      backupCommitUrl = result.commitUrl ?? "";
      backupMessage = result.commitUrl
        ? `Backed up ${result.fileCount} ${result.fileCount === 1 ? "file" : "files"} in one commit.`
        : "Your GitHub backup is already up to date.";
    } catch (error) {
      showBackupError(error);
    }
  }

  function showBackupError(error: unknown): void {
    backupState = "error";
    backupMessage =
      error instanceof GithubRequestError && error.status === 422
        ? "GitHub could not create that repository or update its branch. Check the name and try again."
        : error instanceof Error
          ? error.message
          : "The GitHub backup failed.";
  }

  async function openRestore(): Promise<void> {
    if (!isOnline || !githubUser || restoreState === "restoring") return;
    if (!(await settleDraft())) return;
    restoreOwner = githubBackup?.owner ?? githubUser.login;
    restoreRepository = githubBackup?.repository ?? suggestedRepositoryName(activeVault);
    restoreBranch = githubBackup?.branch ?? "main";
    restoreDirectory = githubBackup?.directory ?? "vault";
    restoreCommits = [];
    selectedRestoreSha = "";
    restoreMessage = "";
    restoreModalOpen = true;
    await loadRestoreCommits();
  }

  function restoreConfiguration(): GithubBackupState {
    if (!githubUser) throw new Error("Sign in with GitHub before restoring a backup");
    return {
      githubAccountId: githubUser.id,
      githubAccountLogin: githubUser.login,
      owner: restoreOwner.trim(),
      repository: restoreRepository.trim(),
      branch: restoreBranch.trim(),
      directory: restoreDirectory.trim().replace(/^\/+|\/+$/g, ""),
      updatedAt: new Date().toISOString(),
    };
  }

  async function loadRestoreCommits(): Promise<void> {
    if (!isOnline || !restoreOwner.trim() || !restoreRepository.trim() || !restoreBranch.trim())
      return;
    restoreState = "loading";
    restoreMessage = "";
    selectedRestoreSha = "";
    try {
      restoreCommits = await listGithubBackupCommits(restoreConfiguration());
      selectedRestoreSha = restoreCommits[0]?.sha ?? "";
      restoreMessage =
        restoreCommits.length === 0
          ? "No backup commits were found in this repository and directory."
          : "";
      restoreState = "idle";
    } catch (error) {
      restoreCommits = [];
      restoreState = "error";
      restoreMessage =
        error instanceof Error ? error.message : "GitHub backups could not be loaded.";
    }
  }

  async function restoreSelectedCommit(): Promise<void> {
    if (!isOnline || !vault || !selectedRestoreSha || restoreState === "restoring") return;
    if (!(await settleDraft())) return;
    const previousSaveState = saveState;
    if (saveTimer) window.clearTimeout(saveTimer);
    if (searchTimer) window.clearTimeout(searchTimer);
    saveTimer = undefined;
    searchTimer = undefined;
    searchSequence += 1;
    saveState = "loading";
    restoreState = "restoring";
    restoreMessage = "Downloading and rebuilding your local vault…";
    try {
      const result = await restoreVaultFromGithub(
        vault,
        restoreConfiguration(),
        selectedRestoreSha,
      );
      githubBackup = result.state;
      pendingBackupCount = (await vault.getPendingBackupOperations()).length;
      const notes = await vault.listNotes();
      searchQuery = "";
      await loadNote(notes[0].id);
      await runSearch("");
      restoreModalOpen = false;
      restoreState = "idle";
      backupState = "success";
      backupMessage = `Restored ${result.noteCount} ${result.noteCount === 1 ? "note" : "notes"} and ${result.attachmentCount} ${result.attachmentCount === 1 ? "attachment" : "attachments"} from GitHub.`;
      backupCommitUrl =
        restoreCommits.find((commit) => commit.sha === selectedRestoreSha)?.url ?? "";
    } catch (error) {
      saveState = previousSaveState;
      restoreState = "error";
      restoreMessage =
        error instanceof Error ? error.message : "The GitHub backup could not be restored.";
    }
  }

  function formatNoteDate(value: string): string {
    if (!value) return "";
    return `Edited ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value))}`;
  }

  function formatCommitDate(value: string): string {
    if (!value) return "Unknown date";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );
  }

  async function openVault(): Promise<void> {
    storageError = "";
    saveState = "loading";
    notesLoaded = false;
    try {
      vault = await Vault.open(activeVault ? vaultOptions(activeVault) : {});
      appendNativeDirectoryNotice();
      unsubscribeVault?.();
      unsubscribeVault = vault.subscribe(queueRemoteVaultSync);
      let notes = await vault.listNotes();
      if (notes.length === 0) {
        const legacyDraft =
          activeVault && isDefaultVault(activeVault) ? await readLegacyDraft() : "";
        const contents = legacyDraft || createInitialMarkdown(primaryModifier);
        const firstNote = await vault.saveNote({
          title: titleFromMarkdown(contents),
          markdown: contents,
        });
        notes = [firstNote];
      }
      await loadNote(notes[0].id);
      await runSearch("");
      githubBackup = await vault.getGithubBackupState();
      pendingBackupCount = (await vault.getPendingBackupOperations()).length;
      if (detectBrowserStorageSupport().persistentStorage) void ensurePersistentStorage();
    } catch (error) {
      storageError = error instanceof Error ? error.message : "Your notes could not be opened.";
      saveState = "error";
    }
  }

  function persistVaultRegistry(): void {
    writeVaultRegistry({ activeId: activeVaultId, vaults });
  }

  async function selectVault(id: string): Promise<void> {
    if (id === activeVaultId || transferState === "working") return;
    if (!vaults.some((candidate) => candidate.id === id)) return;
    if (!(await settleDraft())) return;
    activeVaultId = id;
    persistVaultRegistry();
    await reopenVault();
  }

  async function createVault(name = "Notes"): Promise<void> {
    if (transferState === "working") return;
    if (!(await settleDraft())) return;
    const descriptor = createVaultDescriptor(name, vaults);
    vaults = [...vaults, descriptor];
    activeVaultId = descriptor.id;
    persistVaultRegistry();
    await reopenVault();
  }

  function renameVault(id: string, name: string): void {
    const target = vaults.find((candidate) => candidate.id === id);
    const trimmed = normalizeVaultName(name);
    if (!target || !trimmed || trimmed === target.name) return;
    const unique = uniqueVaultName(
      trimmed,
      vaults.filter((candidate) => candidate.id !== id),
    );
    vaults = vaults.map((candidate) =>
      candidate.id === id ? { ...candidate, name: unique } : candidate,
    );
    persistVaultRegistry();
  }

  async function reopenVault(): Promise<void> {
    unsubscribeVault?.();
    unsubscribeVault = undefined;
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = undefined;
    saveRequested = false;
    remoteChanges.length = 0;
    remoteSyncRequested = false;
    vault?.close();
    vault = undefined;
    resetEditorAfterVaultClear();
    githubBackup = undefined;
    pendingBackupCount = 0;
    backupState = "idle";
    backupMessage = "";
    backupCommitUrl = "";
    sidebarOpen = false;
    await openVault();
  }

  async function ensurePersistentStorage(): Promise<void> {
    if (!vault || (await vault.isStoragePersistent())) return;
    if (await vault.requestPersistentStorage()) return;
    appendStorageNotice(persistenceDeniedMessage());
  }

  // Not persisted, so the warning returns on the next load if storage is still not durable.
  function dismissStorageNotice(): void {
    storageNotice = "";
  }

  function appendStorageNotice(message: string): void {
    if (storageNotice.includes(message)) return;
    storageNotice = storageNotice ? `${storageNotice} ${message}` : message;
  }

  function appendNativeDirectoryNotice(): void {
    const status = vault?.getFileStorageStatus();
    if (!status?.nativeDirectoryName || status.nativeDirectoryPermission === "granted") return;
    appendStorageNotice(
      status.nativeDirectoryPermission === "error"
        ? `${status.nativeDirectoryName} could not be updated. Onyx is using OPFS until you reconnect the folder in Settings → Storage.`
        : `Access to ${status.nativeDirectoryName} expired or was revoked. Onyx is using OPFS until you reconnect the folder in Settings → Storage.`,
    );
  }

  async function readLegacyDraft(): Promise<string> {
    try {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle("onyx");
      const handle = await directory.getFileHandle("welcome-to-onyx.md");
      return await (await handle.getFile()).text();
    } catch {
      return "";
    }
  }

  async function loadNote(id: string): Promise<void> {
    if (!vault) return;
    const currentVault = vault;
    const sequence = ++noteLoadSequence;
    const note = await currentVault.getNote(id);
    if (!note) return;
    const attachments = await Promise.all(
      (await currentVault.listAttachments(note.id)).map((attachment) =>
        currentVault.getAttachment(attachment.id),
      ),
    );
    const nextUrls = attachments.flatMap((attachment): LocalAttachmentUrl[] =>
      attachment
        ? [
            {
              name: attachment.metadata.name,
              sourcePath: attachment.metadata.sourcePath,
              url: URL.createObjectURL(attachment.file),
            },
          ]
        : [],
    );
    if (sequence !== noteLoadSequence) {
      for (const attachment of nextUrls) URL.revokeObjectURL(attachment.url);
      return;
    }
    releaseLocalAttachmentUrls();
    localAttachmentUrls = nextUrls;
    liveRenderCache.clear();
    activeNoteSourcePath = note.sourcePath;
    activeNoteId = note.id;
    noteRevision = note.revision;
    markdown = note.markdown;
    updatePreviewImmediately(note.markdown);
    lastSavedMarkdown = note.markdown;
    saveState = "saved";
    storageError = "";
    sidebarOpen = false;
  }

  function queueRemoteVaultSync(change: VaultChangeEvent): void {
    remoteChanges.push(change);
    remoteSyncRequested = true;
    if (remoteSyncRun) return;
    const run = syncRemoteVault();
    remoteSyncRun = run;
    void run
      .finally(() => {
        if (remoteSyncRun === run) remoteSyncRun = undefined;
      })
      .catch(() => undefined);
  }

  async function syncRemoteVault(): Promise<void> {
    while (remoteSyncRequested) {
      remoteSyncRequested = false;
      const changes = remoteChanges.splice(0);
      if (!vault) continue;
      const notes = await vault.listNotes();
      const activeChanged = changes.some(
        (change) => change.kind === "vault" || change.noteId === activeNoteId,
      );
      const hasUnsavedDraft = markdown !== lastSavedMarkdown;
      if (activeChanged && hasUnsavedDraft) {
        storageError = "This note changed in another tab. Reload it before saving.";
        saveState = "error";
      } else if (activeChanged && activeNoteId) {
        const activeNote = notes.find((note) => note.id === activeNoteId);
        if (activeNote) await loadNote(activeNote.id);
        else resetActiveNote();
      } else if (!activeNoteId && notes[0]) {
        await loadNote(notes[0].id);
      } else if (!notes.length && !hasUnsavedDraft) {
        resetActiveNote();
      }
      await runSearch(searchQuery);
      paletteNotes = notes;
      githubBackup = await vault.getGithubBackupState();
      pendingBackupCount = (await vault.getPendingBackupOperations()).length;
    }
  }

  function resetActiveNote(): void {
    noteLoadSequence += 1;
    releaseLocalAttachmentUrls();
    activeNoteSourcePath = undefined;
    activeNoteId = "";
    noteRevision = 0;
    markdown = "";
    previewMarkdown = "";
    lastSavedMarkdown = "";
    saveState = "saved";
  }

  function resolveAttachmentUrl(destination: string): string | undefined {
    return resolveLocalAttachmentUrl(destination, activeNoteSourcePath, localAttachmentUrls);
  }

  function releaseLocalAttachmentUrls(): void {
    for (const attachment of localAttachmentUrls) URL.revokeObjectURL(attachment.url);
    localAttachmentUrls = [];
  }

  async function selectNote(id: string): Promise<void> {
    if (id === activeNoteId || transferState === "working") return;
    if (markdown !== lastSavedMarkdown && !(await saveDraft())) return;
    await loadNote(id);
  }

  async function createNote(): Promise<void> {
    if (!vault || transferState === "working") return;
    saveState = "loading";
    if (markdown !== lastSavedMarkdown && !(await saveDraft())) return;
    try {
      const note = await vault.saveNote({ title: "Untitled", markdown: "" });
      searchQuery = "";
      await loadNote(note.id);
      await runSearch("");
      requestAnimationFrame(() => editor?.focus());
    } catch (error) {
      storageError = error instanceof Error ? error.message : "A new note could not be created.";
      saveState = "error";
    }
  }

  async function importFolder(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    await runImport(readMarkdownFolder(files));
    if (folderInput) folderInput.value = "";
  }

  async function importZip(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) return;
    transferState = "working";
    transferMessage = "Reading ZIP archive…";
    try {
      const entries = await readMarkdownZip(file);
      transferState = "idle";
      await runImport(entries);
    } catch (error) {
      showTransferError(error, "The ZIP archive could not be imported.");
    } finally {
      if (zipInput) zipInput.value = "";
    }
  }

  async function runImport(files: ReturnType<typeof readMarkdownFolder>): Promise<void> {
    if (!vault || transferState === "working") return;
    transferState = "working";
    transferMessage = "Importing Markdown and attachments…";
    if (!(await settleDraft())) {
      transferState = "idle";
      transferMessage = "";
      return;
    }
    try {
      const result = await importMarkdownFiles(vault, files);
      searchQuery = "";
      const notes = await vault.listNotes();
      await loadNote(notes[0].id);
      await runSearch("");
      pendingBackupCount = (await vault.getPendingBackupOperations()).length;
      transferState = "idle";
      transferMessage = `Imported ${result.noteCount} ${result.noteCount === 1 ? "note" : "notes"} and ${result.attachmentCount} ${result.attachmentCount === 1 ? "attachment" : "attachments"}.`;
    } catch (error) {
      showTransferError(error, "The Markdown folder could not be imported.");
    }
  }

  function downloadBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // Browsers save PDFs through their own print dialog, which the print stylesheet feeds.
  function savePdf(): void {
    window.print();
  }

  async function copyMarkdown(): Promise<void> {
    await copyToClipboard(() => navigator.clipboard.writeText(markdown), "Markdown");
  }

  function downloadMarkdown(): void {
    downloadBlob(
      new Blob([markdown.endsWith("\n") ? markdown : `${markdown}\n`], { type: "text/markdown" }),
      outputFileName(noteTitle, "md"),
    );
  }

  async function copyText(): Promise<void> {
    await copyToClipboard(() => navigator.clipboard.writeText(plainText), "plain text");
  }

  function downloadText(): void {
    downloadBlob(
      new Blob([`${plainText}\n`], { type: "text/plain" }),
      outputFileName(noteTitle, "txt"),
    );
  }

  async function copyRichText(): Promise<void> {
    await copyToClipboard(
      () =>
        navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([exportedHtml()], { type: "text/html" }),
            "text/plain": new Blob([plainText], { type: "text/plain" }),
          }),
        ]),
      "rich text",
    );
  }

  function downloadRtf(): void {
    downloadBlob(
      new Blob([markdownToRtf(markdown)], { type: "application/rtf" }),
      outputFileName(noteTitle, "rtf"),
    );
  }

  // Exports keep the note's own attachment paths, because in-app blob URLs die with the tab.
  function exportedHtml(): string {
    return renderMarkdown(markdown, undefined, { remoteImages: "allow" });
  }

  async function copyToClipboard(write: () => Promise<void>, format: string): Promise<void> {
    if (transferState === "working") return;
    try {
      await write();
      transferState = "idle";
      transferMessage = `Copied this note as ${format}.`;
    } catch {
      transferState = "error";
      transferMessage = "The browser did not allow copying to the clipboard.";
    }
  }

  async function copyHtml(): Promise<void> {
    await copyToClipboard(
      () => navigator.clipboard.writeText(formatHtmlSource(exportedHtml())),
      "HTML",
    );
  }

  function downloadHtml(): void {
    const body = formatHtmlSource(exportedHtml());
    const html = createHtmlDocument({ title: noteTitle, body });
    downloadBlob(new Blob([html], { type: "text/html" }), outputFileName(noteTitle, "html"));
  }

  // The PDF view has nothing to copy, so it has no copy handler.
  const outputCopy: Partial<Record<OutputView, () => Promise<void>>> = {
    markdown: copyMarkdown,
    text: copyText,
    "rich-text": copyRichText,
    html: copyHtml,
  };
  const outputDownload: Record<OutputView, () => void> = {
    markdown: downloadMarkdown,
    text: downloadText,
    "rich-text": downloadRtf,
    html: downloadHtml,
    pdf: savePdf,
  };

  async function copyOutput(): Promise<void> {
    await outputCopy[outputView]?.();
  }

  function downloadOutput(): void {
    outputDownload[outputView]();
  }

  async function exportZip(): Promise<void> {
    if (!vault || transferState === "working") return;
    transferState = "working";
    transferMessage = "Building ZIP archive…";
    if (!(await settleDraft())) {
      transferState = "idle";
      transferMessage = "";
      return;
    }
    try {
      const files = await createMarkdownExport(vault);
      const archive = await createMarkdownZip(files);
      downloadBlob(archive, `onyx-markdown-${new Date().toISOString().slice(0, 10)}.zip`);
      transferState = "idle";
      transferMessage = `Exported ${files.length} ${files.length === 1 ? "file" : "files"} to ZIP.`;
    } catch (error) {
      showTransferError(error, "The ZIP archive could not be exported.");
    }
  }

  async function exportFolder(): Promise<void> {
    if (!vault || transferState === "working") return;
    const picker = (
      window as Window & {
        showDirectoryPicker?: (options?: {
          mode: "readwrite";
        }) => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;
    if (!picker) {
      transferState = "error";
      transferMessage = "Folder export is not supported by this browser. Use ZIP export instead.";
      return;
    }
    try {
      const directory = await picker.call(window, { mode: "readwrite" });
      transferState = "working";
      transferMessage = "Writing Markdown folder…";
      if (!(await settleDraft())) {
        transferState = "idle";
        transferMessage = "";
        return;
      }
      const files = await createMarkdownExport(vault);
      await writeMarkdownFolder(directory, files);
      transferState = "idle";
      transferMessage = `Exported ${files.length} ${files.length === 1 ? "file" : "files"} to the selected folder.`;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      showTransferError(error, "The Markdown folder could not be exported.");
    }
  }

  function showTransferError(error: unknown, fallback: string): void {
    transferState = "error";
    transferMessage = error instanceof Error ? error.message : fallback;
  }

  async function settleDraft(): Promise<boolean> {
    if (markdown !== lastSavedMarkdown) return saveDraft();
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = undefined;
    return saveRun ? await saveRun : true;
  }

  function queueSave(): void {
    if (clearingVault) return;
    saveState = "unsaved";
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void saveDraft(), 700);
  }

  async function saveDraft(): Promise<boolean> {
    if (clearingVault || !vault || !activeNoteId) return false;
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = undefined;
    saveRequested = true;
    if (saveRun) return saveRun;
    const run = flushDrafts();
    saveRun = run;
    try {
      return await run;
    } finally {
      if (saveRun === run) saveRun = undefined;
    }
  }

  async function flushDrafts(): Promise<boolean> {
    while (saveRequested) {
      if (clearingVault) {
        saveRequested = false;
        return true;
      }
      saveRequested = false;
      if (!vault || !activeNoteId) return false;
      const noteId = activeNoteId;
      const contents = markdown;
      const expectedRevision = noteRevision;
      saveState = "saving";
      try {
        const savedNote = await vault.saveNote({
          id: noteId,
          title: titleFromMarkdown(contents),
          markdown: contents,
          expectedRevision,
        });
        if (activeNoteId === noteId) {
          noteRevision = savedNote.revision;
          lastSavedMarkdown = contents;
          saveState = markdown === contents ? "saved" : "unsaved";
          storageError = "";
        }
        appendNativeDirectoryNotice();
        await runSearch(searchQuery);
        pendingBackupCount = (await vault.getPendingBackupOperations()).length;
      } catch (error) {
        saveRequested = false;
        if (activeNoteId === noteId) {
          storageError = error instanceof Error ? error.message : "Autosave failed.";
          saveState = "error";
        }
        return false;
      }
    }
    return true;
  }

  function updateMarkdown(value: string): void {
    markdown = value;
    queuePreview(value);
    queueSave();
  }

  function queuePreview(value: string): void {
    if (previewTimer) window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      previewTimer = undefined;
      previewMarkdown = value;
    }, PREVIEW_DELAY_MS);
  }

  function updatePreviewImmediately(value: string): void {
    if (previewTimer) window.clearTimeout(previewTimer);
    previewTimer = undefined;
    previewMarkdown = value;
  }

  function clampSplitRatio(value: number): number {
    return Math.min(80, Math.max(20, value));
  }

  function setSplitRatio(value: number): void {
    splitRatio = clampSplitRatio(value);
  }

  function saveSplitRatio(): void {
    writeLocalStorage("onyx:split-ratio", splitRatio.toFixed(1));
  }

  function clampContentWidth(value: number): number {
    return Math.min(1_200, Math.max(480, Math.round(value / 20) * 20));
  }

  function setContentWidth(value: number): void {
    contentWidth = clampContentWidth(value);
    writeLocalStorage("onyx:content-width", String(contentWidth));
  }

  // A single-pane viewport switches views instead of splitting, and leaves the stored split alone.
  function showOnlyPane(pane: "source" | "rendered"): void {
    outputPaneVisible = pane === "source";
    renderedPaneVisible = pane === "rendered";
    editingSurface = pane === "source" || renderedReadOnly ? "source" : "rendered";
  }

  function swapPanes(): void {
    if (singlePaneMode) return;
    paneOrder = paneOrder === "source-first" ? "rendered-first" : "source-first";
    // The panes trade places, so the stored split has to follow them to keep their sizes.
    splitRatio = clampSplitRatio(100 - splitRatio);
    writeLocalStorage("onyx:pane-order", paneOrder);
    saveSplitRatio();
  }

  function setOutputView(view: OutputView): void {
    outputView = view;
    writeLocalStorage("onyx:output-view", view);
  }

  function togglePaneLayout(): void {
    if (singlePaneMode) return;
    paneLayout = paneLayout === "columns" ? "rows" : "columns";
    writeLocalStorage("onyx:pane-layout", paneLayout);
  }

  function placePane(pane: "output" | "rendered", edge: PaneEdge): void {
    if (singlePaneMode) return;
    const layout: PaneLayout = edge === "left" || edge === "right" ? "columns" : "rows";
    const leads = edge === "left" || edge === "top";
    const order: PaneOrder = (pane === "rendered") === leads ? "rendered-first" : "source-first";
    if (order !== paneOrder) swapPanes();
    if (layout !== paneLayout) togglePaneLayout();
  }

  function applyPanePreferences(): void {
    const storedOutputView = readLocalStorage("onyx:output-view");
    outputView = isOutputView(storedOutputView) ? storedOutputView : "markdown";
    paneLayout = readLocalStorage("onyx:pane-layout") === "rows" ? "rows" : "columns";
    paneOrder =
      readLocalStorage("onyx:pane-order") === "source-first" ? "source-first" : "rendered-first";
    const storedOutputPane = readLocalStorage("onyx:output-pane-visible");
    const storedRenderedPane = readLocalStorage("onyx:rendered-pane-visible");
    const storedReadOnly = readLocalStorage("onyx:rendered-read-only");
    renderedReadOnly = storedReadOnly === "true";
    if (singlePaneMode) {
      showOnlyPane(storedRenderedPane === "false" ? "source" : "rendered");
      return;
    }
    outputPaneVisible = storedOutputPane !== "false";
    renderedPaneVisible = storedRenderedPane !== "false";
    if (!outputPaneVisible && !renderedPaneVisible) outputPaneVisible = true;
    if (!outputPaneVisible && !renderedReadOnly) editingSurface = "rendered";
  }

  function toggleOutputPane(): void {
    if (singlePaneMode) {
      showOnlyPane(outputPaneVisible ? "rendered" : "source");
      return;
    }
    if (outputPaneVisible && !renderedPaneVisible) return;
    outputPaneVisible = !outputPaneVisible;
    writeLocalStorage("onyx:output-pane-visible", String(outputPaneVisible));
    if (!outputPaneVisible && renderedPaneVisible && !renderedReadOnly) editingSurface = "rendered";
  }

  function toggleRenderedPane(): void {
    if (singlePaneMode) {
      showOnlyPane(renderedPaneVisible ? "source" : "rendered");
      return;
    }
    if (renderedPaneVisible && !outputPaneVisible) return;
    renderedPaneVisible = !renderedPaneVisible;
    writeLocalStorage("onyx:rendered-pane-visible", String(renderedPaneVisible));
    if (!renderedPaneVisible && outputPaneVisible) editingSurface = "source";
  }

  function toggleRenderedReadOnly(): void {
    renderedReadOnly = !renderedReadOnly;
    writeLocalStorage("onyx:rendered-read-only", String(renderedReadOnly));
    if (!renderedReadOnly) {
      if (singlePaneMode) showOnlyPane("rendered");
      renderedPaneVisible = true;
      editingSurface = "rendered";
      if (!singlePaneMode) writeLocalStorage("onyx:rendered-pane-visible", "true");
      requestAnimationFrame(() =>
        inlinePreviewBehavior === "rendered" ? focusRenderedLine(liveLine) : liveEditor?.focus(),
      );
    }
  }

  function focusSourceEditor(): void {
    editingSurface = "source";
  }

  function focusLiveLine(line: number): void {
    editingSurface = "rendered";
    liveLine = line;
  }

  function activateLiveLine(line: number, position?: number): void {
    editingSurface = "rendered";
    liveLine = line;
    if (inlinePreviewBehavior === "rendered") {
      requestAnimationFrame(() => focusRenderedLine(line, position));
      return;
    }
    requestAnimationFrame(() => {
      liveEditor?.focus();
      const cursor = position ?? liveEditor?.value.length ?? 0;
      liveEditor?.setSelectionRange(cursor, cursor);
    });
  }

  function setFont(role: FontRole, id: string): void {
    fonts = { ...fonts, [role]: id };
    applyFontChoices(fonts);
  }

  function resetFonts(): void {
    fonts = { ...defaultFontChoices };
    applyFontChoices(fonts);
  }

  function toggleInlinePreview(): void {
    const behavior: InlinePreviewBehavior =
      inlinePreviewBehavior === "rendered" ? "source-line" : "rendered";
    inlinePreviewBehavior = behavior;
    writeLocalStorage("onyx:inline-preview-behavior", behavior);
    if (renderedPaneVisible && !renderedReadOnly && editingSurface === "rendered") {
      requestAnimationFrame(() =>
        behavior === "rendered" ? focusRenderedLine(liveLine) : liveEditor?.focus(),
      );
    }
  }

  function shortcutLabel(action: ShortcutAction): string | undefined {
    const shortcut = shortcuts[action];
    return shortcut ? formatShortcut(shortcut, primaryModifier) : undefined;
  }

  function setShortcut(action: ShortcutAction, shortcut: KeyboardShortcut | null): void {
    shortcuts = { ...shortcuts, [action]: shortcut };
    writeKeyboardShortcuts(shortcuts);
  }

  function resetShortcuts(): void {
    shortcuts = structuredClone(defaultKeyboardShortcuts);
    writeKeyboardShortcuts(shortcuts);
  }

  function updateRenderedLine(line: number, element: HTMLElement): void {
    const position = getCaretOffset(element);
    updateLiveLine(line, element.textContent ?? "");
    void tick().then(() => focusRenderedLine(liveLine, position));
  }

  function handleRenderedLineKeydown(event: KeyboardEvent, line: number): void {
    const element = event.currentTarget as HTMLElement;
    const selection = getSourceSelection(element);
    if (!selection) return;
    const value = element.textContent ?? "";
    if (event.key === "Enter") {
      event.preventDefault();
      const before = value.slice(0, selection.start);
      const after = value.slice(selection.end);
      const marker = before.match(/^(\s*(?:[-*]\s+(?:\[[ xX]\]\s+)?|>\s+))/)?.[1] ?? "";
      const continuation = marker && before.trim() !== marker.trim() ? marker : "";
      const lines = [...markdownLines];
      lines.splice(line, 1, before, `${continuation}${after}`);
      updateMarkdown(lines.join("\n"));
      liveLine = line + 1;
      requestAnimationFrame(() => focusRenderedLine(line + 1, continuation.length));
    } else if (
      event.key === "Backspace" &&
      selection.start === 0 &&
      selection.end === 0 &&
      line > 0
    ) {
      event.preventDefault();
      const lines = [...markdownLines];
      const previousLength = lines[line - 1].length;
      lines.splice(line - 1, 2, `${lines[line - 1]}${value}`);
      updateMarkdown(lines.join("\n"));
      liveLine = line - 1;
      requestAnimationFrame(() => focusRenderedLine(line - 1, previousLength));
    } else if (event.key === "ArrowUp" && line > 0) {
      event.preventDefault();
      activateLiveLine(line - 1, Math.min(selection.start, markdownLines[line - 1].length));
    } else if (event.key === "ArrowDown" && line < markdownLines.length - 1) {
      event.preventDefault();
      activateLiveLine(line + 1, Math.min(selection.start, markdownLines[line + 1].length));
    }
  }

  function getSourceSelection(element: HTMLElement): { start: number; end: number } | undefined {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !element.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0);
    const start = range.cloneRange();
    start.selectNodeContents(element);
    start.setEnd(range.startContainer, range.startOffset);
    const end = range.cloneRange();
    end.selectNodeContents(element);
    end.setEnd(range.endContainer, range.endOffset);
    return {
      start: start.cloneContents().textContent?.length ?? 0,
      end: end.cloneContents().textContent?.length ?? 0,
    };
  }

  function getCaretOffset(element: HTMLElement): number {
    return getSourceSelection(element)?.end ?? element.textContent?.length ?? 0;
  }

  function focusRenderedLine(line: number, position?: number): void {
    const element = liveEditorContainer?.querySelector<HTMLElement>(`[data-live-line="${line}"]`);
    if (!element) return;
    element.focus();
    const target = Math.min(
      position ?? element.textContent?.length ?? 0,
      element.textContent?.length ?? 0,
    );
    setRenderedSelection(element, target, target);
  }

  function setRenderedSelection(element: HTMLElement, start: number, end: number): void {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let remaining = start;
    let node = walker.nextNode();
    while (node && remaining >= (node.textContent?.length ?? 0)) {
      remaining -= node.textContent?.length ?? 0;
      node = walker.nextNode();
    }
    const range = document.createRange();
    if (node) range.setStart(node, remaining);
    else {
      range.selectNodeContents(element);
      range.collapse(false);
    }
    if (end === start) range.collapse(true);
    else {
      const endWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let endRemaining = end;
      let endNode = endWalker.nextNode();
      while (endNode && endRemaining >= (endNode.textContent?.length ?? 0)) {
        endRemaining -= endNode.textContent?.length ?? 0;
        endNode = endWalker.nextNode();
      }
      if (endNode) range.setEnd(endNode, endRemaining);
      else range.setEndAfter(element.lastChild ?? element);
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function updateLiveLine(line: number, value: string): void {
    const lines = [...markdownLines];
    const replacement = value.split("\n");
    lines.splice(line, 1, ...replacement);
    liveLine = line + replacement.length - 1;
    updateMarkdown(lines.join("\n"));
    if (replacement.length > 1) activateLiveLine(liveLine, replacement.at(-1)?.length ?? 0);
  }

  function handleLiveLineKeydown(event: KeyboardEvent, line: number): void {
    if (!liveEditor) return;
    const start = liveEditor.selectionStart;
    const end = liveEditor.selectionEnd;
    const value = liveEditor.value;
    if (event.key === "Enter") {
      event.preventDefault();
      const before = value.slice(0, start);
      const after = value.slice(end);
      const marker = before.match(/^(\s*(?:[-*]\s+(?:\[[ xX]\]\s+)?|>\s+))/)?.[1] ?? "";
      const continuation = marker && before.trim() !== marker.trim() ? marker : "";
      const lines = [...markdownLines];
      lines.splice(line, 1, before, `${continuation}${after}`);
      updateMarkdown(lines.join("\n"));
      activateLiveLine(line + 1, continuation.length);
    } else if (event.key === "Backspace" && start === 0 && end === 0 && line > 0) {
      event.preventDefault();
      const lines = [...markdownLines];
      const previousLength = lines[line - 1].length;
      lines.splice(line - 1, 2, `${lines[line - 1]}${value}`);
      updateMarkdown(lines.join("\n"));
      activateLiveLine(line - 1, previousLength);
    } else if (event.key === "ArrowUp" && start === 0 && end === 0 && line > 0) {
      event.preventDefault();
      activateLiveLine(line - 1);
    } else if (
      event.key === "ArrowDown" &&
      start === value.length &&
      end === value.length &&
      line < markdownLines.length - 1
    ) {
      event.preventDefault();
      activateLiveLine(line + 1, 0);
    }
  }

  function queueSearch(value: string): void {
    searchQuery = value;
    notePage = 0;
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void runSearch(value), 120);
  }

  async function runSearch(query: string): Promise<void> {
    if (!vault) return;
    const sequence = ++searchSequence;
    const nextResults = await vault.search(query);
    if (sequence === searchSequence) {
      results = nextResults;
      notePage = 0;
      notesLoaded = true;
    }
  }

  function changeNotePage(page: number): void {
    notePage = Math.min(Math.max(page, 0), notePageCount - 1);
    noteList?.scrollTo({ top: 0 });
  }

  function isRenderedEditingActive(): boolean {
    return (
      renderedPaneVisible &&
      !renderedReadOnly &&
      (editingSurface === "rendered" || !outputPaneVisible)
    );
  }

  // Formatting edits the Markdown source, so another output view is switched back first.
  async function ensureMarkdownView(): Promise<boolean> {
    if (editor || isRenderedEditingActive()) return true;
    setOutputView("markdown");
    await tick();
    return Boolean(editor);
  }

  async function insertSyntax(before: string, after = before, placeholder = "text"): Promise<void> {
    if (!(await ensureMarkdownView())) return;
    if (isRenderedEditingActive() && inlinePreviewBehavior === "rendered") {
      const target = liveEditorContainer?.querySelector<HTMLElement>(
        `[data-live-line="${liveLine}"]`,
      );
      const selection = target && getSourceSelection(target);
      if (!target || !selection) return;
      const lineOffset = markdownLines
        .slice(0, liveLine)
        .reduce((total, line) => total + line.length + 1, 0);
      const start = lineOffset + selection.start;
      const end = lineOffset + selection.end;
      const selected = markdown.slice(start, end) || placeholder;
      updateMarkdown(
        `${markdown.slice(0, start)}${before}${selected}${after}${markdown.slice(end)}`,
      );
      requestAnimationFrame(() => {
        focusRenderedLine(liveLine, selection.start + before.length);
        const element = liveEditorContainer?.querySelector<HTMLElement>(
          `[data-live-line="${liveLine}"]`,
        );
        if (element) {
          setRenderedSelection(
            element,
            selection.start + before.length,
            selection.start + before.length + selected.length,
          );
        }
      });
      return;
    }
    const renderedActive = isRenderedEditingActive();
    const target = renderedActive ? liveEditor : editor;
    if (!target) return;
    const relativeStart = target.selectionStart;
    const lineOffset = renderedActive
      ? markdownLines.slice(0, liveLine).reduce((total, line) => total + line.length + 1, 0)
      : 0;
    const start = lineOffset + relativeStart;
    const end = lineOffset + target.selectionEnd;
    const selection = markdown.slice(start, end) || placeholder;
    updateMarkdown(
      `${markdown.slice(0, start)}${before}${selection}${after}${markdown.slice(end)}`,
    );
    requestAnimationFrame(() => {
      target.focus();
      const selectionStart = relativeStart + before.length;
      target.setSelectionRange(selectionStart, selectionStart + selection.length);
    });
  }

  async function prefixLine(prefix: string): Promise<void> {
    if (!(await ensureMarkdownView())) return;
    if (isRenderedEditingActive() && inlinePreviewBehavior === "rendered") {
      const target = liveEditorContainer?.querySelector<HTMLElement>(
        `[data-live-line="${liveLine}"]`,
      );
      const selection = target && getSourceSelection(target);
      if (!target || !selection) return;
      const lineOffset = markdownLines
        .slice(0, liveLine)
        .reduce((total, line) => total + line.length + 1, 0);
      updateMarkdown(`${markdown.slice(0, lineOffset)}${prefix}${markdown.slice(lineOffset)}`);
      requestAnimationFrame(() => focusRenderedLine(liveLine, selection.start + prefix.length));
      return;
    }
    const renderedActive = isRenderedEditingActive();
    const target = renderedActive ? liveEditor : editor;
    if (!target) return;
    const relativeCursor = target.selectionStart;
    const lineOffset = renderedActive
      ? markdownLines.slice(0, liveLine).reduce((total, line) => total + line.length + 1, 0)
      : 0;
    const cursor = lineOffset + relativeCursor;
    const start = markdown.lastIndexOf("\n", cursor - 1) + 1;
    updateMarkdown(`${markdown.slice(0, start)}${prefix}${markdown.slice(start)}`);
    requestAnimationFrame(() => {
      target.focus();
      const nextCursor = relativeCursor + prefix.length;
      target.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function handleShortcut(event: KeyboardEvent): void {
    const action = (Object.keys(shortcuts) as ShortcutAction[]).find((candidate) =>
      shortcutMatchesEvent(shortcuts[candidate], event, primaryModifier),
    );
    if (!action) return;
    const shortcut = shortcuts[action];
    if (
      isTypingTarget(event.target) &&
      action !== "closePanel" &&
      !shortcut?.primary &&
      !shortcut?.alt
    )
      return;
    if (paletteOpen && action !== "commandPalette" && action !== "closePanel") return;
    event.preventDefault();

    if (action === "commandPalette") togglePalette();
    else if (action === "saveNote" && transferState !== "working") void saveDraft();
    else if (action === "newNote" && transferState !== "working") void createNote();
    else if (action === "searchNotes" || action === "focusSearch") focusSearch();
    else if (action === "cycleTheme") setTheme(nextThemePreference(theme));
    else if (action === "toggleSidebar") toggleSidebar();
    else if (action === "bold") void insertSyntax("**", "**", "bold text");
    else if (action === "italic") void insertSyntax("_", "_", "italic text");
    else if (action === "togglePreview") toggleRenderedPane();
    else if (action === "openShortcuts") openSettings("shortcuts");
    else if (action === "closePanel") {
      if (restoreModalOpen && restoreState !== "restoring") restoreModalOpen = false;
      else if (settingsOpen) settingsOpen = false;
      else if (paletteOpen) paletteOpen = false;
      else if (sidebarOpen) sidebarOpen = false;
      else if (searchQuery) {
        queueSearch("");
        searchInput?.blur();
      }
    }
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  function focusSearch(): void {
    sidebarCollapsed = false;
    if (window.innerWidth <= 900) sidebarOpen = true;
    requestAnimationFrame(() => {
      searchInput?.focus();
      searchInput?.select();
    });
  }

  function toggleSidebar(): void {
    if (window.innerWidth <= 900) sidebarOpen = !sidebarOpen;
    else sidebarCollapsed = !sidebarCollapsed;
  }

  function setTheme(preference: ThemePreference): void {
    theme = preference;
    resolvedTheme = applyTheme(preference);
  }

  function setColorTheme(nextTheme: ColorTheme): void {
    colorTheme = nextTheme;
    applyColorTheme(nextTheme);
  }

  function togglePalette(): void {
    if (paletteOpen) {
      paletteOpen = false;
      return;
    }
    void openPalette();
  }

  async function openPalette(): Promise<void> {
    paletteNotes = vault ? await vault.listNotes() : [];
    paletteOpen = true;
  }

  function moveNoteFocus(event: KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const files = [...(noteList?.querySelectorAll<HTMLButtonElement>(".file") ?? [])];
    const current = files.indexOf(document.activeElement as HTMLButtonElement);
    if (files.length === 0) return;
    event.preventDefault();
    const next = event.key === "ArrowDown" ? current + 1 : current - 1;
    files[(next + files.length) % files.length]?.focus();
  }

  function renderLiveLine(line: string, index: number): string {
    const inCode = liveCodeLines[index] && !line.startsWith("```");
    const cacheKey = `${inCode ? "code" : "markdown"}\0${line}`;
    const cached = liveRenderCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const rendered = inCode
      ? `<pre><code>${escapeHtml(line) || " "}</code></pre>`
      : renderMarkdown(line, resolveAttachmentUrl);
    if (liveRenderCache.size >= 1_000) {
      liveRenderCache.delete(liveRenderCache.keys().next().value ?? "");
    }
    liveRenderCache.set(cacheKey, rendered);
    return rendered;
  }

  function liveLineKind(line: string, index: number): string {
    if (liveCodeLines[index]) return "code-line";
    const heading = line.match(/^(#{1,6})\s+/);
    if (heading) return `heading-${heading[1].length}`;
    if (/^>\s?/.test(line)) return "quote-line";
    if (/^\s*(?:[-+*]|\d+[.)])\s+/.test(line)) return "list-line";
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return "rule-line";
    return "";
  }

  function renderEditableLine(line: string, index: number): string {
    if (!line) return "<br>";
    const kind = liveLineKind(line, index);
    if (kind === "code-line") {
      const fence = line.match(/^(\s*(?:`{3,}|~{3,}))(.*)$/);
      return fence
        ? `<span class="md-syntax">${fence[1]}</span>${escapeHtml(fence[2])}`
        : escapeHtml(line);
    }
    const heading = line.match(/^(#{1,6}\s+)(.*)$/);
    if (heading) {
      return `<span class="md-syntax">${escapeHtml(heading[1])}</span>${editableInlineMarkdown(heading[2])}`;
    }
    const task = line.match(/^(\s*[-+*]\s+)(\[([ xX])\]\s+)(.*)$/);
    if (task) {
      return `<span class="md-syntax">${escapeHtml(task[1])}</span><span class="live-task-check ${task[3] !== " " ? "done" : ""}"></span><span class="md-syntax">${escapeHtml(task[2])}</span>${editableInlineMarkdown(task[4])}`;
    }
    const list = line.match(/^(\s*([-+*]|\d+[.)])\s+)(.*)$/);
    if (list) {
      const ordered = /^\d/.test(list[2]!.trim());
      return `<span class="md-syntax">${escapeHtml(list[1])}</span><span class="live-list-marker${ordered ? " ordered" : ""}"${ordered ? ` data-marker="${escapeHtml(list[2]!)}"` : ""}></span>${editableInlineMarkdown(list[3])}`;
    }
    const quote = line.match(/^(>\s?)(.*)$/);
    if (quote) {
      return `<span class="md-syntax">${escapeHtml(quote[1])}</span>${editableInlineMarkdown(quote[2])}`;
    }
    if (kind === "rule-line") return `<span class="md-syntax">${escapeHtml(line)}</span>`;
    return editableInlineMarkdown(line);
  }

  function editableInlineMarkdown(value: string): string {
    const patterns = [
      /`([^`]+)`/,
      /\[\[([^\]|]+)\|([^\]]+)\]\]/,
      /\[\[([^\]]+)\]\]/,
      /\[([^\]]+)\]\(([^\s)]+)\)/,
      /(\*\*|__)(.+?)\1/,
      /~~([^~]+)~~/,
      /==([^=]+)==/,
      /(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)/,
    ] as const;

    const syntax = (source: string) => `<span class="md-syntax">${escapeHtml(source)}</span>`;
    let rendered = "";
    let cursor = 0;

    while (cursor < value.length) {
      const remaining = value.slice(cursor);
      let tokenIndex = -1;
      let token: RegExpMatchArray | undefined;
      let tokenStart = remaining.length;

      patterns.forEach((pattern, index) => {
        const match = remaining.match(pattern);
        if (match && match.index !== undefined && match.index < tokenStart) {
          tokenIndex = index;
          token = match;
          tokenStart = match.index;
        }
      });

      if (!token || tokenIndex < 0) {
        rendered += escapeHtml(remaining);
        break;
      }

      rendered += escapeHtml(remaining.slice(0, tokenStart));
      const full = token[0];
      switch (tokenIndex) {
        case 0:
          rendered += `${syntax("`")}<code>${escapeHtml(token[1]!)}</code>${syntax("`")}`;
          break;
        case 1:
          rendered += `${syntax(`[[${token[1]}|`)}<a class="wikilink">${editableInlineMarkdown(token[2]!)}</a>${syntax("]]")}`;
          break;
        case 2:
          rendered += `${syntax("[[")}<a class="wikilink">${escapeHtml(token[1]!)}</a>${syntax("]]")}`;
          break;
        case 3:
          rendered += `${syntax("[")}<a>${editableInlineMarkdown(token[1]!)}</a>${syntax(`](${token[2]})`)}`;
          break;
        case 4: {
          const marker = token[1]!;
          rendered += `${syntax(marker)}<strong>${editableInlineMarkdown(token[2]!)}</strong>${syntax(marker)}`;
          break;
        }
        case 5:
          rendered += `${syntax("~~")}<del>${editableInlineMarkdown(token[1]!)}</del>${syntax("~~")}`;
          break;
        case 6:
          rendered += `${syntax("==")}<mark>${editableInlineMarkdown(token[1]!)}</mark>${syntax("==")}`;
          break;
        default: {
          const marker = token[1] ? "*" : "_";
          rendered += `${syntax(marker)}<em>${editableInlineMarkdown(token[1] ?? token[2]!)}</em>${syntax(marker)}`;
        }
      }
      cursor += tokenStart + full.length;
    }

    return rendered;
  }

  function escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  return {
    get vaults() {
      return vaults;
    },
    get activeVaultId() {
      return activeVaultId;
    },
    get vaultName() {
      return activeVault?.name ?? "Notes";
    },
    get suggestedRepositoryName() {
      return suggestedRepositoryName(activeVault);
    },
    get activeNoteId() {
      return activeNoteId;
    },
    get results() {
      return results;
    },
    get visibleResults() {
      return visibleResults;
    },
    get searchQuery() {
      return searchQuery;
    },
    get notePage() {
      return notePage;
    },
    get notePageCount() {
      return notePageCount;
    },
    get notesLoaded() {
      return notesLoaded;
    },
    get saveState() {
      return saveState;
    },
    get transferState() {
      return transferState;
    },
    get storageError() {
      return storageError;
    },
    get storageNotice() {
      return storageNotice;
    },
    get isOnline() {
      return isOnline;
    },
    get githubState() {
      return githubState;
    },
    get githubUser() {
      return githubUser;
    },
    get githubMessage() {
      return githubMessage;
    },
    get githubBackup() {
      return githubBackup;
    },
    get backupState() {
      return backupState;
    },
    get backupMessage() {
      return backupMessage;
    },
    set backupMessage(value: string) {
      backupMessage = value;
    },
    get backupCommitUrl() {
      return backupCommitUrl;
    },
    get settingsOpen() {
      return settingsOpen;
    },
    set settingsOpen(value: boolean) {
      settingsOpen = value;
    },
    get settingsSection() {
      return settingsSection;
    },
    set settingsSection(value: SettingsSection) {
      settingsSection = value;
    },
    get pendingBackupCount() {
      return pendingBackupCount;
    },
    get restoreModalOpen() {
      return restoreModalOpen;
    },
    set restoreModalOpen(value: boolean) {
      restoreModalOpen = value;
    },
    get restoreState() {
      return restoreState;
    },
    get restoreMessage() {
      return restoreMessage;
    },
    get restoreCommits() {
      return restoreCommits;
    },
    get selectedRestoreSha() {
      return selectedRestoreSha;
    },
    set selectedRestoreSha(value: string) {
      selectedRestoreSha = value;
    },
    get restoreOwner() {
      return restoreOwner;
    },
    set restoreOwner(value: string) {
      restoreOwner = value;
    },
    get restoreRepository() {
      return restoreRepository;
    },
    set restoreRepository(value: string) {
      restoreRepository = value;
    },
    get restoreBranch() {
      return restoreBranch;
    },
    set restoreBranch(value: string) {
      restoreBranch = value;
    },
    get restoreDirectory() {
      return restoreDirectory;
    },
    set restoreDirectory(value: string) {
      restoreDirectory = value;
    },
    get transferMessage() {
      return transferMessage;
    },
    set transferMessage(value: string) {
      transferMessage = value;
    },
    get theme() {
      return theme;
    },
    get resolvedTheme() {
      return resolvedTheme;
    },
    get colorTheme() {
      return colorTheme;
    },
    get fonts() {
      return fonts;
    },
    get inlinePreviewBehavior() {
      return inlinePreviewBehavior;
    },
    get shortcuts() {
      return shortcuts;
    },
    get primaryModifier() {
      return primaryModifier;
    },
    get outputPaneVisible() {
      return outputPaneVisible;
    },
    get renderedPaneVisible() {
      return renderedPaneVisible;
    },
    get renderedReadOnly() {
      return renderedReadOnly;
    },
    get outputView() {
      return outputView;
    },
    get paneLayout() {
      return effectivePaneLayout;
    },
    get paneOrder() {
      return paneOrder;
    },
    get singlePaneMode() {
      return singlePaneMode;
    },
    get splitRatio() {
      return splitRatio;
    },
    get contentWidth() {
      return contentWidth;
    },
    get markdown() {
      return markdown;
    },
    get markdownLines() {
      return markdownLines;
    },
    get liveLine() {
      return liveLine;
    },
    set liveLine(value: number) {
      liveLine = value;
    },
    get wordCount() {
      return wordCount;
    },
    get readingMinutes() {
      return readingMinutes;
    },
    get hasContent() {
      return hasContent;
    },
    get renderedMarkdown() {
      return renderedMarkdown;
    },
    get renderedBlockLines() {
      return renderedBlockLines;
    },
    get plainTextBlocks() {
      return plainTextBlocks;
    },
    get htmlSourceBlocks() {
      return htmlSourceBlocks;
    },
    get plainText() {
      return plainText;
    },
    get htmlSource() {
      return htmlSource;
    },
    get paletteItems() {
      return paletteItems;
    },
    get paletteOpen() {
      return paletteOpen;
    },
    set paletteOpen(value: boolean) {
      paletteOpen = value;
    },
    get sidebarOpen() {
      return sidebarOpen;
    },
    set sidebarOpen(value: boolean) {
      sidebarOpen = value;
    },
    get sidebarCollapsed() {
      return sidebarCollapsed;
    },
    set sidebarCollapsed(value: boolean) {
      sidebarCollapsed = value;
    },
    get vault() {
      return vault;
    },
    get editor() {
      return editor;
    },
    set editor(value: HTMLTextAreaElement | undefined) {
      editor = value;
    },
    get liveEditor() {
      return liveEditor;
    },
    set liveEditor(value: HTMLTextAreaElement | undefined) {
      liveEditor = value;
    },
    get liveEditorContainer() {
      return liveEditorContainer;
    },
    set liveEditorContainer(value: HTMLDivElement | undefined) {
      liveEditorContainer = value;
    },
    get searchInput() {
      return searchInput;
    },
    set searchInput(value: HTMLInputElement | undefined) {
      searchInput = value;
    },
    get noteList() {
      return noteList;
    },
    set noteList(value: HTMLElement | undefined) {
      noteList = value;
    },
    get folderInput() {
      return folderInput;
    },
    set folderInput(value: HTMLInputElement | undefined) {
      folderInput = value;
    },
    get zipInput() {
      return zipInput;
    },
    set zipInput(value: HTMLInputElement | undefined) {
      zipInput = value;
    },
    selectVault,
    createVault,
    renameVault,
    createNote,
    queueSearch,
    openPalette,
    openSettings,
    connectGitHub,
    disconnectGitHub,
    moveNoteFocus,
    selectNote,
    changeNotePage,
    saveDraft,
    openVault,
    dismissStorageNotice,
    toggleSidebar,
    insertSyntax,
    prefixLine,
    setSplitRatio,
    saveSplitRatio,
    setContentWidth,
    toggleOutputPane,
    toggleRenderedPane,
    swapPanes,
    togglePaneLayout,
    placePane,
    setOutputView,
    copyOutput,
    downloadOutput,
    toggleRenderedReadOnly,
    focusSourceEditor,
    focusLiveLine,
    updateMarkdown,
    updateRenderedLine,
    handleRenderedLineKeydown,
    updateLiveLine,
    handleLiveLineKeydown,
    activateLiveLine,
    renderEditableLine,
    renderLiveLine,
    liveLineKind,
    setTheme,
    setColorTheme,
    setFont,
    resetFonts,
    toggleInlinePreview,
    setShortcut,
    resetShortcuts,
    createBackupRepository,
    selectBackupRepository,
    forgetBackupRepository,
    beginBackup,
    openRestore,
    importFolder,
    importZip,
    exportFolder,
    exportZip,
    prepareVaultDeletion,
    clearVault,
    loadRestoreCommits,
    restoreSelectedCommit,
    formatCommitDate,
    dismissBackupMessage() {
      backupMessage = "";
    },
    dismissTransferMessage() {
      transferMessage = "";
    },
  };
}
