import { describe, expect, it } from "vitest";
import { decodeSnapshot, encodeSnapshot, encodeHello, encodeHeartbeat, invitationCode, invitationUrl, isHeartbeat, isHello, parseInvitation } from "./liveProtocol";
import { createGame } from "./game";

describe("live snapshots", () => {
  const game = createGame([{ id: "a", name: "A" }, { id: "b", name: "B" }]);

  it("accepts a valid current game and a subsequent waiting state", () => {
    expect(decodeSnapshot(encodeSnapshot("session", 0, game), "session", -1)?.game).toEqual(game);
    expect(decodeSnapshot(encodeSnapshot("session", 1, null), "session", 0)?.game).toBeNull();
  });

  it("ignores stale snapshots and messages from another session", () => {
    expect(decodeSnapshot(encodeSnapshot("session", 3, game), "session", 3)).toBeNull();
    expect(decodeSnapshot(encodeSnapshot("session", 2, game), "session", 3)).toBeNull();
    expect(decodeSnapshot(encodeSnapshot("other", 4, game), "session", 3)).toBeNull();
  });

  it("rejects malformed data, unsupported protocols, and invalid game histories", () => {
    expect(decodeSnapshot("not JSON", "session", -1)).toBeNull();
    expect(decodeSnapshot("x".repeat(1_000_001), "session", -1)).toBeNull();
    const snapshot = JSON.parse(encodeSnapshot("session", 0, game));
    for (const change of [{ version: 1 }, { version: 99 }, { type: "edit" }, { revision: -1 }, { revision: 0.5 }, { game: {} }]) {
      expect(decodeSnapshot(JSON.stringify({ ...snapshot, ...change }), "session", -1)).toBeNull();
    }
    const invalid = { ...game, turns: [{ playerId: "b", pins: [12], playedAt: new Date().toISOString() }] };
    expect(decodeSnapshot(encodeSnapshot("session", 0, invalid), "session", -1)).toBeNull();
  });

  it("accepts undo and next-match snapshots without transmitting local history", () => {
    const played = { ...game, turns: [{ playerId: "a", pins: [12], playedAt: new Date().toISOString() }] };
    expect(decodeSnapshot(encodeSnapshot("session", 1, played), "session", 0)?.game?.turns).toHaveLength(1);
    expect(decodeSnapshot(encodeSnapshot("session", 2, game), "session", 1)?.game?.turns).toHaveLength(0);
    expect(JSON.parse(encodeSnapshot("session", 3, game))).not.toHaveProperty("history");
  });
});

describe("live invitations and handshake", () => {
  const invitation = { peerId: "mf-test-peer", token: "a".repeat(32) };
  it("accepts shared URLs and pasted codes, including nested PWA paths", () => {
    const url = invitationUrl("https://example.com/molkky-fun/?old=value#old", invitation);
    expect(url).toBe(`https://example.com/molkky-fun/#watch=${invitationCode(invitation)}`);
    expect(parseInvitation(url)).toEqual(invitation);
    expect(parseInvitation(`  ${invitationCode(invitation)}\n`)).toEqual(invitation);
  });
  it.each(["", "mf1.peer.short", "https://example.com/#watch=bad", "javascript:alert(1)", "x".repeat(2049)])("rejects invalid invitation %s", (input) => {
    expect(parseInvitation(input)).toBeNull();
  });
  it("requires a matching token and a supported protocol for the handshake", () => {
    expect(isHello(encodeHello(invitation.token), invitation.token)).toBe(true);
    expect(isHello(encodeHello("wrong"), invitation.token)).toBe(false);
    expect(isHello('{"type":"edit"}', invitation.token)).toBe(false);
    expect(isHello(null, invitation.token)).toBe(false);
    expect(isHeartbeat(encodeHeartbeat("peer"), "peer")).toBe(true);
    expect(isHeartbeat(encodeHeartbeat("other"), "peer")).toBe(false);
  });
});
