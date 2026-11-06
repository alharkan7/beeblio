"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MoreVertical, Edit2, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteSession, renameSession } from "../actions";
import { isUnviewed, type SessionSummary } from "./session-summary";

interface SessionItemProps {
  session: SessionSummary;
  projectId: string;
  onSelect: () => void;
  onDeleted: () => void;
  onRenamed: (newTitle: string) => void;
}

export function SessionItem({ session, projectId, onSelect, onDeleted, onRenamed }: SessionItemProps) {
  const searchParams = useSearchParams();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayTitle = session.title || "New Session";
  const unread = isUnviewed(session);
  const statusLabel = session.runStatus === "running" ? "Running"
    : session.runStatus === "needs_input" ? "Needs input"
    : session.runStatus === "failed" ? "Failed"
    : session.runStatus === "finished" && unread ? "Finished"
    : null;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = async () => {
    if (editValue.trim() === displayTitle || !editValue.trim()) {
      setIsEditing(false);
      return;
    }
    setLoading(true);
    try {
      await renameSession(session.id, editValue.trim());
      onRenamed(editValue.trim());
    } catch (e) {
      console.error(e);
      alert("Failed to rename session");
    } finally {
      setLoading(false);
      setIsEditing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setIsEditing(false);
      setEditValue(displayTitle);
    }
  };

  const handleDelete = async () => {
    setDeletePending(true);
    try {
      await deleteSession(session.id);
      setDeleteDialogOpen(false);
      onDeleted();
    } catch (error) {
      console.error(error);
      alert("Failed to delete conversation");
    } finally {
      setDeletePending(false);
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center px-3 py-1 h-8 bg-primary/10 rounded-md ring-1 ring-primary/20">
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          disabled={loading}
          className="flex-1 w-full bg-transparent border-none outline-none text-xs text-foreground focus:ring-0 p-0 m-0"
        />
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-2 shrink-0" />}
      </div>
    );
  }

  return (
    <>
      <div className="group relative flex w-full min-w-0 max-w-full items-center overflow-hidden">
        <Link
          href={`/${projectId}/${session.id}${searchParams.size ? `?${searchParams.toString()}` : ""}`}
          className="min-w-0 flex-1 overflow-hidden"
          onClick={onSelect}
        >
          <Button
            variant="ghost"
            className="h-8 w-full min-w-0 max-w-full justify-start overflow-hidden pl-2 pr-2 text-xs font-normal text-muted-foreground transition-all hover:bg-primary/5 hover:text-primary"
          >
            <TruncatedSessionTitle title={displayTitle} />
            {statusLabel ? <span className="ml-auto inline-flex shrink-0 items-center gap-1 pl-1 text-[10px] font-medium transition-transform group-focus-within:-translate-x-8 [@media(hover:hover)]:group-hover:-translate-x-8 [@media(hover:none)]:-translate-x-8" aria-label={statusLabel}>
              <span className={`size-1.5 rounded-full ${session.runStatus === "running" ? "animate-pulse bg-blue-500" : session.runStatus === "failed" ? "bg-destructive" : session.runStatus === "needs_input" ? "bg-amber-500" : "bg-primary"}`} />
              {statusLabel}
            </span> : null}
          </Button>
        </Link>
        <div className="absolute right-1 z-10 rounded-md opacity-70 transition-opacity group-focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
          <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <MoreVertical className="h-3 w-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[70]">
              <DropdownMenuItem
                className="cursor-pointer flex items-center"
                onClick={(e) => {
                  e.stopPropagation();
                  setDropdownOpen(false);
                  setEditValue(displayTitle);
                  setIsEditing(true);
                }}
              >
                <Edit2 className="h-4 w-4 mr-2" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
                onSelect={() => {
                  setDropdownOpen(false);
                  setDeleteDialogOpen(true);
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!deletePending) setDeleteDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove &quot;{displayTitle}&quot; from this project. This action
              cannot be undone from the app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={deletePending} onClick={handleDelete}>
              {deletePending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Delete Conversation
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TruncatedSessionTitle({ title }: { title: string }) {
  const titleRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  const checkTruncation = () => {
    const element = titleRef.current;
    setIsTruncated(Boolean(element && element.scrollWidth > element.clientWidth));
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          ref={titleRef}
          className="min-w-0 flex-1 truncate text-left"
          onMouseEnter={checkTruncation}
          onFocus={checkTruncation}
        >
          {title}
        </span>
      </TooltipTrigger>
      {isTruncated ? <TooltipContent side="right">{title}</TooltipContent> : null}
    </Tooltip>
  );
}
