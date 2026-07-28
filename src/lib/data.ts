// ABOUTME: The user roster — stand-in for auth until accounts exist. All bug/draft data is
// ABOUTME: real: captured by the extension (or demo capture) and persisted in IndexedDB/storage.
import type { Reporter } from "./types";

export const USERS: Reporter[] = [
  { id: "u1", name: "Pritam Sharma", email: "pritam@emergent.sh" },
  { id: "u2", name: "Maya Chen", email: "maya@emergent.sh" },
  { id: "u3", name: "Dev Patel", email: "dev@emergent.sh" },
  { id: "u4", name: "Sara Kim", email: "sara@emergent.sh" },
];
export const ME = USERS[0];
