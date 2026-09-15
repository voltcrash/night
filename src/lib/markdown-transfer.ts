import { BlobReader, BlobWriter, ZipReader, ZipWriter, type Entry } from "@zip.js/zip.js";

import { titleFromMarkdown } from "./markdown.js";
import type { Vault } from "./storage/vault.js";

const BYTES_PER_MEBIBYTE = 1024 * 1024;

export const MAX_ARCHIVE_SIZE = 100 * BYTES_PER_MEBIBYTE;
export const MAX_ARCHIVE_UNCOMPRESSED_SIZE = 250 * BYTES_PER_MEBIBYTE;
export const MAX_ARCHIVE_ENTRIES = 10_000;

export interface MarkdownTransferLimits {
  maxArchiveBytes?: number;
  maxEntries?: number;
  maxUncompressedBytes?: number;
}

export interface MarkdownTransferFile {
  contents: Blob;
  path: string;
}

export interface MarkdownImportResult {
  attachmentCount: number;
  noteCount: number;
}

interface ResolvedTransferLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxUncompressedBytes: number;
}

interface ExportRecord extends MarkdownTransferFile {
  kind: "attachment" | "note";
  linkSourcePath: string;
  name?: string;
  sourcePath: string;
}

interface ExportPathLookup {
  attachmentsByName: Map<string, string | undefined>;
  attachmentsBySourcePath: Map<string, string | undefined>;
  bySourcePath: Map<string, string | undefined>;
}

interface CreatedDirectory {
  name: string;
  parent: FileSystemDirectoryHandle;
}

interface CreatedFile {
  name: string;
  parent: FileSystemDirectoryHandle;
}

export async function readMarkdownZip(
  file: Blob,
  limits?: MarkdownTransferLimits,
): Promise<MarkdownTransferFile[]> {
  const resolvedLimits = resolveTransferLimits(limits);
  assertWithinLimit(file.size, resolvedLimits.maxArchiveBytes, "ZIP archive");

  const reader = new ZipReader(new BlobReader(file), {
    checkAmbiguity: true,
    checkCrc32: true,
    filenameValidation: "tolerant",
  });
  try {
    const entries = await reader.getEntries({
      checkAmbiguity: true,
      filenameValidation: "tolerant",
    });
    assertEntryCount(entries.length, resolvedLimits.maxEntries);

    const paths = entries.map((entry) => validateArchivePath(entry));
    const files: MarkdownTransferFile[] = [];
    let uncompressedBytes = 0;
    for (const [index, entry] of entries.entries()) {
      if (entry.directory) continue;
      if (entry.symlink) {
        throw new Error(`ZIP archive contains an unsupported symbolic link: ${entry.filename}`);
      }

      assertWithinLimit(
        entry.uncompressedSize,
        resolvedLimits.maxUncompressedBytes,
        `ZIP entry ${entry.filename}`,
      );
      assertWithinLimit(
        uncompressedBytes + entry.uncompressedSize,
        resolvedLimits.maxUncompressedBytes,
        "ZIP contents",
      );

      const writer = createLimitedBlobWriter(
        contentType(paths[index]),
        resolvedLimits.maxUncompressedBytes - uncompressedBytes,
      );
      const contents = await entry.getData<Blob>(writer, {
        checkAmbiguity: true,
        checkCrc32: true,
      });
      uncompressedBytes += contents.size;
      assertWithinLimit(uncompressedBytes, resolvedLimits.maxUncompressedBytes, "ZIP contents");
      files.push({ contents, path: paths[index] });
    }

    validateTransferPaths(files);
    return stripCommonRoot(files);
  } finally {
    await reader.close();
  }
}

export function readMarkdownFolder(files: FileList | File[]): MarkdownTransferFile[] {
  const entries = [...files].map((file) => ({
    contents: file,
    path: validateRelativePath(file.webkitRelativePath || file.name),
  }));
  validateTransferPaths(entries);
  const stripped = stripCommonRoot(entries);
  validateTransferPaths(stripped);
  return stripped;
}

export async function importMarkdownFiles(
  vault: Vault,
  files: MarkdownTransferFile[],
): Promise<MarkdownImportResult> {
  const entries = normalizeEntries(files);
  const notes = entries.filter((file) => isMarkdownPath(file.path));
  if (notes.length === 0) throw new Error("No Markdown files were found.");

  const attachments = entries.filter((file) => !isMarkdownPath(file.path));
  const markdown = await Promise.all(
    notes.map(async (file) => ({ file, text: await file.contents.text() })),
  );
  const attachmentsByNote = new Map<string, MarkdownTransferFile[]>();
  for (const attachment of attachments) {
    const ownerPath = findAttachmentOwner(attachment.path, markdown).file.path;
    const owned = attachmentsByNote.get(ownerPath) ?? [];
    owned.push(attachment);
    attachmentsByNote.set(ownerPath, owned);
  }

  return vault.importNotes(
    markdown.map((note) => ({
      attachments: (attachmentsByNote.get(note.file.path) ?? []).map((attachment) => ({
        contents: attachment.contents,
        name: basename(attachment.path),
        sourcePath: attachment.path,
      })),
      markdown: note.text,
      sourcePath: note.file.path,
      title: titleFromMarkdown(
        note.text,
        basename(note.file.path).replace(/\.(?:md|markdown)$/i, "") || "Untitled",
      ),
    })),
  );
}

export async function createMarkdownExport(vault: Vault): Promise<MarkdownTransferFile[]> {
  const [notes, attachments] = await Promise.all([vault.listNotes(), vault.listAttachments()]);
  const records: ExportRecord[] = [];
  const paths = new Set<string>();

  for (const note of notes.toReversed()) {
    const value = await vault.getNote(note.id);
    if (!value) continue;
    const fallback = `${safeName(note.title)}.md`;
    const sourcePath = normalizeExportPath(note.sourcePath, fallback);
    const path = uniquePath(sourcePath, paths);
    records.push({
      contents: new Blob([value.markdown], { type: "text/markdown;charset=utf-8" }),
      kind: "note",
      linkSourcePath: note.sourcePath ? sourcePath : path,
      path,
      sourcePath,
    });
  }

  for (const metadata of attachments) {
    const attachment = await vault.getAttachment(metadata.id);
    if (!attachment) continue;
    const fallback = `attachments/${safeName(metadata.name)}`;
    const sourcePath = normalizeExportPath(metadata.sourcePath, fallback);
    const path = uniquePath(sourcePath, paths);
    records.push({
      contents: attachment.file,
      kind: "attachment",
      linkSourcePath: sourcePath,
      name: metadata.name,
      path,
      sourcePath,
    });
  }

  const lookup = createExportPathLookup(records);
  return Promise.all(
    records.map(async (record) => {
      if (record.kind !== "note") return record;
      const markdown = await rewriteMarkdownLinks(
        record.contents,
        record.linkSourcePath,
        record.path,
        lookup,
      );
      return {
        ...record,
        contents: new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
      };
    }),
  );
}

export async function createMarkdownZip(
  files: MarkdownTransferFile[],
  limits?: MarkdownTransferLimits,
): Promise<Blob> {
  const resolvedLimits = resolveTransferLimits(limits);
  validateTransferFiles(files, resolvedLimits);

  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const file of files) await writer.add(file.path, new BlobReader(file.contents));
  const archive = await writer.close();
  assertWithinLimit(archive.size, resolvedLimits.maxArchiveBytes, "ZIP archive");
  return archive;
}

export async function writeMarkdownFolder(
  root: FileSystemDirectoryHandle,
  files: MarkdownTransferFile[],
): Promise<void> {
  validateTransferPaths(files);

  const conflicts = (
    await Promise.all(
      files.map(async (file) => ((await exportPathExists(root, file.path)) ? file.path : "")),
    )
  ).filter(Boolean);
  if (conflicts.length > 0) {
    const shown = conflicts.slice(0, 3).join(", ");
    const remaining = conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : "";
    throw new Error(
      `Export stopped because existing files would be overwritten: ${shown}${remaining}. Choose an empty folder.`,
    );
  }

  const createdDirectories: CreatedDirectory[] = [];
  const createdFiles: CreatedFile[] = [];
  try {
    for (const file of files) {
      const parts = file.path.split("/");
      const name = parts.pop();
      if (!name) continue;
      let directory = root;
      for (const part of parts) {
        directory = await getOrCreateDirectory(directory, part, createdDirectories);
      }

      const handle = await directory.getFileHandle(name, { create: true });
      createdFiles.push({ name, parent: directory });
      const writable = await handle.createWritable();
      try {
        await writable.write(file.contents);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
      }
    }
  } catch (error) {
    const rollbackErrors = await rollbackFolderExport(createdFiles, createdDirectories);
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Folder export failed and could not be fully rolled back",
      );
    }
    throw error;
  }
}

async function exportPathExists(root: FileSystemDirectoryHandle, path: string): Promise<boolean> {
  const parts = path.split("/");
  const name = parts.pop();
  if (!name) return true;
  let directory = root;
  try {
    for (const part of parts) directory = await directory.getDirectoryHandle(part);
  } catch (error) {
    if (isMissingEntry(error)) return false;
    if (isTypeMismatch(error)) return true;
    throw error;
  }

  try {
    await directory.getFileHandle(name);
    return true;
  } catch (error) {
    if (!isMissingEntry(error) && !isTypeMismatch(error)) throw error;
  }
  try {
    await directory.getDirectoryHandle(name);
    return true;
  } catch (error) {
    if (isMissingEntry(error) || isTypeMismatch(error)) return false;
    throw error;
  }
}

async function getOrCreateDirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
  createdDirectories: CreatedDirectory[],
): Promise<FileSystemDirectoryHandle> {
  try {
    return await parent.getDirectoryHandle(name);
  } catch (error) {
    if (!isMissingEntry(error)) throw error;
    const directory = await parent.getDirectoryHandle(name, { create: true });
    createdDirectories.push({ name, parent });
    return directory;
  }
}

async function rollbackFolderExport(
  createdFiles: CreatedFile[],
  createdDirectories: CreatedDirectory[],
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const file of createdFiles.toReversed()) {
    try {
      await file.parent.removeEntry(file.name);
    } catch (error) {
      if (!isMissingEntry(error)) errors.push(error);
    }
  }
  for (const directory of createdDirectories.toReversed()) {
    try {
      await directory.parent.removeEntry(directory.name, { recursive: true });
    } catch (error) {
      if (!isMissingEntry(error)) errors.push(error);
    }
  }
  return errors;
}

function isMissingEntry(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

function isTypeMismatch(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TypeMismatchError";
}

function normalizeEntries(files: MarkdownTransferFile[]): MarkdownTransferFile[] {
  const entries = files.flatMap((file) => {
    const path = validateRelativePath(file.path);
    if (path === "__MACOSX" || path.startsWith("__MACOSX/")) return [];
    return [{ ...file, path }];
  });
  validateTransferFiles(entries, resolveTransferLimits());
  return entries;
}

function stripCommonRoot(files: MarkdownTransferFile[]): MarkdownTransferFile[] {
  const root = files[0]?.path.split("/")[0];
  if (!root || !files.every((file) => file.path.startsWith(`${root}/`))) return files;
  return files.map((file) => ({ ...file, path: file.path.slice(root.length + 1) }));
}

function validateTransferFiles(
  files: MarkdownTransferFile[],
  limits: ResolvedTransferLimits,
): void {
  validateTransferPaths(files);
  assertEntryCount(files.length, limits.maxEntries);
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.contents.size;
    assertWithinLimit(totalBytes, limits.maxUncompressedBytes, "Markdown transfer contents");
  }
}

function validateTransferPaths(files: MarkdownTransferFile[]): void {
  const paths = new Set<string>();
  for (const file of files) {
    const path = validateRelativePath(file.path);
    if (path !== file.path) throw new Error(`Unsafe transfer path: ${file.path}`);
    const key = pathKey(path);
    if (hasPathCollision(path, paths)) {
      throw new Error(
        `${paths.has(key) ? "Duplicate" : "Conflicting"} transfer path: ${file.path}`,
      );
    }
    paths.add(key);
  }
}

function validateArchivePath(entry: Entry): string {
  return validateRelativePath(entry.filename, { allowDirectory: entry.directory });
}

function validateRelativePath(path: string, options: { allowDirectory?: boolean } = {}): string {
  if (!path || path.includes("\\") || /^[\\/]/.test(path) || /^[a-z]:/i.test(path)) {
    throw new Error(`Unsafe transfer path: ${path || "(empty)"}`);
  }
  if (hasControlCharacters(path)) {
    throw new Error(`Unsafe transfer path: ${path}`);
  }

  const parts = path.split("/");
  if (options.allowDirectory && parts.at(-1) === "") parts.pop();
  if (
    parts.length === 0 ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[<>:"|?*]/u.test(part) ||
        /[. ]$/u.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(part),
    ) ||
    (!options.allowDirectory && path.endsWith("/"))
  ) {
    throw new Error(`Unsafe transfer path: ${path}`);
  }
  return parts.join("/");
}

function assertEntryCount(count: number, limit: number): void {
  if (count > limit)
    throw new Error(`Transfer contains more than ${limit.toLocaleString()} entries.`);
}

function assertWithinLimit(value: number, limit: number, label: string): void {
  if (!Number.isSafeInteger(value) || value > limit) {
    throw new Error(`${label} exceeds the ${formatBytes(limit)} limit.`);
  }
}

function resolveTransferLimits(limits: MarkdownTransferLimits = {}): ResolvedTransferLimits {
  const resolved = {
    maxArchiveBytes: limits.maxArchiveBytes ?? MAX_ARCHIVE_SIZE,
    maxEntries: limits.maxEntries ?? MAX_ARCHIVE_ENTRIES,
    maxUncompressedBytes: limits.maxUncompressedBytes ?? MAX_ARCHIVE_UNCOMPRESSED_SIZE,
  };
  if (
    !Number.isSafeInteger(resolved.maxArchiveBytes) ||
    resolved.maxArchiveBytes <= 0 ||
    !Number.isSafeInteger(resolved.maxEntries) ||
    resolved.maxEntries <= 0 ||
    !Number.isSafeInteger(resolved.maxUncompressedBytes) ||
    resolved.maxUncompressedBytes <= 0
  ) {
    throw new Error("Markdown transfer limits must be positive safe integers.");
  }
  return resolved;
}

function formatBytes(bytes: number): string {
  return bytes % BYTES_PER_MEBIBYTE === 0
    ? `${bytes / BYTES_PER_MEBIBYTE} MiB`
    : `${bytes.toLocaleString()} bytes`;
}

function pathKey(path: string): string {
  return path.toLowerCase();
}

function createLimitedBlobWriter(
  contentTypeValue: string,
  maxBytes: number,
): {
  getData: () => Promise<Blob>;
  writable: WritableStream<Uint8Array>;
} {
  const chunks: BlobPart[] = [];
  let size = 0;
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      size += chunk.byteLength;
      if (size > maxBytes) {
        throw new Error("ZIP contents exceed the " + formatBytes(maxBytes) + " limit.");
      }
      chunks.push(new Uint8Array(chunk));
    },
  });
  return {
    getData: async () => new Blob(chunks, { type: contentTypeValue }),
    writable,
  };
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function findAttachmentOwner(
  path: string,
  notes: Array<{ file: MarkdownTransferFile; text: string }>,
): { file: MarkdownTransferFile; text: string } {
  const linked = notes.find((note) => referencedPaths(note.text, note.file.path).has(path));
  if (linked) return linked;
  return notes.toSorted(
    (left, right) =>
      commonDirectoryDepth(path, right.file.path) - commonDirectoryDepth(path, left.file.path),
  )[0];
}

function referencedPaths(markdown: string, notePath: string): Set<string> {
  const references = new Set<string>();
  const directory = dirname(notePath);
  for (const destination of markdownLinkDestinations(markdown)) {
    const withoutSuffix = destination.split(/[?#]/, 1)[0];
    const resolved = resolveRelativePath(directory, decodePath(withoutSuffix));
    if (resolved) references.add(resolved);
  }
  return references;
}

function markdownLinkDestinations(markdown: string): string[] {
  const destinations = [
    ...markdown.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))/g),
    ...markdown.matchAll(/!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g),
  ];
  return destinations
    .map((match) => match[1] ?? match[2])
    .filter((destination): destination is string => Boolean(destination));
}

function createExportPathLookup(records: ExportRecord[]): ExportPathLookup {
  const bySourcePath = new Map<string, string | undefined>();
  const attachmentsBySourcePath = new Map<string, string | undefined>();
  const attachmentsByName = new Map<string, string | undefined>();
  for (const record of records) {
    addPathMapping(bySourcePath, record.sourcePath, record.path);
    if (record.kind === "attachment") {
      addPathMapping(attachmentsBySourcePath, record.sourcePath, record.path);
      addPathMapping(attachmentsByName, record.name ?? basename(record.path), record.path);
    }
  }
  return { attachmentsByName, attachmentsBySourcePath, bySourcePath };
}

function addPathMapping(
  map: Map<string, string | undefined>,
  sourcePath: string,
  exportPath: string,
): void {
  const key = pathKey(sourcePath);
  if (!map.has(key)) {
    map.set(key, exportPath);
  } else if (map.get(key) !== exportPath) {
    map.set(key, undefined);
  }
}

async function rewriteMarkdownLinks(
  contents: Blob,
  sourceNotePath: string,
  exportNotePath: string,
  lookup: ExportPathLookup,
): Promise<string> {
  const markdown = await contents.text();
  const directory = dirname(sourceNotePath);
  const exportDirectory = dirname(exportNotePath);
  const rewrite = (destination: string): string | undefined => {
    const suffixIndex = destination.search(/[?#]/);
    const path = suffixIndex === -1 ? destination : destination.slice(0, suffixIndex);
    const suffix = suffixIndex === -1 ? "" : destination.slice(suffixIndex);
    const resolved = resolveRelativePath(directory, decodePath(path));
    if (!resolved) return;

    let exportPath: string | undefined;
    const sourceKey = pathKey(resolved);
    if (lookup.attachmentsBySourcePath.has(sourceKey)) {
      exportPath = lookup.attachmentsBySourcePath.get(sourceKey);
    } else if (lookup.bySourcePath.has(sourceKey)) {
      exportPath = lookup.bySourcePath.get(sourceKey);
    } else {
      exportPath = lookup.attachmentsByName.get(pathKey(basename(resolved)));
    }
    if (!exportPath) return;
    return `${encodeTransferPath(relativePath(exportDirectory, exportPath))}${suffix}`;
  };

  const withInlineLinks = markdown.replace(
    /(!?\[[^\]]*\]\(\s*)(<[^>\n]+>|[^\s)\n]+)/g,
    (match, prefix: string, destination: string) => {
      const angleBrackets = destination.startsWith("<") && destination.endsWith(">");
      const rawDestination = angleBrackets ? destination.slice(1, -1) : destination;
      const rewritten = rewrite(rawDestination);
      if (!rewritten) return match;
      return `${prefix}${angleBrackets ? `<${rewritten}>` : rewritten}`;
    },
  );
  return withInlineLinks.replace(
    /(!?\[\[)([^\]|#]+)(?=\||#|\]\])/g,
    (match, prefix: string, destination: string) => {
      const rewritten = rewrite(destination);
      return rewritten ? `${prefix}${rewritten}` : match;
    },
  );
}

function resolveRelativePath(directory: string, destination: string): string | undefined {
  if (
    !destination ||
    destination.includes("\\") ||
    /^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(destination)
  ) {
    return;
  }
  const parts: string[] = [];
  for (const part of `${directory}/${destination}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/") || undefined;
}

function relativePath(directory: string, target: string): string {
  const fromParts = directory ? directory.split("/") : [];
  const targetParts = target.split("/");
  let common = 0;
  while (fromParts[common] && fromParts[common] === targetParts[common]) common += 1;
  return [...fromParts.slice(common).map(() => ".."), ...targetParts.slice(common)].join("/");
}

function encodeTransferPath(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function normalizeExportPath(sourcePath: string | undefined, fallback: string): string {
  return validateRelativePath(sourcePath || fallback);
}

function uniquePath(path: string, paths: Set<string>): string {
  if (!hasPathCollision(path, paths)) {
    paths.add(pathKey(path));
    return path;
  }
  if (hasExistingAncestor(path, paths)) {
    throw new Error(`Conflicting export paths: ${path}`);
  }

  const dot = path.lastIndexOf(".");
  const base = dot > path.lastIndexOf("/") ? path.slice(0, dot) : path;
  const extension = dot > path.lastIndexOf("/") ? path.slice(dot) : "";
  let index = 2;
  while (hasPathCollision(`${base}-${index}${extension}`, paths)) index += 1;
  const result = `${base}-${index}${extension}`;
  paths.add(pathKey(result));
  return result;
}

function hasPathCollision(path: string, paths: Set<string>): boolean {
  const key = pathKey(path);
  return [...paths].some(
    (existingKey) =>
      existingKey === key || existingKey.startsWith(`${key}/`) || key.startsWith(`${existingKey}/`),
  );
}

function hasExistingAncestor(path: string, paths: Set<string>): boolean {
  const parts = path.split("/");
  return parts
    .slice(0, -1)
    .some((_, index) => paths.has(pathKey(parts.slice(0, index + 1).join("/"))));
}

function commonDirectoryDepth(left: string, right: string): number {
  const leftParts = dirname(left).split("/");
  const rightParts = dirname(right).split("/");
  let depth = 0;
  while (leftParts[depth] && leftParts[depth] === rightParts[depth]) depth += 1;
  return depth;
}

function dirname(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function safeName(value: string): string {
  let withoutControlCharacters = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    withoutControlCharacters += code < 32 || code === 127 ? "-" : character;
  }
  return (
    withoutControlCharacters
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/[. ]+$/g, "")
      .trim() || "Untitled"
  );
}

function contentType(path: string): string {
  if (isMarkdownPath(path)) return "text/markdown;charset=utf-8";
  const extension = path.slice(path.lastIndexOf(".") + 1).toLocaleLowerCase();
  return (
    {
      gif: "image/gif",
      jpeg: "image/jpeg",
      jpg: "image/jpeg",
      pdf: "application/pdf",
      png: "image/png",
      svg: "image/svg+xml",
      webp: "image/webp",
    }[extension] ?? "application/octet-stream"
  );
}

function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path);
}
