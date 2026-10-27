"use server";

import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { revalidatePath } from "next/cache";

import { requireUser, getUser } from "@/lib/auth/session";
import { integerEnv } from "@/lib/env-config";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/db";
import { projects, publicFiles } from "@/db/schema";
import { getOwnedProject } from "./actions";
import {
  affectsProtectedWorkspacePath,
  PROTECTED_WORKSPACE_MESSAGE,
} from "@/lib/protected-workspace";
import { isResearchWorkspaceDirectory } from "@/lib/research-workspace";
import {
  destinationNameTaken,
  nameConflictMessage,
} from "@/lib/workspace-name-conflict";
import {
  copyAgentWorkspacePath,
  createAgentWorkspaceDirectory,
  deleteAgentWorkspacePath,
  getAgentWorkspaceRootTree,
  listAgentWorkspaceFiles,
  listAgentWorkspaceFilesRecursive,
  listWorkspaceFilesRecursive,
  moveAgentWorkspacePath,
  readAgentWorkspaceFile,
  writeAgentWorkspaceFile,
  type WorkspaceFileEntry,
  type WorkspaceRootTree,
} from "@/lib/workspace-files";
import { isVisibleWorkspaceEntry } from "@/lib/workspace-entry-visibility";
import { moveKnowledgePaths, removeKnowledgeUnderPaths } from "@/lib/knowledge";

export type FileEntry = WorkspaceFileEntry;
export type RootTree = WorkspaceRootTree;

function visibleRootTree(tree: RootTree): RootTree {
  return {
    entries: tree.entries.filter(isVisibleWorkspaceEntry),
    children: Object.fromEntries(
      Object.entries(tree.children).map(([folderPath, entries]) => [
        folderPath,
        entries.filter(isVisibleWorkspaceEntry),
      ]),
    ),
  };
}

function assertProtectedWorkspaceUnaffected(...filePaths: string[]) {
  if (filePaths.some(affectsProtectedWorkspacePath)) {
    throw new Error(PROTECTED_WORKSPACE_MESSAGE);
  }
}

function assertResearchDirectoryNotReplaced(filePath: string) {
  if (isResearchWorkspaceDirectory(filePath)) {
    throw new Error(PROTECTED_WORKSPACE_MESSAGE);
  }
}

async function assertDestinationNameAvailable(
  userId: string,
  projectId: string,
  destinationPath: string,
  ignorePath?: string,
) {
  const parent = path.posix.dirname(destinationPath);
  const parentPath = parent === "." ? "" : parent;
  const name = path.posix.basename(destinationPath);
  const siblings = await listAgentWorkspaceFiles(userId, projectId, parentPath);
  if (destinationNameTaken(siblings, name, ignorePath)) {
    throw new Error(nameConflictMessage(name));
  }
}

// publicFiles records are keyed by path, not by file identity, so every
// rename/move/delete must carry them along: a stale record dead-ends its share
// link, and a record left behind on a deleted path would silently publish any
// future file created at that path. Both helpers fetch the project's records
// and filter in JS — precise prefix matching without SQL LIKE metacharacter
// surprises in file names, at a scale (a handful of shares per project) where
// that is free.
async function deletePublicRecordsUnderPath(
  userId: string,
  projectId: string,
  paths: string[],
) {
  const project = await getOwnedProject({ id: userId }, projectId);
  if (!project) return;
  const records = await db.query.publicFiles.findMany({
    where: eq(publicFiles.projectId, project.id),
  });
  const doomed = records
    .filter((record) =>
      paths.some(
        (p) => record.filePath === p || record.filePath.startsWith(`${p}/`),
      ),
    )
    .map((record) => record.id);
  if (doomed.length > 0) {
    await db.delete(publicFiles).where(inArray(publicFiles.id, doomed));
  }
}

async function movePublicRecordsUnderPath(
  userId: string,
  projectId: string,
  sourcePath: string,
  destinationPath: string,
) {
  const project = await getOwnedProject({ id: userId }, projectId);
  if (!project) return;
  const records = await db.query.publicFiles.findMany({
    where: eq(publicFiles.projectId, project.id),
  });
  const affected = records.filter(
    (record) =>
      record.filePath === sourcePath ||
      record.filePath.startsWith(`${sourcePath}/`),
  );
  if (affected.length === 0) return;

  // The moved tree takes over its records; drop anything already sitting at
  // the destination so the (projectId, filePath) unique key holds.
  const stale = records
    .filter(
      (record) =>
        !affected.includes(record) &&
        (record.filePath === destinationPath ||
          record.filePath.startsWith(`${destinationPath}/`)),
    )
    .map((record) => record.id);
  if (stale.length > 0) {
    await db.delete(publicFiles).where(inArray(publicFiles.id, stale));
  }

  for (const record of affected) {
    const movedPath =
      destinationPath + record.filePath.slice(sourcePath.length);
    await db
      .update(publicFiles)
      .set({ filePath: movedPath })
      .where(eq(publicFiles.id, record.id));
  }
}

export async function listFiles(projectId: string, subpath = ""): Promise<FileEntry[]> {
  const user = await requireUser();
  try {
    const entries = await listAgentWorkspaceFiles(user.id, projectId, subpath);
    return entries.filter(isVisibleWorkspaceEntry);
  } catch (error) {
    console.error("[listFiles] agent workspace failed", error);
    return [];
  }
}

export async function getRootTree(projectId: string): Promise<RootTree> {
  const user = await requireUser();
  try {
    return visibleRootTree(await getAgentWorkspaceRootTree(user.id, projectId));
  } catch (error) {
    console.error("[getRootTree] agent workspace failed", error);
    return { entries: [], children: {} };
  }
}

/** Reuse one bounded local directory walk for the explorer and rail panels. */
export async function getInitialWorkspaceListing(projectId: string): Promise<{ rootTree: RootTree; allFiles?: FileEntry[] }> {
  const user = await requireUser();
  const maxEntries = integerEnv("WORKSPACE_LIST_MAX_ENTRIES", 2_000, 1);
  try {
    const listing = await listWorkspaceFilesRecursive(user.id, projectId, maxEntries);
    if (listing.truncated) return { rootTree: await getRootTree(projectId) };
    const allFiles = listing.entries.filter(isVisibleWorkspaceEntry);
    const entries: FileEntry[] = [];
    const children: Record<string, FileEntry[]> = {};
    for (const entry of allFiles) {
      const separator = entry.path.lastIndexOf("/");
      const parent = separator < 0 ? "" : entry.path.slice(0, separator);
      if (!parent) entries.push(entry);
      else if (!parent.includes("/")) (children[parent] ??= []).push(entry);
    }
    for (const entry of entries) {
      if (entry.isDir) children[entry.path] ??= [];
    }
    return { rootTree: { entries, children }, allFiles };
  } catch (error) {
    console.error("[getInitialWorkspaceListing] local workspace failed", error);
    return { rootTree: await getRootTree(projectId) };
  }
}

export async function listAllFiles(projectId: string): Promise<FileEntry[]> {
  const user = await requireUser();
  const maxEntries = integerEnv("WORKSPACE_LIST_MAX_ENTRIES", 2_000, 1);
  try {
    // Single recursive agent request (with a per-folder fan-out fallback for
    // older agents) instead of one round trip per folder.
    const entries = await listAgentWorkspaceFilesRecursive(user.id, projectId, maxEntries);
    return entries.filter(isVisibleWorkspaceEntry);
  } catch (error) {
    console.error("[listAllFiles] agent workspace failed", error);
    return [];
  }
}

export async function deleteFile(projectId: string, filePath: string) {
  const user = await requireUser();
  assertProtectedWorkspaceUnaffected(filePath);
  await removeKnowledgeUnderPaths(user.id, projectId, [filePath]);
  await deleteAgentWorkspacePath(user.id, projectId, filePath);
  await deletePublicRecordsUnderPath(user.id, projectId, [filePath]);
  revalidatePath(`/${projectId}`);
}

export async function deleteFiles(projectId: string, filePaths: string[]) {
  const user = await requireUser();
  assertProtectedWorkspaceUnaffected(...filePaths);
  await removeKnowledgeUnderPaths(user.id, projectId, filePaths);
  for (const filePath of filePaths) {
    await deleteAgentWorkspacePath(user.id, projectId, filePath);
  }
  await deletePublicRecordsUnderPath(user.id, projectId, filePaths);
  revalidatePath(`/${projectId}`);
}

export async function renameFile(projectId: string, filePath: string, newName: string) {
  const user = await requireUser();
  const parent = path.posix.dirname(filePath);
  const destination = path.posix.join(
    parent === "." ? "" : parent,
    path.posix.basename(newName),
  );
  assertProtectedWorkspaceUnaffected(filePath, destination);
  if (destination !== filePath) {
    await assertDestinationNameAvailable(user.id, projectId, destination, filePath);
  }
  await moveAgentWorkspacePath(user.id, projectId, filePath, destination);
  await movePublicRecordsUnderPath(user.id, projectId, filePath, destination);
  await moveKnowledgePaths(user.id, projectId, filePath, destination);
  revalidatePath(`/${projectId}`);
}

export async function getFileContent(projectId: string, filePath: string) {
  const user = await getUser();

  // slug is unique per user, not globally: every user's demo project shares
  // one slug. Owners resolve their own row; everyone else resolves through a
  // public record so the exact shared project is used, not an arbitrary
  // same-slug row.
  const owned = user
    ? await db.query.projects.findFirst({
        where: and(eq(projects.slug, projectId), eq(projects.userId, user.id)),
      })
    : null;

  let ownerUserId: string;
  if (owned) {
    ownerUserId = owned.userId;
  } else {
    const [shared] = await db
      .select({ userId: projects.userId })
      .from(publicFiles)
      .innerJoin(projects, eq(publicFiles.projectId, projects.id))
      .where(and(eq(projects.slug, projectId), eq(publicFiles.filePath, filePath)))
      .limit(1);
    if (!shared) {
      console.error("[getFileContent] Unauthorized access attempt");
      return null;
    }
    ownerUserId = shared.userId;
  }

  try {
    const response = await readAgentWorkspaceFile(ownerUserId, projectId, filePath);
    return await response.text();
  } catch (error) {
    console.error("[getFileContent] agent workspace failed", error);
    return null;
  }
}

export async function saveFile(projectId: string, filePath: string, content: string) {
  const user = await requireUser();
  assertResearchDirectoryNotReplaced(filePath);
  await writeAgentWorkspaceFile(user.id, projectId, filePath, content);
  revalidatePath(`/${projectId}`);
  return { success: true };
}

export async function renderOfficeDocument(projectId: string, filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (![".doc", ".docx", ".odt", ".ppt"].includes(extension)) {
    return { success: false as const, error: "Unsupported document format." };
  }
  const user = await requireUser();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "beeblio-office-"));
  try {
    const response = await readAgentWorkspaceFile(user.id, projectId, filePath);
    const input = new Uint8Array(await response.arrayBuffer());
    const source = path.join(temporary, `document${extension}`);
    await fs.writeFile(source, input);
    await promisify(execFile)("soffice", [
      "--headless",
      `-env:UserInstallation=${pathToFileURL(path.join(temporary, "profile")).href}`,
      "--convert-to", "pdf", "--outdir", temporary, source,
    ], { timeout: 120_000 });
    const pdf = await fs.readFile(path.join(temporary, "document.pdf"));
    return { success: true as const, kind: "pdf" as const, content: Buffer.from(pdf).toString("base64") };
  } catch (error) {
    console.error("[office-preview] rendering failed", error);
    return { success: false as const, error: "Install LibreOffice to preview this document locally." };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

export async function extractLegacyOfficeText(projectId: string, filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (![".doc", ".ppt"].includes(extension)) return { success: false as const, error: "Unsupported legacy Office format." };
  const user = await requireUser();
  try {
    const response = await readAgentWorkspaceFile(user.id, projectId, filePath);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (extension === ".ppt") {
      const { toMarkdown } = await import("@mdgate/ppt");
      return { success: true as const, content: await toMarkdown(new Uint8Array(buffer)), format: "markdown" as const };
    }
    const imported = await import("word-extractor");
    const WordExtractor = imported.default;
    const extracted = await new WordExtractor().extract(buffer);
    const sections = [extracted.getBody(), extracted.getFootnotes(), extracted.getEndnotes(), extracted.getHeaders(), extracted.getTextboxes()].filter(Boolean);
    return { success: true as const, content: sections.join("\n\n"), format: "text" as const };
  } catch (error) {
    console.error("[legacy-office-extract] parsing failed", error);
    return { success: false as const, error: `Unable to parse this ${extension.slice(1).toUpperCase()} file.` };
  }
}

export async function createDirectory(projectId: string, parentPath: string, name: string) {
  const folderName = name.trim();
  if (!folderName || folderName === "." || folderName === ".." || path.posix.basename(folderName) !== folderName) {
    throw new Error("Enter a valid folder name without slashes.");
  }
  const user = await requireUser();
  const directoryPath = path.posix.join(parentPath, folderName);
  assertResearchDirectoryNotReplaced(directoryPath);
  await assertDestinationNameAvailable(user.id, projectId, directoryPath);
  await createAgentWorkspaceDirectory(user.id, projectId, directoryPath);
  revalidatePath(`/${projectId}`);
}

export async function movePath(
  projectId: string,
  sourcePath: string,
  destinationPath: string,
) {
  const user = await requireUser();
  assertProtectedWorkspaceUnaffected(sourcePath, destinationPath);
  if (destinationPath !== sourcePath) {
    await assertDestinationNameAvailable(user.id, projectId, destinationPath, sourcePath);
  }
  await moveAgentWorkspacePath(user.id, projectId, sourcePath, destinationPath);
  await movePublicRecordsUnderPath(user.id, projectId, sourcePath, destinationPath);
  await moveKnowledgePaths(user.id, projectId, sourcePath, destinationPath);
  revalidatePath(`/${projectId}`);
}

export async function copyPath(
  projectId: string,
  sourcePath: string,
  destinationPath: string,
) {
  const user = await requireUser();
  assertResearchDirectoryNotReplaced(destinationPath);
  await assertDestinationNameAvailable(user.id, projectId, destinationPath);
  await copyAgentWorkspacePath(user.id, projectId, sourcePath, destinationPath);
  revalidatePath(`/${projectId}`);
}

export async function duplicateFiles(projectId: string, sourcePaths: string[]) {
  const user = await requireUser();
  const entriesByParent = new Map<string, FileEntry[]>();
  const destinations: string[] = [];

  for (const sourcePath of sourcePaths) {
    const parent = path.posix.dirname(sourcePath);
    const parentPath = parent === "." ? "" : parent;
    let siblings = entriesByParent.get(parentPath);
    if (!siblings) {
      siblings = await listAgentWorkspaceFiles(user.id, projectId, parentPath);
      entriesByParent.set(parentPath, siblings);
    }

    const source = siblings.find((entry) => entry.path === sourcePath);
    if (!source) throw new Error(`File not found: ${sourcePath}`);
    if (source.isDir) throw new Error("Folders cannot be duplicated from the file explorer.");

    const extension = path.posix.extname(source.name);
    const stem = extension ? source.name.slice(0, -extension.length) : source.name;
    const siblingNames = new Set(siblings.map((entry) => entry.name));
    let copyNumber = 1;
    let duplicateName = `${stem} copy${extension}`;
    while (siblingNames.has(duplicateName)) {
      copyNumber += 1;
      duplicateName = `${stem} copy ${copyNumber}${extension}`;
    }

    const destination = path.posix.join(parentPath, duplicateName);
    await copyAgentWorkspacePath(user.id, projectId, sourcePath, destination);
    siblings.push({ ...source, name: duplicateName, path: destination });
    destinations.push(destination);
  }

  revalidatePath(`/${projectId}`);
  return destinations;
}
