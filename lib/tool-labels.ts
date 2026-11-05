import {
  AudioLinesIcon,
  BotIcon,
  CircleHelpIcon,
  ClipboardListIcon,
  CopyIcon,
  DatabaseIcon,
  FileOutputIcon,
  FilePenIcon,
  FileTextIcon,
  FlagIcon,
  FileIcon,
  FolderPlusIcon,
  FolderSearchIcon,
  GlobeIcon,
  GraduationCapIcon,
  ImageIcon,
  ListTodoIcon,
  MicIcon,
  SearchIcon,
  HammerIcon,
  SquarePenIcon,
  TableIcon,
  TerminalIcon,
  WorkflowIcon,
  LibraryIcon,
  BrushIcon,
  type LucideIcon,
} from "lucide-react";
import type { EveDynamicToolPart } from "eve/react";

export type ToolCallDescription = {
  /** Ready-to-display action label, or undefined for unknown tools. */
  readonly label?: string;
  /** Short context shown next to the label (file name, query, host). */
  readonly detail?: string;
  /** Per-tool icon for the tool log rows, or undefined to fall back to the
   * generic activity heuristics in the tool components. */
  readonly icon?: LucideIcon;
}

// Maps raw tool names (developer-facing, snake_case) to short user-facing
// action labels for the chat tool log. Unmapped tools fall back to the
// title-cased raw name rendered by the tool components.
const TOOL_LABELS: Record<string, string> = {
  // eve framework tools
  agent: "Delegate Task",
  ask_question: "Ask Question",
  bash: "Run Command",
  final_output: "Final Answer",
  glob: "Find Files",
  grep: "Search Code",
  load_skill: "Pick a Skill",
  read_file: "Read",
  todo: "Update Tasks",
  web_fetch: "Open Webpage",
  web_search: "Search Web",
  write_file: "Edit",
  // beeblio tools
  analyze_image: "Analyze Image",
  brave_search: "Search Web",
  keenable_search: "Search Web",
  copy_path: "Copy",
  create_directory: "New Folder",
  create_form: "Build Form",
  edit_document: "Edit Document",
  extract_audio: "Extract Audio",
  fetch_demographic_data: "Fetch Statistics",
  get_paper_details: "Paper Details",
  open_file: "Open File",
  read_webpage_markdown: "Read Webpage",
  search_bibliography: "Search References",
  search_literature: "Search Papers",
  transcribe_audio: "Transcribe Audio",
  update_bibliography: "Update References",
  update_matrix: "Update Matrix",
  validate_mermaid: "Validate Mermaid",
  convert_markdown_document: "Convert Document",
  fetch_openalex_works: "Searching Literature Databases",
  read_excalidraw: "Read Excalidraw",
  read_office: "Read Office Document",
  update_excalidraw: "Update Excalidraw",
  search_knowledge: "Search Knowledge",
};

// Per-tool icons for the tool log rows; keys mirror TOOL_LABELS.
const TOOL_ICONS: Record<string, LucideIcon> = {
  // eve framework tools
  agent: BotIcon,
  ask_question: CircleHelpIcon,
  bash: TerminalIcon,
  final_output: FlagIcon,
  glob: FolderSearchIcon,
  grep: SearchIcon,
  load_skill: HammerIcon,
  read_file: FileTextIcon,
  todo: ListTodoIcon,
  web_fetch: GlobeIcon,
  web_search: SearchIcon,
  write_file: FilePenIcon,
  // beeblio tools
  analyze_image: ImageIcon,
  brave_search: SearchIcon,
  keenable_search: SearchIcon,
  copy_path: CopyIcon,
  create_directory: FolderPlusIcon,
  create_form: ClipboardListIcon,
  edit_document: SquarePenIcon,
  extract_audio: AudioLinesIcon,
  fetch_demographic_data: DatabaseIcon,
  get_paper_details: GraduationCapIcon,
  open_file: FileIcon,
  read_webpage_markdown: GlobeIcon,
  search_bibliography: LibraryIcon,
  search_literature: SearchIcon,
  transcribe_audio: MicIcon,
  update_bibliography: LibraryIcon,
  update_matrix: TableIcon,
  validate_mermaid: WorkflowIcon,
  convert_markdown_document: FileOutputIcon,
  fetch_openalex_works: LibraryIcon,
  read_excalidraw: BrushIcon,
  read_office: FileTextIcon,
  update_excalidraw: BrushIcon,
  search_knowledge: SearchIcon,
};

export function describeToolCall(part: EveDynamicToolPart): ToolCallDescription {
  let label = TOOL_LABELS[part.toolName];
  if (part.toolName === "write_file") {
    if (part.state === "input-streaming" || part.state === "input-available") {
      label = "Writing";
    } else if (part.state === "output-available") {
      label = outputField(part, "existed") === false ? "Created" : "Edited";
    }
  } else if (part.toolName === "edit_document") {
    if (part.state === "input-streaming" || part.state === "input-available") {
      label = "Editing";
    } else if (part.state === "output-available") {
      label = "Edited";
    }
  }
  return { label, detail: detailFor(part), icon: TOOL_ICONS[part.toolName] };
}

function detailFor(part: EveDynamicToolPart): string | undefined {
  const input = asRecord(part.input);
  if (!input) {
    return undefined;
  }
  switch (part.toolName) {
    case "read_file":
    case "write_file":
    case "edit_document":
    case "open_file":
    case "create_directory":
    case "create_form":
    case "update_matrix":
    case "transcribe_audio":
    case "extract_audio":
    case "read_excalidraw":
    case "read_office":
    case "update_excalidraw":
      return baseName(
        stringField(input, "filePath") ?? stringField(input, "path") ?? stringField(input, "inputPath"),
      );
    case "copy_path": {
      const source = baseName(stringField(input, "sourcePath"));
      const destination = baseName(stringField(input, "destinationPath"));
      if (source && destination) {
        return `${source} → ${destination}`;
      }
      return source;
    }
    case "grep":
      return quoted(stringField(input, "pattern"));
    case "web_search":
    case "brave_search":
    case "keenable_search":
    case "search_literature":
    case "fetch_openalex_works":
    case "search_knowledge":
    case "search_bibliography":
      return quoted(stringField(input, "query"));
    case "load_skill":
      return stringField(input, "skill");
    case "web_fetch":
    case "read_webpage_markdown":
      return hostName(stringField(input, "url"));
    default:
      return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function outputField(part: EveDynamicToolPart, key: string): unknown {
  return asRecord(part.output)?.[key];
}

function baseName(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  const base = path.split("/").filter(Boolean).pop();
  return base && base !== "." && base !== ".." ? base : undefined;
}

function quoted(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return undefined;
  }
  return `"${trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed}"`;
}

function hostName(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
