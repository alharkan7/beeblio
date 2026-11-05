"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RouteFallback } from "@/app/_components/route-fallback";

/** Shown when a linked project folder was moved, renamed, or disconnected. */
export function MissingProjectFolder({ projectId, projectName, folderPath }: { projectId: string; projectName: string; folderPath: string }) {
  const router = useRouter();
  const [checking, startChecking] = useTransition();
  const [selectedPath, setSelectedPath] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState("");

  async function chooseFolder() {
    setError("");
    try {
      if (window.beeblioDesktop) {
        const selected = await window.beeblioDesktop.selectFolder();
        if (selected) setSelectedPath(selected);
        return;
      }
      const response = await fetch("/api/projects/select-folder", { method: "POST" });
      const result = await response.json();
      if (response.ok && typeof result.folderPath === "string") setSelectedPath(result.folderPath);
      else if (response.status !== 400) setError(result.error || "Could not select a folder");
    } catch {
      setError("Could not select a folder");
    }
  }

  async function reconnect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setReconnecting(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/reconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderPath: selectedPath }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || "Could not reconnect the folder");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reconnect the folder");
    } finally {
      setReconnecting(false);
    }
  }

  return (
    <RouteFallback
      title={`The folder for “${projectName}” is missing`}
      description={
        <>
          Beeblio cannot find
          <span className="my-2 block break-all rounded-lg border bg-card px-3 py-2 font-mono text-xs text-foreground">{folderPath}</span>
          If it was moved, select its new location. If the drive is disconnected, reconnect it and try again. Nothing in the project was changed.
        </>
      }
    >
      <div className="flex w-full max-w-sm flex-col gap-4">
        <form onSubmit={reconnect} className="flex w-full flex-col gap-2">
        <label htmlFor="reconnect-folder" className="text-sm font-medium">Reconnect Folder</label>
        <div className="flex gap-2">
          <Input id="reconnect-folder" value={selectedPath} onChange={(event) => setSelectedPath(event.target.value)} placeholder="/absolute/path/to/folder" disabled={reconnecting} />
          <Button type="button" variant="outline" onClick={chooseFolder} disabled={reconnecting} aria-label="Browse for folder"><FolderOpen /></Button>
        </div>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <Button type="submit" disabled={reconnecting || !selectedPath.trim()} className="w-full">
          {reconnecting ? <Loader2 className="animate-spin" /> : <FolderOpen />}
          Reconnect Folder
        </Button>
        </form>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={() => startChecking(() => router.refresh())} disabled={checking}>
            {checking ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Try Again
          </Button>
          <Button variant="outline" asChild>
            <Link href="/workspace">Back to Projects</Link>
          </Button>
        </div>
      </div>
    </RouteFallback>
  );
}
