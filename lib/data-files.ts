// Structured data files stored in the workspace (datasets for analysis):
// they get an "Analyze" action in the file browsers' context menus that asks
// Beeblio AI to profile them in the chat.

export const DATA_FILE_EXTENSIONS = [
  // Spreadsheets
  "csv", "tsv", "xls", "xlsx", "ods",
  // JSON-shaped datasets
  "json", "jsonl", "ndjson",
  // Statistics-package formats
  "parquet", "sav", "dta", "rds", "rdata",
] as const;

export function isDataFileName(name: string) {
  return DATA_FILE_EXTENSIONS.includes(
    (name.split(".").pop() ?? "").toLowerCase() as (typeof DATA_FILE_EXTENSIONS)[number],
  );
}
