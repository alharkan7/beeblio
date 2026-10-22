import assert from "node:assert/strict";
import test from "node:test";
import { selectFolderLinux } from "../lib/folder-picker-linux";

function failure(code: string | number) {
  return Object.assign(new Error(`Picker failed: ${code}`), { code });
}

test("Linux picker returns the selected folder", async () => {
  assert.equal(await selectFolderLinux(async () => ({ stdout: "/home/user/project\n" })), "/home/user/project");
});

test("cancelling Zenity stops without opening KDialog", async () => {
  const commands: string[] = [];
  assert.equal(await selectFolderLinux(async (command) => {
    commands.push(command);
    throw failure(1);
  }), null);
  assert.deepEqual(commands, ["zenity"]);
});

test("missing Zenity falls back to KDialog", async () => {
  const commands: string[] = [];
  assert.equal(await selectFolderLinux(async (command) => {
    commands.push(command);
    if (command === "zenity") throw failure("ENOENT");
    return { stdout: "/home/user/project\n" };
  }), "/home/user/project");
  assert.deepEqual(commands, ["zenity", "kdialog"]);
});

test("cancelling KDialog returns a cancellation", async () => {
  assert.equal(await selectFolderLinux(async (command) => {
    throw failure(command === "zenity" ? "ENOENT" : 1);
  }), null);
});

test("missing both pickers explains how to proceed", async () => {
  await assert.rejects(selectFolderLinux(async () => {
    throw failure("ENOENT");
  }), /Install one of these tools or paste an absolute folder path/);
});

test("picker failures and timeouts preserve the error without opening another picker", async () => {
  for (const code of [255, "EACCES", "ETIMEDOUT"]) {
    const error = failure(code);
    const commands: string[] = [];
    await assert.rejects(selectFolderLinux(async (command) => {
      commands.push(command);
      throw error;
    }), (actual) => actual === error);
    assert.deepEqual(commands, ["zenity"]);
  }
});
