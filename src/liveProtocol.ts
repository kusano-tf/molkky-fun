import { isValidMatch, type Match as Game } from "./match";

export const LIVE_PROTOCOL = "molkky-fun/live";
// Version 3 carries matches, set orders and confirmation state.
export const LIVE_VERSION = 3;
export const MAX_LIVE_MESSAGE_LENGTH = 1_000_000;

export type LiveInvitation = { peerId: string; token: string };
const INVITATION_PATTERN = /^mf1\.([a-zA-Z0-9_-]{1,100})\.([a-f0-9]{32})$/;

export function invitationCode(invitation: LiveInvitation): string {
  return `mf1.${invitation.peerId}.${invitation.token}`;
}

export function invitationUrl(baseUrl: string, invitation: LiveInvitation): string {
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = new URLSearchParams({ watch: invitationCode(invitation) }).toString();
  return url.href;
}

export function parseInvitation(input: string): LiveInvitation | null {
  let code = input.trim();
  if (code.length > 2048) return null;
  if (!code.startsWith("mf1.")) {
    try {
      const url = new URL(code);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      code = new URLSearchParams(url.hash.slice(1)).get("watch") ?? "";
    } catch { return null; }
  }
  const match = INVITATION_PATTERN.exec(code);
  return match ? { peerId: match[1], token: match[2] } : null;
}

export function encodeHello(token: string): string {
  return JSON.stringify({ protocol: LIVE_PROTOCOL, version: LIVE_VERSION, type: "hello", token });
}

export function isHello(message: unknown, token: string): boolean {
  if (typeof message !== "string" || message.length > 512) return false;
  try {
    const hello = JSON.parse(message);
    return hello?.protocol === LIVE_PROTOCOL && hello?.version === LIVE_VERSION && hello?.type === "hello" && hello?.token === token;
  } catch { return false; }
}

export function encodeHeartbeat(sessionId: string): string {
  return JSON.stringify({ protocol: LIVE_PROTOCOL, version: LIVE_VERSION, type: "heartbeat", sessionId });
}

export function isHeartbeat(message: unknown, sessionId: string): boolean {
  if (typeof message !== "string" || message.length > 512) return false;
  try {
    const heartbeat = JSON.parse(message);
    return heartbeat?.protocol === LIVE_PROTOCOL && heartbeat?.version === LIVE_VERSION && heartbeat?.type === "heartbeat" && heartbeat?.sessionId === sessionId;
  } catch { return false; }
}

export type LiveSnapshot = {
  protocol: typeof LIVE_PROTOCOL;
  version: typeof LIVE_VERSION;
  type: "snapshot";
  sessionId: string;
  revision: number;
  game: Game | null;
};

export function encodeSnapshot(sessionId: string, revision: number, game: Game | null): string {
  return JSON.stringify({ protocol: LIVE_PROTOCOL, version: LIVE_VERSION, type: "snapshot", sessionId, revision, game } satisfies LiveSnapshot);
}

// Remote data stays separate from the viewer's own saved games. The parent
// publishes complete snapshots so reconnects and undone throws use one path.
export function decodeSnapshot(message: unknown, sessionId: string, lastRevision: number): LiveSnapshot | null {
  if (typeof message !== "string" || message.length > MAX_LIVE_MESSAGE_LENGTH) return null;
  try {
    const value: unknown = JSON.parse(message);
    if (!value || typeof value !== "object") return null;
    const snapshot = value as Partial<LiveSnapshot>;
    if (
      snapshot.protocol !== LIVE_PROTOCOL || snapshot.version !== LIVE_VERSION ||
      snapshot.type !== "snapshot" || snapshot.sessionId !== sessionId ||
      !Number.isSafeInteger(snapshot.revision) || snapshot.revision! < 0 ||
      snapshot.revision! <= lastRevision ||
      !(snapshot.game === null || isValidMatch(snapshot.game))
    ) return null;
    return snapshot as LiveSnapshot;
  } catch {
    return null;
  }
}
