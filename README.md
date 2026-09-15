# Onyx

Onyx is a local-first Markdown notes app. It works without an account, autosaves notes on the
current device, and provides full-text search and several editing views. Optional GitHub sign-in
adds private backup and cross-device restore.

## What is implemented

- Create and autosave Markdown notes locally.
- Search note titles and contents from an on-device index.
- Write in source, rendered inline, split, or read-only preview mode.
- Syntax-highlight fenced code blocks when their opening fence names a language; the same markup
  is preserved in rich-text, PDF, and HTML output.
- Point just beside the divider to reveal a pane's grip, drag it to any side of the workspace to place the panes side by side or stacked, and drag the divider to resize them.
- Switch the output pane between the Markdown source, plain text, rich text, the generated HTML,
  and a printed-page preview. Plain text copies to the clipboard or downloads as a text file, rich
  text copies with its formatting or downloads as an RTF document, HTML downloads as a standalone
  file, and the PDF view prints through the browser's print dialog, where it can be saved as a PDF.
- Choose a light, dark, or system theme. System follows the operating system preference, updates
  when that preference changes, and the selected mode is saved in this browser.
- Import Markdown folders or ZIP archives, including locally referenced attachments.
- Export the complete vault to a folder when the browser supports the File System Access API, or
  download it as a ZIP in other browsers.
- Optionally sign in with GitHub, select or create a private repository, back up pending changes in
  one commit, and restore the vault on this or another device.
- Continue editing offline after the app has been loaded; GitHub actions pause until connectivity
  returns.
- Inspect browser storage usage, request persistent storage, connect a local folder, or clear the
  local vault in Settings.

The interface is responsive: desktop layouts have a collapsible note sidebar, while narrow layouts
use a slide-over note list. Preferences are saved per browser when local storage is available.

## Keyboard shortcuts

| Shortcut       | Action                               |
| -------------- | ------------------------------------ |
| `⌘ K`          | Open command palette                 |
| `⌘ ⇧ F` or `/` | Search all notes                     |
| `⌘ ⏎`          | Create a note                        |
| `⌘ S`          | Save the active note                 |
| `⌘ B` / `⌘ I`  | Format selected text                 |
| `⌘ ⇧ P`        | Toggle source/preview                |
| `⌘ \`          | Toggle the note sidebar              |
| `⌘ ⇧ L`        | Cycle light, dark, and system themes |
| `?`            | Show all shortcuts                   |
| `Esc`          | Close the active panel               |

Use `Ctrl` instead of `⌘` on Windows and Linux.

## Storage model

Onyx requires IndexedDB and the origin private file system (OPFS). IndexedDB stores note and
attachment metadata, the latest note text, the search index, GitHub backup configuration, and the
ordered backup queue. Markdown files and attachment bytes are written to OPFS. OPFS is the default
for every new vault and remains the universal fallback. Keeping the latest note text in IndexedDB
also lets an edit survive when an OPFS write fails because the site has reached its storage quota.

When the browser exposes the File System Access API, **Settings → Storage choices** can connect a
user-selected directory. Onyx detects this API directly rather than checking the browser name, then
stores the granted directory handle in IndexedDB and mirrors the OPFS `notes/` and `attachments/`
trees into that directory. Choose a dedicated folder because restoring a vault replaces those two
subdirectories. Disconnecting leaves the folder contents in place and continues with OPFS.

Firefox and Safari generally do not expose persistent handles to arbitrary local files or folders.
On those browsers, use OPFS together with Import & export, upload/download, or GitHub backup
workflows. If a previously connected directory's permission expires or is revoked, startup and
autosave continue against OPFS. Settings shows that the folder needs to be reconnected; choosing it
again copies the current OPFS vault into the folder before mirroring resumes.

Open tabs coordinate vault writes and GitHub backups with the Web Locks API when it is available.
BroadcastChannel invalidations refresh other tabs after a change, while note and vault revisions
reject stale writes and snapshots.

Browser storage is not the same as a user-selected folder. Clearing site data removes the local
vault, and browsers may evict non-persistent storage under space pressure. Onyx reports unavailable
storage capabilities in the workspace and exposes persistence status in Settings, so important
vaults should also be exported or backed up.

## Optional GitHub backup and sync

GitHub is not required to create, edit, search, import, or export notes. Signing in only enables an
off-device backup that can be restored on another device.

Onyx authenticates through Better Auth's GitHub provider. Better Auth handles the OAuth flow and
keeps the session and GitHub account data in signed, encrypted HTTP-only cookies; the active access
token exists only in browser memory. Vault data is sent from the browser directly to
`api.github.com` and does not pass through the Onyx server.

Backups target private, active repositories where the connected account has write access. A backup
coalesces pending changes by path and advances the configured branch without force-pushing. Restore
downloads the files from a chosen commit, replaces the local notes and attachments, and rebuilds the
IndexedDB metadata and search index. Current backups contain an Onyx manifest; older backups can be
reconstructed from their `notes/` and `attachments/` paths.

Create a GitHub OAuth App, configure its callback URL as
`https://your-onyx-domain.example/api/auth/callback/github`, and set the variables listed in
[`.env.example`](.env.example). `BETTER_AUTH_SECRET` must contain at least 32 random characters.
Onyx requests the `repo` scope so it can create private repositories and write backup commits.

## Architecture

- `src/routes/+page.svelte` owns application state and coordinates persistence, transfer, and
  GitHub workflows.
- `src/lib/components/` contains focused workspace, navigation, dialog, and status components.
- `src/routes/styles/` separates base tokens, application shell, editor, dialog, command-palette,
  responsive, and print styles.
- `src/lib/storage/` implements the IndexedDB vault and its OPFS/native-folder file abstraction.
- `src/lib/markdown-transfer.ts` implements folder and ZIP import/export.
- `src/lib/markdown-output.ts` formats the generated HTML, builds standalone HTML exports, and
  converts notes to plain text and RTF.
- `src/lib/github.ts` implements repository validation, backup, and restore.
- `src/service-worker.ts` caches the application shell for offline use.

The app uses SvelteKit, TypeScript, Tailwind CSS, shadcn-svelte, and Vite+. It is configured for
Vercel deployment.

## Development

Use the latest Node.js LTS release and Vite+ for project commands:

```sh
vp install
vp dev
vp check
vp test
vp build
```

The variables in `.env.example` enable optional GitHub backup and sync. Onyx runs locally without
them.
