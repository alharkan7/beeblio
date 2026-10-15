"use server";

import { requireUser } from "@/lib/auth/session";
import { findCitationForSelection, type FindCitationResult } from "@/lib/citation-finder";

export async function findCitationForSelectionAction(
  projectId: string,
  selectedText: string,
): Promise<FindCitationResult> {
  const user = await requireUser();
  return findCitationForSelection(user.id, projectId, selectedText);
}
