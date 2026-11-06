import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  text,
  unique,
  sqliteTable,
} from "drizzle-orm/sqlite-core";

/** Local application data. Project files live in their linked folders. */

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    // Fixed local owner ID.
    userId: text("user_id").notNull(),
    slug: text("slug").notNull(), // unique per user, route key
    folderPath: text("folder_path"), // absolute path to an existing local folder
    name: text("name").notNull(),
    description: text("description"), // optional project description
    // Per-project user preferences (lib/project-settings.ts parses the shape).
    settings: text("settings", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    deletedAt: integer("deleted_at", { mode: "timestamp" }), // soft delete
    // updated_at stamps on insert only; bump it explicitly on mutations.
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    unique("projects_user_id_slug_key").on(t.userId, t.slug),
    index("idx_projects_user_id").on(t.userId),
  ],
);

export const agentSessions = sqliteTable(
  "agent_sessions",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    // Nullable: the eve session is created lazily on the first message, not at
    // row creation. Unique where set so a given eve session maps to one row.
    eveSessionId: text("eve_session_id").unique(),
    // Serialized eve ClientSession.state ({sessionId, continuationToken,
    // streamIndex}); persisted after each turn to enable session resume.
    state: text("state", { mode: "json" }),
    // Final authoritative Eve event log. Completed conversations render this
    // directly instead of replaying the durable stream over the network.
    events: text("events", { mode: "json" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title"),
    status: text("status").notNull().default("active"),
    runStatus: text("run_status").notNull().default("idle"),
    runStatusAt: integer("run_status_at", { mode: "timestamp_ms" }),
    lastViewedAt: integer("last_viewed_at", { mode: "timestamp_ms" }),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    lastActiveAt: integer("last_active_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    check(
      "agent_sessions_status_check",
      sql`${t.status} in ('active', 'archived', 'deleted')`,
    ),
    check("agent_sessions_run_status_check", sql`${t.runStatus} in ('idle', 'running', 'needs_input', 'finished', 'failed')`),
    index("idx_agent_sessions_project_id").on(t.projectId),
  ],
);

export const knowledgeStores = sqliteTable("knowledge_stores", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" })
    .unique(),
  providerStoreName: text("provider_store_name").notNull().unique(),
  embeddingModel: text("embedding_model").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const knowledgeDocuments = sqliteTable(
  "knowledge_documents",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    storeId: text("store_id")
      .notNull()
      .references(() => knowledgeStores.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    displayName: text("display_name").notNull(),
    sourceEtag: text("source_etag"),
    sourceSizeBytes: integer("source_size_bytes").notNull(),
    providerDocumentName: text("provider_document_name").unique(),
    operationName: text("operation_name"),
    status: text("status").notNull().default("indexing"),
    lastError: text("last_error"),
    indexedAt: integer("indexed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    unique("knowledge_documents_project_path_key").on(t.projectId, t.filePath),
    index("knowledge_documents_project_status_idx").on(t.projectId, t.status),
    check("knowledge_documents_status_check", sql`${t.status} in ('indexing', 'ready', 'failed', 'removing')`),
  ],
);

export const publicFiles = sqliteTable(
  "public_files",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    unique("public_files_project_path_key").on(t.projectId, t.filePath),
  ],
);
