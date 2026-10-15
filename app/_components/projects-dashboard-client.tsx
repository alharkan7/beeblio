"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, ChevronDown, Clock3, FolderOpen, MessageSquareText, Search, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CreateProjectForm } from "./create-project-form";
import { ProjectCardMenu } from "./project-card-menu";
import { cn } from "@/lib/utils";

interface WorkspaceProject {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  updatedAt: Date;
  activeSessionCount: number;
}

interface RecentSession {
  id: string;
  title: string | null;
  lastActiveAt: Date;
  projectName: string;
  projectSlug: string;
}

function formatActivityDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(new Date(value));
}

function ProjectDescription({ project }: { project: WorkspaceProject }) {
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) return;
    const sync = () => setIsTruncated(el.scrollHeight > el.clientHeight);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
    // Re-observe after isTruncated flips, since the <p> remounts inside the tooltip trigger.
  }, [project.description, isTruncated]);

  const description = (
    <p
      ref={descriptionRef}
      className="mb-4 line-clamp-2 text-xs leading-5 text-muted-foreground"
    >
      {project.description}
    </p>
  );

  if (!isTruncated) return description;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* The full-card overlay link already owns focus; this trigger only needs
            hover, so it reuses the href and skips an extra tab stop. */}
        <Link
          href={`/${project.slug}`}
          tabIndex={-1}
          className="pointer-events-auto"
        >
          {description}
        </Link>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{project.description}</TooltipContent>
    </Tooltip>
  );
}

function NewProjectCard() {
  return (
    <CreateProjectForm
      customTrigger={
        <Card
          role="button"
          tabIndex={0}
          className="group relative flex min-h-56 cursor-pointer flex-col items-center justify-center gap-0 overflow-hidden rounded-[1.75rem] border-2 border-dashed border-primary/45 bg-transparent shadow-none transition-[transform,background-color] duration-200 hover:-translate-y-1 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
        >
          <div className="relative z-10 flex flex-col items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform group-hover:-translate-y-0.5"><Plus className="size-6" strokeWidth={1.7} /></span>
            <span className="text-lg font-bold tracking-tight text-foreground">New Project</span>
          </div>
        </Card>
      }
    />
  );
}

export function ProjectsDashboardClient({
  initialProjects,
  recentSessions,
}: {
  initialProjects: WorkspaceProject[];
  recentSessions: RecentSession[];
}) {
  const [query, setQuery] = useState("");
  const [recentTasksOpen, setRecentTasksOpen] = useState(false);

  const lowerQ = query.toLowerCase();
  const filteredProjects = initialProjects.filter(p => 
    p.name.toLowerCase().includes(lowerQ) || 
    (p.description?.toLowerCase().includes(lowerQ))
  );

  const filteredSessions = recentSessions.filter(s =>
    (s.title || "Untitled conversation").toLowerCase().includes(lowerQ) ||
    s.projectName.toLowerCase().includes(lowerQ)
  );

  return (
    <>
      <section className="mb-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-[2.15rem]">Your Projects</h1>
          {/* <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Organize files, sources, and conversations around each research focus.
          </p> */}
        </div>

        <div className="flex w-full items-center gap-2 lg:w-auto">
          <div className="group/search relative min-w-0 flex-1 lg:w-80">
            <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within/search:text-primary" />
            <Input
              type="search"
              placeholder="Search Projects"
              aria-label="Search Projects"
              className="pl-10"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <CreateProjectForm />
        </div>
      </section>

      {filteredSessions.length > 0 && (
        <section className="mb-10" aria-labelledby="recent-work-heading">
          <button
            type="button"
            onClick={() => setRecentTasksOpen((value) => !value)}
            aria-expanded={recentTasksOpen}
            aria-controls="recent-tasks-list"
            aria-label={recentTasksOpen ? "Hide recent tasks" : "Show recent tasks"}
            className="-mx-2 mb-3 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 sm:hidden"
          >
            <span className="text-sm font-semibold tracking-[-0.01em]">Recent Tasks</span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                recentTasksOpen && "rotate-180",
              )}
            />
          </button>
          <div className="mb-3 hidden sm:block">
            <h2 id="recent-work-heading" className="text-sm font-semibold tracking-[-0.01em]">
              Recent Tasks
            </h2>
            {/* <p className="mt-0.5 text-xs text-muted-foreground">Jump back into a recent conversation.</p> */}
          </div>
          <div
            id="recent-tasks-list"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5"
          >
            {filteredSessions.map((session, index) => (
              <Link
                key={session.id}
                href={`/${session.projectSlug}/${session.id}`}
                className={cn("group flex min-h-28 min-w-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card p-3.5 shadow-sm transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/25", index > 0 && !recentTasksOpen && "max-sm:hidden")}
              >
                <div className="flex items-start justify-between gap-3">
                  <MessageSquareText className="size-4 text-primary" strokeWidth={1.7} />
                  <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" strokeWidth={1.7} />
                </div>
                <p className="mt-2 line-clamp-2 min-w-0 text-sm font-semibold leading-5">{session.title || "Untitled conversation"}</p>
                <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-[10px] text-muted-foreground">
                  <span className="truncate font-medium">{session.projectName}</span>
                  <span suppressHydrationWarning className="shrink-0">{formatActivityDate(session.lastActiveAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {initialProjects.length > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-[-0.01em]">All Projects</h2>
          <span className="text-xs tabular-nums text-muted-foreground">
            {filteredProjects.length} {filteredProjects.length === 1 ? "Project" : "Projects"}
          </span>
        </div>
      )}

      {initialProjects.length === 0 && !query ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <NewProjectCard />
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="flex min-h-80 flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-primary/20 bg-card/45 px-6 text-center shadow-[inset_0_1px_0_rgb(255_255_255/0.5)]">
          <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-primary/15 bg-primary/[0.06] text-primary shadow-sm"><FolderOpen className="size-5" /></div>
          <h3 className="text-base font-semibold">No Matches Found</h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Try adjusting your search query.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filteredProjects.map((project) => (
            <Card key={project.id} className="group relative flex min-h-56 flex-col gap-0 overflow-hidden rounded-[1.75rem] border-border/80 bg-card py-0 shadow-sm transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg focus-within:border-primary">
              <Link
                href={`/${project.slug}`}
                aria-label={`Open ${project.name} workspace`}
                className="absolute inset-0 z-0 rounded-[inherit] focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/25"
              />
              <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              <CardHeader className="pointer-events-none relative z-[1] px-6 pb-2 pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex size-10 items-center justify-center rounded-xl border border-primary/10 bg-primary/[0.07] text-primary"><FolderOpen className="size-[18px]" strokeWidth={1.8} /></div>
                  <div className="pointer-events-auto relative z-10">
                    <ProjectCardMenu project={{ id: project.id, name: project.name, description: project.description }} />
                  </div>
                </div>
                <div className="mt-6 flex min-w-0 items-center gap-2">
                  <CardTitle className="line-clamp-2 min-w-0 flex-1 text-xl font-bold leading-tight tracking-[-0.04em]">{project.name}</CardTitle>
                </div>
                {/* <CardDescription className="mt-1.5 truncate font-mono text-[10px] uppercase tracking-[0.08em]">{project.slug}</CardDescription> */}
              </CardHeader>
              <CardContent className="pointer-events-none relative z-[1] flex flex-1 flex-col px-6 pb-5">
                {project.description && <ProjectDescription project={project} />}
                <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3 text-[11px] text-muted-foreground">
                  <span suppressHydrationWarning className="flex items-center gap-1.5"><Clock3 className="size-3" /> {formatActivityDate(project.updatedAt)}</span>
                  <span className="flex items-center gap-1 font-semibold text-foreground">Open <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" /></span>
                </div>
              </CardContent>
            </Card>
          ))}
          {!query && <NewProjectCard />}
        </div>
      )}
    </>
  );
}
