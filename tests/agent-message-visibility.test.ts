import assert from "node:assert/strict";
import test from "node:test";
import type { EveMessage } from "eve/react";

import { filterRetriedMessages } from "../app/_components/agent-message-visibility";

const user = (id: string, text: string) => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
}) as EveMessage;

test("keeps intentional repeated prompts", () => {
  const messages = [user("first", "Again"), user("second", "Again")];
  assert.deepEqual(filterRetriedMessages(messages).map((message) => message.id), ["first", "second"]);
});

test("keeps a failed prompt visible until its retry appears", () => {
  const original = user("first", "Again");
  const retried = new Set([original.id]);
  assert.deepEqual(filterRetriedMessages([original], retried).map((message) => message.id), ["first"]);
  assert.deepEqual(
    filterRetriedMessages([original, user("second", "Again")], retried).map((message) => message.id),
    ["second"],
  );
});

test("does not hide a prompt when the next user message differs", () => {
  const messages = [user("first", "Again"), user("second", "Different"), user("third", "Again")];
  assert.deepEqual(
    filterRetriedMessages(messages, new Set(["first"])).map((message) => message.id),
    ["first", "second", "third"],
  );
});
