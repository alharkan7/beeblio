import type { EveMessage } from "eve/react";

/** Hide a retried prompt only after its replacement exists in the message list. */
export function filterRetriedMessages(
  messages: readonly EveMessage[],
  retriedMessageIds?: ReadonlySet<string>,
): EveMessage[] {
  if (!retriedMessageIds?.size) return [...messages];

  return messages.filter((message, index) => {
    if (message.role !== "user" || !retriedMessageIds.has(message.id)) return true;
    const text = message.parts.find((part) => part.type === "text")?.text;
    if (!text) return true;
    const nextUser = messages.slice(index + 1).find((later) => later.role === "user");
    return !nextUser?.parts.some((part) => part.type === "text" && part.text === text);
  });
}
