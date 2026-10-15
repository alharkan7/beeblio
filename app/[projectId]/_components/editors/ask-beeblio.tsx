"use client";

import { useEffect, useRef, useState } from "react";
import { isNodeSelection, type Editor } from "@tiptap/react";
import { ArrowUp, BookOpen, Check, PencilSparkles, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { ASK_AGENT_EVENT, SELECTION_ANCHOR_MAX_CHARS, type AskAgentDetail, type ChatFileContext } from "@/lib/chat-context";
import { documentSelectionAt } from "./tiptap-markdown-extensions";
import { resolveWorkspaceAssetPath } from "./markdown-image-path";
// Debounces keep the button from flickering while a selection is being dragged
// and the ghost from flashing while arrowing between empty paragraphs.
const SELECTION_DEBOUNCE_MS = 350;
const GHOST_DEBOUNCE_MS = 500;
// After the box is closed, the same caret/selection should not instantly
// re-open its trigger; a new selection still shows right away.
const REOPEN_SUPPRESS_MS = 1_800;

const BOX_WIDTH = 320;
const BOX_ESTIMATED_HEIGHT = 150;
const SELECTION_MENU_WIDTH = 120;
const BUTTON_HEIGHT = 32;
// The empty-paragraph ghost button is the compact h-7 variant.
const GHOST_BUTTON_HEIGHT = 28;
// Vertical band the figure toolbar occupies above a selected image.
const FIGURE_TOOLBAR_SPACE = 40;

type AskTrigger =
  | { kind: "selection"; from: number; to: number }
  | { kind: "emptyParagraph"; pos: number }
  | { kind: "image"; pos: number }
  | { kind: "mermaid"; pos: number };

type AskSelection = {
  text: string;
  range: { from: number; to: number };
  before?: string;
  after?: string;
};

type SlashCommand = {
  query: string;
  from: number;
  to: number;
  left: number;
  top: number;
};

type AskInsertion = {
  before?: string;
  after?: string;
  pos: number;
};

type AnchorRect = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

type ImageAskContext = {
  /** Workspace path when the embedded image lives in the project, else null. */
  path: string | null;
  /** The markdown reference, sent as selection text for external images. */
  markdown: string;
};

type QuickAction = { label: string; prompt: string };

const DEFAULT_ACTIONS: QuickAction[] = [
  { label: "Summarize", prompt: "Summarize this passage." },
  { label: "Explain", prompt: "Explain this passage in plain language." },
  { label: "Rewrite", prompt: "Rewrite this passage to make it clearer while keeping the meaning." },
];

const CITATION_ACTIONS: QuickAction[] = [
  { label: "Check this source", prompt: "Find the full source cited in this passage and evaluate whether the passage represents it fairly." },
  { label: "Summarize", prompt: "Summarize this passage." },
  { label: "Explain", prompt: "Explain this passage in plain language." },
];

const MERMAID_ACTIONS: QuickAction[] = [
  { label: "Fix", prompt: "Fix and improve the Mermaid diagram in this passage, then explain what you changed." },
  { label: "Explain", prompt: "Explain this passage in plain language." },
  { label: "Summarize", prompt: "Summarize this passage." },
];

const IMAGE_ACTIONS: QuickAction[] = [
  { label: "Describe", prompt: "Describe this figure in detail." },
  { label: "Caption", prompt: "Write a concise, academic caption for this figure." },
  { label: "Suggest", prompt: "Suggest concrete improvements for this figure." },
];

const DOCUMENT_ACTIONS: QuickAction[] = [
  { label: "Summarize document", prompt: "Summarize this document." },
  { label: "Suggest improvements", prompt: "Suggest concrete improvements for this document." },
];

function sameTrigger(a: AskTrigger | null, b: AskTrigger | null) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "selection" && b.kind === "selection") return a.from === b.from && a.to === b.to;
  // Same kind and not a text selection: both are one of the pos-variants.
  return (a as { pos: number }).pos === (b as { pos: number }).pos;
}

// Nearest non-empty top-level block around the block at `index`, walking in
// `step` direction; null when the document edge (or only empty blocks) comes
// first.
function nearestBlockText(doc: Editor["state"]["doc"], index: number, step: 1 | -1) {
  for (let i = index + step; i >= 0 && i < doc.childCount; i += step) {
    const text = doc.child(i).textContent.trim();
    if (text) return text;
  }
  return null;
}

function findScrollParent(element: HTMLElement | null): HTMLElement | null {
  let current = element;
  while (current && current !== document.body) {
    const overflowY = getComputedStyle(current).overflowY;
    if (/(auto|scroll|overlay)/.test(overflowY)) return current;
    current = current.parentElement;
  }
  return null;
}

export function AskBeeblio({
  editor,
  filePath,
  disabled,
  getSlashDismissedFrom,
  onSlashDismissedFromChange,
  onRequestCitation,
  onRequestFindCitation,
}: {
  editor: Editor | null;
  filePath: string;
  /** Suppressed while another caret-anchored popup (the "@" menu) is open. */
  disabled?: boolean;
  getSlashDismissedFrom?: () => number | null;
  onSlashDismissedFromChange?: (from: number | null) => void;
  onRequestCitation?: (selection: { from: number; to: number; left: number; top: number }) => void;
  onRequestFindCitation?: (selection: { from: number; to: number; text: string }) => void;
}) {
  const [trigger, setTrigger] = useState<AskTrigger | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const [mode, setMode] = useState<"button" | "box" | "sent">("button");
  const [selection, setSelection] = useState<AskSelection | null>(null);
  const [insertion, setInsertion] = useState<AskInsertion | null>(null);
  const [imageContext, setImageContext] = useState<ImageAskContext | null>(null);
  const [quickActions, setQuickActions] = useState<QuickAction[]>(DEFAULT_ACTIONS);
  const [instruction, setInstruction] = useState("");
  const [slashCommand, setSlashCommand] = useState<SlashCommand | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const boxOriginRef = useRef<AnchorRect | null>(null);
  const multiClickAnchorRef = useRef<{ from: number; to: number; x: number; y: number } | null>(null);
  const pendingRef = useRef<AskTrigger | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const sentTimerRef = useRef<number | undefined>(undefined);
  const suppressedRef = useRef<{ trigger: AskTrigger; until: number } | null>(null);
  const slashCommandRef = useRef(slashCommand);
  const triggerRef = useRef(trigger);
  const modeRef = useRef(mode);
  triggerRef.current = trigger;
  modeRef.current = mode;
  slashCommandRef.current = slashCommand;

  const actionsForRange = (from: number, to: number) => {
    const found = { citation: false, mermaid: false };
    editor?.state.doc.nodesBetween(from, to, (node) => {
      if (node.type.name === "citation") found.citation = true;
      if (node.type.name === "codeBlock" && String(node.attrs.language ?? "").toLowerCase() === "mermaid") {
        found.mermaid = true;
      }
    });
    return found.citation ? CITATION_ACTIONS : found.mermaid ? MERMAID_ACTIONS : DEFAULT_ACTIONS;
  };

  const hide = () => {
    window.clearTimeout(timerRef.current);
    pendingRef.current = null;
    setTrigger(null);
    setAnchor(null);
  };

  const close = () => {
    if (triggerRef.current) {
      suppressedRef.current = { trigger: triggerRef.current, until: Date.now() + REOPEN_SUPPRESS_MS };
    }
    window.clearTimeout(sentTimerRef.current);
    hide();
    setMode("button");
    setInstruction("");
    editor?.commands.focus();
  };

  // Builds the context snapshot for a trigger: what gets attached (a text
  // passage, a diagram's source, an image file mention, or a caret position
  // anchored by its neighbors) and which quick actions apply.
  const snapshotForTrigger = (current: AskTrigger) => {
    if (current.kind === "selection") {
      const extract = editor ? documentSelectionAt(editor, current.from, current.to) : null;
      return {
        selection: extract
          ? { text: extract.text, range: extract.range, before: extract.before, after: extract.after }
          : null,
        insertion: null as AskInsertion | null,
        image: null as ImageAskContext | null,
        actions: actionsForRange(current.from, current.to),
      };
    }
    if (current.kind === "mermaid") {
      const node = editor?.state.doc.nodeAt(current.pos);
      const extract = editor && node ? documentSelectionAt(editor, current.pos, current.pos + node.nodeSize) : null;
      return {
        selection: extract
          ? { text: extract.text, range: extract.range, before: extract.before, after: extract.after }
          : null,
        insertion: null as AskInsertion | null,
        image: null,
        actions: MERMAID_ACTIONS,
      };
    }
    if (current.kind === "image") {
      const node = editor?.state.doc.nodeAt(current.pos);
      if (!node || node.type.name !== "image") return { selection: null, insertion: null, image: null, actions: IMAGE_ACTIONS };
      const markdownSource = String(node.attrs.markdownSource || node.attrs.src || "");
      const alt = String(node.attrs.alt || "");
      const resolved = markdownSource ? resolveWorkspaceAssetPath(filePath, markdownSource) : null;
      return {
        selection: null,
        insertion: null,
        image: {
          path: resolved?.path ?? null,
          markdown: `![${alt}](${markdownSource})`,
        },
        actions: IMAGE_ACTIONS,
      };
    }
    // An idle caret in an empty paragraph: the position itself means nothing
    // outside this editor, so anchor it with the surrounding passages the
    // agent can find in the file to locate where "here" is.
    const doc = editor?.state.doc;
    let before: string | null = null;
    let after: string | null = null;
    if (doc) {
      const index = doc.resolve(current.pos).index(0);
      before = nearestBlockText(doc, index, -1);
      after = nearestBlockText(doc, index, 1);
    }
    return {
      selection: null,
      insertion: {
        before: before ? before.slice(-SELECTION_ANCHOR_MAX_CHARS) : undefined,
        after: after ? after.slice(0, SELECTION_ANCHOR_MAX_CHARS) : undefined,
        pos: current.pos,
      },
      image: null,
      actions: DOCUMENT_ACTIONS,
    };
  };

  const applyTrigger = (next: AskTrigger) => {
    if (!editor || editor.isDestroyed) return;
    const snapshot = snapshotForTrigger(next);
    setSelection(snapshot.selection);
    setInsertion(snapshot.insertion);
    setImageContext(snapshot.image);
    setQuickActions(snapshot.actions);
    setAnchor(null);
    setTrigger(next);
    setMode("button");
  };

  const schedule = (next: AskTrigger) => {
    if (sameTrigger(pendingRef.current, next)) return;
    pendingRef.current = next;
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const suppressed = suppressedRef.current;
      if (suppressed && sameTrigger(suppressed.trigger, next) && Date.now() < suppressed.until) {
        // Drop the pending trigger so the same passage can re-open the button
        // once the suppression window has passed.
        pendingRef.current = null;
        return;
      }
      applyTrigger(next);
    }, next.kind === "emptyParagraph" ? GHOST_DEBOUNCE_MS : SELECTION_DEBOUNCE_MS);
  };

  // Watches the caret and selection: a text selection, a selected image or
  // Mermaid block, or an idle caret in an empty paragraph all become ask
  // opportunities; anything else hides immediately.
  useEffect(() => {
    if (!editor) return;
    const evaluate = () => {
      if (editor.isDestroyed || modeRef.current !== "button") return;
      const current = editor.state.selection;
      if (isNodeSelection(current)) {
        const node = current.node;
        if (node.type.name === "image") {
          schedule({ kind: "image", pos: current.from });
          return;
        }
        if (node.type.name === "codeBlock" && String(node.attrs.language ?? "").toLowerCase() === "mermaid") {
          schedule({ kind: "mermaid", pos: current.from });
          return;
        }
        // A selected citation (click or arrow keys) is askable like any other
        // passage — its serialized form is the [@key] token itself.
        if (node.type.name === "citation") {
          schedule({ kind: "selection", from: current.from, to: current.to });
          return;
        }
        hide();
        return;
      }
      if (!current.empty) {
        const text = editor.state.doc.textBetween(current.from, current.to, "\n").trim();
        if (text) {
          schedule({ kind: "selection", from: current.from, to: current.to });
          return;
        }
      }
      if (
        editor.isFocused &&
        current.empty &&
        current.$from.parent.type.name === "paragraph" &&
        current.$from.parent.content.size === 0
      ) {
        schedule({ kind: "emptyParagraph", pos: current.from });
        return;
      }
      hide();
    };
    editor.on("transaction", evaluate);
    editor.on("focus", evaluate);
    editor.on("blur", evaluate);
    evaluate();
    return () => {
      editor.off("transaction", evaluate);
      editor.off("focus", evaluate);
      editor.off("blur", evaluate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // A multi-click selection can expand to a whole word or paragraph far away
  // from its selection endpoint. Remember the pointer that caused it so the
  // action menu opens where the user clicked; ordinary drag selections keep
  // using their moving endpoint.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    // Keep the mounted DOM node itself. During Save As the editor is re-keyed
    // and its view can be destroyed before React runs this cleanup; consulting
    // `editor.view` at cleanup time then throws inside Tiptap.
    const editorDom = editor.view.dom;
    const handleMouseUp = (event: MouseEvent) => {
      if (event.detail < 2) {
        multiClickAnchorRef.current = null;
        return;
      }
      const current = editor.state.selection;
      if (current.empty) return;
      multiClickAnchorRef.current = {
        from: current.from,
        to: current.to,
        x: event.clientX,
        y: event.clientY,
      };
    };
    editorDom.addEventListener("mouseup", handleMouseUp);
    return () => editorDom.removeEventListener("mouseup", handleMouseUp);
  }, [editor]);

  useEffect(() => {
    if (!disabled) return;
    window.clearTimeout(timerRef.current);
    pendingRef.current = null;
    setTrigger(null);
    setAnchor(null);
    setSlashCommand(null);
  }, [disabled]);

  useEffect(() => () => {
    window.clearTimeout(timerRef.current);
    window.clearTimeout(sentTimerRef.current);
  }, []);

  // Viewport-fixed anchor for the popover. Like the figure toolbar, the button
  // rides above the selection end and clamps into the editor's scroll frame so
  // long selections that scroll past the top (or bottom) keep it visible; it
  // only hides once the whole passage is out of view.
  const updateAnchor = () => {
    const current = triggerRef.current;
    if (!editor || editor.isDestroyed || !current) return;
    const bounds = findScrollParent(editor.view.dom.parentElement)?.getBoundingClientRect();
    const frame = bounds ?? { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
    if (modeRef.current === "box" && boxOriginRef.current) {
      const origin = boxOriginRef.current;
      const boxHeight = boxRef.current?.offsetHeight || BOX_ESTIMATED_HEIGHT;
      const left = Math.min(Math.max(origin.left, frame.left + 4), frame.right - BOX_WIDTH - 4);
      const below = origin.bottom + 6;
      const top = below + boxHeight <= frame.bottom - 4
        ? below
        : Math.max(frame.top + 4, origin.top - boxHeight - 6);
      setAnchor({ top, right: window.innerWidth - left - BOX_WIDTH });
      return;
    }
    if (current.kind === "selection") {
      const startCoords = editor.view.coordsAtPos(current.from);
      const endCoords = editor.view.coordsAtPos(current.to);
      if (bounds && (endCoords.bottom < bounds.top || startCoords.top > bounds.bottom)) {
        setAnchor(null);
        return;
      }
      const menuItemsCount = 1 + (onRequestFindCitation ? 1 : 0) + (onRequestCitation ? 1 : 0);
      const menuHeight = BUTTON_HEIGHT * menuItemsCount;
      const multiClick = multiClickAnchorRef.current;
      const pointer = multiClick?.from === current.from && multiClick.to === current.to
        ? multiClick
        : null;
      const anchorX = pointer?.x ?? endCoords.left;
      const anchorTop = pointer ? pointer.y - 8 : endCoords.top;
      const anchorBottom = pointer ? pointer.y + 8 : endCoords.bottom;
      const left = Math.min(
        Math.max(anchorX - SELECTION_MENU_WIDTH / 2, frame.left + 4),
        frame.right - SELECTION_MENU_WIDTH - 4,
      );
      const roomAbove = anchorTop - frame.top;
      const preferredTop = roomAbove >= menuHeight + 12
        ? anchorTop - menuHeight - 8
        : anchorBottom + 8;
      const top = Math.min(Math.max(preferredTop, frame.top + 4), frame.bottom - menuHeight - 4);
      setAnchor({ top, right: window.innerWidth - left - SELECTION_MENU_WIDTH });
      return;
    }
    if (current.kind === "image" || current.kind === "mermaid") {
      const dom = editor.view.nodeDOM(current.pos);
      const box = dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
      if (!box || box.bottom < frame.top || box.top > frame.bottom) {
        setAnchor(null);
        return;
      }
      // The figure toolbar occupies the band right above a selected image, so
      // the ask button stacks below it; Mermaid blocks have no toolbar.
      const lift = current.kind === "image"
        ? BUTTON_HEIGHT + 8 + FIGURE_TOOLBAR_SPACE
        : BUTTON_HEIGHT + 8;
      const minTop = frame.top + (current.kind === "image" ? FIGURE_TOOLBAR_SPACE + 8 : 4);
      const edge = Math.min(Math.max(box.right, frame.left + BOX_WIDTH + 8), frame.right - 4);
      const top = Math.min(Math.max(box.top - lift, minTop), frame.bottom - BUTTON_HEIGHT - 4);
      setAnchor({ top, right: window.innerWidth - edge });
      return;
    }
    const coords = editor.view.coordsAtPos(current.pos);
    if (bounds && (coords.bottom < bounds.top || coords.top > bounds.bottom)) {
      setAnchor(null);
      return;
    }
    // coordsAtPos on an empty paragraph measures the filler <br>, whose rect
    // can start below the row's text; center the ghost on the paragraph's own
    // line box so it rides level with the caret row.
    const paragraphDom = editor.view.domAtPos(current.pos).node;
    const row = paragraphDom instanceof HTMLElement ? paragraphDom.getBoundingClientRect() : coords;
    setAnchor({
      top: (row.top + row.bottom) / 2 - GHOST_BUTTON_HEIGHT / 2,
      right: window.innerWidth - coords.left + 4,
    });
  };
  const updateAnchorRef = useRef(updateAnchor);
  updateAnchorRef.current = updateAnchor;

  useEffect(() => {
    if (!editor || !trigger) return;
    const update = () => updateAnchorRef.current();
    update();
    window.addEventListener("scroll", update, { capture: true, passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", update);
    };
  }, [editor, trigger, mode]);

  // Clicking back into the document (or anywhere outside the box) closes it;
  // the document click then re-evaluates the trigger on its own transaction.
  useEffect(() => {
    if (mode !== "box") return;
    const onPointerDown = (event: MouseEvent) => {
      if (boxRef.current?.contains(event.target as Node)) return;
      close();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const openBox = (origin?: AnchorRect, requestedTrigger?: AskTrigger) => {
    const current = requestedTrigger ?? triggerRef.current;
    if (!current || !editor) return;
    boxOriginRef.current = origin ?? null;
    // Snapshot the context when the box opens so later document changes cannot
    // silently alter what the instruction will be attached to.
    const snapshot = snapshotForTrigger(current);
    setSelection(snapshot.selection);
    setInsertion(snapshot.insertion);
    setImageContext(snapshot.image);
    setQuickActions(snapshot.actions);
    setInstruction("");
    if (requestedTrigger) {
      window.clearTimeout(timerRef.current);
      pendingRef.current = null;
      setTrigger(requestedTrigger);
    }
    setMode("box");
  };

  // A slash at the start of a paragraph behaves like the @ search: its query
  // remains editable in the document while a lightweight action follows it.
  useEffect(() => {
    if (!editor) return;
    const evaluateSlashCommand = () => {
      if (editor.isDestroyed || modeRef.current !== "button" || disabled) {
        setSlashCommand(null);
        return;
      }
      const current = editor.state.selection;
      if (
        !editor.isFocused || !current.empty ||
        current.$from.parent.type.name !== "paragraph"
      ) {
        setSlashCommand(null);
        onSlashDismissedFromChange?.(null);
        return;
      }
      const text = current.$from.parent.textBetween(0, current.$from.parentOffset, "\n", "\0");
      const match = /^\/([^\n]*)$/.exec(text);
      if (!match) {
        setSlashCommand(null);
        onSlashDismissedFromChange?.(null);
        return;
      }
      const query = match[1];
      const from = current.from - query.length - 1;
      if (getSlashDismissedFrom?.() === from) {
        setSlashCommand(null);
        return;
      }
      const coords = editor.view.coordsAtPos(current.from);
      setSlashCommand({ query, from, to: current.from, left: coords.right + 8, top: coords.top });
    };
    editor.on("transaction", evaluateSlashCommand);
    editor.on("focus", evaluateSlashCommand);
    editor.on("blur", evaluateSlashCommand);
    evaluateSlashCommand();
    return () => {
      editor.off("transaction", evaluateSlashCommand);
      editor.off("focus", evaluateSlashCommand);
      editor.off("blur", evaluateSlashCommand);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, disabled]);

  const sendSlashCommand = () => {
    const command = slashCommandRef.current;
    const text = command?.query.trim();
    if (!editor || !command || !text) return;
    const snapshot = snapshotForTrigger({ kind: "emptyParagraph", pos: command.from });
    editor.chain().focus().deleteRange({ from: command.from, to: command.to }).run();
    const insertionContext = snapshot.insertion;
    let accepted = false;
    let restored = false;
    const restoreCommand = () => {
      if (restored || editor.isDestroyed) return;
      restored = true;
      editor.chain().focus().insertContentAt(command.from, `/${command.query}`).run();
    };
    window.dispatchEvent(new CustomEvent(ASK_AGENT_EVENT, {
      cancelable: true,
      detail: {
        text,
        interaction: {
          origin: "inline-slash",
          intent: "insert-at-caret",
          targetFilePath: filePath,
        },
        onAccepted: () => { accepted = true; },
        onRejected: restoreCommand,
        selection: insertionContext
          ? {
              filePath,
              kind: "insertion",
              before: insertionContext.before,
              after: insertionContext.after,
              range: { from: insertionContext.pos, to: insertionContext.pos },
            }
          : undefined,
      } satisfies AskAgentDetail,
    }));
    // If the chat is not mounted yet or is already running a turn, preserve
    // the inline command instead of silently clearing the user's row.
    if (!accepted) restoreCommand();
    setSlashCommand(null);
  };

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    // See the mouseup subscription above: cleanup must not dereference a view
    // that Save As may already have destroyed.
    const editorDom = editor.view.dom;
    const handleSlashCommandKeyDown = (event: KeyboardEvent) => {
      const command = slashCommandRef.current;
      if (!command) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onSlashDismissedFromChange?.(command.from);
        setSlashCommand(null);
        editor.view.dispatch(editor.state.tr);
      } else if (event.key === "Enter" && command.query.trim() && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendSlashCommand();
      }
    };
    editorDom.addEventListener("keydown", handleSlashCommandKeyDown, true);
    return () => editorDom.removeEventListener("keydown", handleSlashCommandKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const detail: AskAgentDetail = {
      text: trimmed,
      interaction: insertion
        ? { origin: "inline-caret", intent: "insert-at-caret", targetFilePath: filePath }
        : selection
          ? { origin: "inline-selection", intent: "contextual-selection", targetFilePath: filePath }
          : { origin: "inline-image", intent: "contextual-image", targetFilePath: filePath },
      selection: selection
        ? { filePath, text: selection.text, range: selection.range, before: selection.before, after: selection.after, source: "document" }
        : insertion
          ? {
              filePath,
              kind: "insertion",
              before: insertion.before,
              after: insertion.after,
              range: { from: insertion.pos, to: insertion.pos },
            }
          : imageContext && !imageContext.path
          // External images have no workspace file to mention, so the markdown
          // reference itself carries the source URL to the agent.
          ? { filePath, text: imageContext.markdown }
          : undefined,
      files: imageContext?.path
        ? [{ path: imageContext.path, kind: "mention" }] satisfies ChatFileContext[]
        : undefined,
    };
    window.dispatchEvent(new CustomEvent(ASK_AGENT_EVENT, { detail }));
    setMode("sent");
    window.clearTimeout(sentTimerRef.current);
    sentTimerRef.current = window.setTimeout(() => {
      if (modeRef.current === "sent") {
        hide();
        setMode("button");
      }
    }, 1_400);
  };

  if (editor && slashCommand) {
    const menuWidth = Math.min(152, window.innerWidth - 16);
    const left = Math.min(Math.max(8, slashCommand.left), window.innerWidth - menuWidth - 8);
    const top = Math.min(Math.max(8, slashCommand.top - 7), window.innerHeight - 48);
    const query = slashCommand.query.trim();
    return (
      <button
        type="button"
        className="beeblio-ask-pop fixed z-50 flex h-8 items-center gap-1.5 rounded-lg border bg-popover px-2 text-left text-xs text-popover-foreground shadow-lg hover:bg-accent"
        style={{ left, top, width: menuWidth }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={sendSlashCommand}
        disabled={!query}
      >
        <PencilSparkles className="size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">Ask Beeblio</span>
        <kbd className="rounded border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">Enter</kbd>
      </button>
    );
  }

  if (!editor || !trigger || !anchor) return null;

  // Mouse down inside the popover keeps the editor selection alive; the
  // textarea itself must stay focusable, so it opts out.
  const keepSelection = (event: React.MouseEvent) => {
    if (!(event.target instanceof HTMLTextAreaElement)) event.preventDefault();
  };

  if (mode === "sent") {
    return (
      <div
        className="beeblio-ask-pop fixed z-40 flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-card px-2.5 text-xs font-medium text-emerald-700 shadow-md dark:text-emerald-400"
        style={{ top: anchor.top, right: anchor.right }}
        contentEditable={false}
      >
        <Check className="size-3.5" />
        Sent to chat
      </div>
    );
  }

  if (mode === "button") {
    if (trigger.kind === "emptyParagraph") {
      return (
        <button
          type="button"
          className="beeblio-ask-pop fixed z-30 flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
          style={{ top: anchor.top, right: anchor.right }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => openBox(event.currentTarget.getBoundingClientRect())}
          title="Ask Beeblio"
        >
          <kbd className="flex size-4 items-center justify-center rounded border bg-background/70 font-sans text-[10px] leading-none shadow-sm">/</kbd>
          Ask
        </button>
      );
    }
    const title = trigger.kind === "image"
      ? "Ask Beeblio about this figure"
      : trigger.kind === "mermaid"
        ? "Ask Beeblio about this diagram"
        : "Ask Beeblio about the selected passage";
    const isTextSelection = trigger.kind === "selection";
    return (
      <div
        className="beeblio-ask-pop fixed z-40 flex flex-col overflow-hidden rounded-lg border bg-card text-xs font-medium text-foreground shadow-md"
        style={{ top: anchor.top, right: anchor.right, width: isTextSelection ? SELECTION_MENU_WIDTH : undefined }}
        contentEditable={false}
      >
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 px-2.5 text-left transition-colors hover:bg-accent"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => openBox((event.currentTarget.parentElement ?? event.currentTarget).getBoundingClientRect())}
          title={title}
        >
          <PencilSparkles className="size-3.5 text-primary" />
          Beeblio AI
        </button>
        {isTextSelection && onRequestFindCitation ? (
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 border-t px-2.5 text-left transition-colors hover:bg-accent"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const current = triggerRef.current;
              if (!editor || !current || current.kind !== "selection") return;
              const text = editor.state.doc.textBetween(current.from, current.to, " ");
              onRequestFindCitation({
                from: current.from,
                to: current.to,
                text,
              });
              hide();
            }}
            title="Find citation from bibliography knowledge base"
          >
            <Sparkles className="size-3.5 text-primary" />
            Find citation
          </button>
        ) : null}
        {isTextSelection && onRequestCitation ? (
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 border-t px-2.5 text-left transition-colors hover:bg-accent"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              const current = triggerRef.current;
              if (!editor || !current || current.kind !== "selection") return;
              const button = event.currentTarget.getBoundingClientRect();
              onRequestCitation({
                from: current.from,
                to: current.to,
                left: button.left,
                top: button.bottom + 6,
              });
              hide();
            }}
            title="Find a citation for the selected passage"
          >
            <BookOpen className="size-3.5 text-primary" />
            Citation
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label="Ask Beeblio"
      className="beeblio-ask-pop fixed z-50 rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg"
      style={{ top: anchor.top, right: anchor.right, width: BOX_WIDTH }}
      onMouseDown={keepSelection}
      contentEditable={false}
    >
      <textarea
        autoFocus
        rows={2}
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit(instruction);
          }
        }}
        placeholder={
          imageContext ? "Ask about this figure…"
          : trigger.kind === "mermaid" ? "Ask about this diagram…"
          : selection ? "Ask about this passage…"
          : "Ask about this document…"
        }
        aria-label={
          imageContext ? "Ask about this figure"
          : trigger.kind === "mermaid" ? "Ask about this diagram"
          : selection ? "Ask about this passage"
          : "Ask about this document"
        }
        className="min-h-[4.25rem] w-full resize-none rounded-lg bg-muted/50 px-2.5 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1" aria-label="Quick actions">
          {quickActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="rounded-full border px-2 py-0.5 text-[11px] transition-colors hover:bg-accent"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => submit(action.prompt)}
            >
              {action.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity",
            !instruction.trim() && "opacity-40",
          )}
          disabled={!instruction.trim()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => submit(instruction)}
          aria-label="Send to chat"
          title="Send to chat (Enter)"
        >
          <ArrowUp className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
