import type { MessageStreamEvent } from "eve/client";
import type { EveMessage, EveMessagePart } from "eve/react";
import { Cpu, PenLine, ScrollText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  AgentMessage,
  type AgentInputResponse,
  type ReasoningVerbosity,
  type ToolCallVerbosity,
} from "./agent-message";

export function AgentMessageList({
  messages,
  status,
  lastEvent,
  events,
  textStreamStalled,
  isCompacting,
  isInitialTurn,
  toolCallVerbosity,
  reasoningVerbosity,
  sendScrollSignal,
  onInputResponses,
  errorMessage,
  onRetry,
  retriedMessageIds,
}: {
  readonly retriedMessageIds?: ReadonlySet<string>;
  readonly messages: readonly EveMessage[];
  readonly status: "ready" | "resuming" | "submitted" | "streaming" | "error";
  readonly lastEvent?: MessageStreamEvent;
  readonly events: readonly MessageStreamEvent[];
  readonly textStreamStalled: boolean;
  readonly isCompacting: boolean;
  readonly isInitialTurn: boolean;
  readonly toolCallVerbosity: ToolCallVerbosity;
  readonly reasoningVerbosity: ReasoningVerbosity;
  /** Bumped by the chat each time the user sends a message, so the list can
   *  scroll the new message into view even when the user had scrolled up. */
  readonly sendScrollSignal: number;
  readonly onInputResponses: (
    inputResponses: readonly AgentInputResponse[],
  ) => void | Promise<void>;
  readonly errorMessage?: string;
  readonly onRetry?: () => void;
}) {
  const isBusy = status === "submitted" || status === "streaming";

  // Filter out any user message that was retried or superseded so duplicate bubbles are not displayed
  const displayMessages = useMemo(() => {
    const result: EveMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (retriedMessageIds?.has(msg.id)) {
        continue;
      }
      if (msg.role === "user") {
        const nextMsg = messages[i + 1];
        if (nextMsg && nextMsg.role === "user") {
          const currentText = msg.parts.find((p) => p.type === "text")?.text;
          const nextText = nextMsg.parts.find((p) => p.type === "text")?.text;
          if (currentText && nextText && currentText === nextText) {
            continue;
          }
        }
      }
      result.push(msg);
    }
    return result;
  }, [messages, retriedMessageIds]);

  const lastUserDisplayIndex = displayMessages.findLastIndex(
    (message) => message.role === "user" && message.metadata?.optimistic !== true,
  );
  // A part can only still be receiving events while its message belongs to
  // the turn eve is actively writing: an assistant message after the last
  // user message, while the agent is busy, that eve still projects as
  // streaming. Anything else holding a transient state (a tool left
  // "Running" by turn.cancelled, reasoning left mid-stream by turn.failed or
  // a lost connection) renders as settled — see AgentMessage.
  const liveAssistantMessageIds = new Set<string>();
  if (isBusy) {
    for (
      let index = lastUserDisplayIndex + 1;
      index < displayMessages.length;
      index += 1
    ) {
      const message = displayMessages[index];
      if (
        message.role === "assistant" &&
        message.metadata?.status === "streaming"
      ) {
        liveAssistantMessageIds.add(message.id);
      }
    }
  }
  const hasVisibleAgentResponse = displayMessages
    .slice(lastUserDisplayIndex + 1)
    .some(
      (message) =>
        message.role === "assistant" &&
        message.parts.some(isVisibleAgentResponsePart),
    );
  const hasLiveToolActivity = displayMessages
    .slice(lastUserDisplayIndex + 1)
    .some(
      (message) =>
        message.role === "assistant" &&
        message.metadata?.status === "streaming" &&
        message.parts.some(isLiveToolActivityPart),
    );
  const isWaitingForAgent =
    isBusy &&
    !hasLiveToolActivity &&
    (!hasVisibleAgentResponse ||
      isWaitingForNextAgentActivity(lastEvent) ||
      textStreamStalled);
  const visibleMessages = displayMessages.filter((message) =>
    message.parts.some(isVisibleAgentResponsePart),
  );
  const lastUserVisibleIndex = visibleMessages.findLastIndex(
    (message) => message.role === "user",
  );
  const turnDurations = new Map<string, number>();
  const turnStarts = new Map<string, number>();
  for (const event of events) {
    if (event.type === "turn.started") {
      turnStarts.set(event.data.turnId, Date.parse(event.meta.at));
    } else if (
      event.type === "turn.completed" ||
      event.type === "turn.failed" ||
      event.type === "turn.cancelled"
    ) {
      const start = turnStarts.get(event.data.turnId);
      const end = Date.parse(event.meta.at);
      if (start !== undefined && Number.isFinite(start) && Number.isFinite(end)) {
        turnDurations.set(event.data.turnId, Math.max(1, Math.round((end - start) / 1000)));
      }
    }
  }

  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="w-full gap-6 px-4 py-6 sm:px-5">
        {/* A streaming turn starts with a step-start-only shell. Filtering it
            avoids a zero-height message claiming a gap in the conversation. */}
        {visibleMessages.map((message, index) => {
          const isFailedUserMessage = Boolean(errorMessage) && index === lastUserVisibleIndex;
          return (
            <AgentMessage
              canRespond={!isBusy}
              isLive={liveAssistantMessageIds.has(message.id)}
              isStreaming={
                status === "streaming" && index === visibleMessages.length - 1
              }
              key={message.id}
              message={message}
              turnDuration={message.metadata?.turnId ? turnDurations.get(message.metadata.turnId) : undefined}
              toolCallVerbosity={toolCallVerbosity}
              reasoningVerbosity={reasoningVerbosity}
              onInputResponses={onInputResponses}
              isFailed={isFailedUserMessage}
              onRetry={isFailedUserMessage ? onRetry : undefined}
            />
          );
        })}
        {isBusy && isCompacting ? (
          <AgentCompactionIndicator />
        ) : isWaitingForAgent ? (
          <AgentWorkingIndicator
            isInitialTurn={isInitialTurn}
            lastEvent={lastEvent}
          />
        ) : null}
      </ConversationContent>
      <ScrollOnSend signal={sendScrollSignal} />
      <ConversationScrollButton />
    </Conversation>
  );
}

// Stick-to-bottom only follows the content while the user is already at the
// bottom, so a message sent from mid-history would land below the fold. The
// chat bumps `signal` on every send; scrollToBottom re-engages following and
// animates down. The library keeps that scroll user-interruptible: a wheel-up
// or upward touch scroll during the animation escapes the lock and cancels it
// (ignoreEscapes defaults to false).
function ScrollOnSend({ signal }: { readonly signal: number }) {
  const { scrollToBottom } = useStickToBottomContext();
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    scrollToBottom();
  }, [signal, scrollToBottom]);
  return null;
}

function AgentWorkingIndicator({
  isInitialTurn,
  lastEvent,
}: {
  readonly isInitialTurn: boolean;
  readonly lastEvent?: MessageStreamEvent;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    setElapsedSeconds(0);
    const timer = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [lastEvent?.type]);

  const cue = agentWorkingCue(isInitialTurn, lastEvent, elapsedSeconds);
  const Icon = cue.usesComputer ? Cpu : PenLine;
  return (
    <div
      aria-label={cue.ariaLabel}
      className="flex min-h-7 items-center gap-2 py-0.5 text-xs text-muted-foreground"
      role="status"
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <Shimmer duration={1}>{cue.label}</Shimmer>
    </div>
  );
}

function agentWorkingCue(
  isInitialTurn: boolean,
  lastEvent: MessageStreamEvent | undefined,
  elapsedSeconds = 0,
) {
  if (!isInitialTurn) {
    return {
      ariaLabel: "Beeblio is working",
      label: "Working...",
      usesComputer: false,
    };
  }
  if (!lastEvent) {
    return {
      ariaLabel: "Beeblio is thinking",
      label: "Thinking...",
      usesComputer: false,
    };
  }
  if (lastEvent.type === "turn.started") {
    return {
      ariaLabel: "Loading tools and context",
      label: elapsedSeconds >= 4 ? "Preparing Workspace Tools..." : "Loading Tools & Context...",
      usesComputer: false,
    };
  }
  return {
    ariaLabel: "Beeblio is thinking",
    label: "Thinking...",
    usesComputer: false,
  };
}

function AgentCompactionIndicator() {
  return (
    <div
      aria-label="Summarizing earlier conversation"
      className="flex min-h-7 items-center gap-2 py-0.5 text-xs text-muted-foreground"
      role="status"
    >
      <ScrollText aria-hidden="true" className="size-3.5 shrink-0" />
      <Shimmer duration={1}>Summarizing earlier conversation...</Shimmer>
    </div>
  );
}

function isVisibleAgentResponsePart(part: EveMessagePart): boolean {
  if (part.type === "step-start") return false;
  if (part.type === "text" || part.type === "reasoning") {
    return part.text.trim().length > 0;
  }
  return true;
}

function isLiveToolActivityPart(part: EveMessagePart): boolean {
  return part.type === "dynamic-tool" && (
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    (part.state === "output-available" && part.partial === true)
  );
}

function isWaitingForNextAgentActivity(
  event: MessageStreamEvent | undefined,
): boolean {
  if (!event) return true;

  return (
    event.type === "turn.started" ||
    event.type === "message.received" ||
    event.type === "step.started" ||
    event.type === "actions.requested" ||
    event.type === "step.completed" ||
    event.type === "action.result" ||
    event.type === "message.completed" ||
    event.type === "reasoning.completed"
  );
}
