import { v4 as uuidv4 } from "uuid";

const SESSION_KEY = "mapapp_session";

export function getOrCreateSession(): string {
  if (typeof window === "undefined") return "";
  let session = localStorage.getItem(SESSION_KEY);
  if (!session) {
    session = uuidv4();
    localStorage.setItem(SESSION_KEY, session);
  }
  return session;
}
