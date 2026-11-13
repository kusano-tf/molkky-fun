import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGame } from "./game";
import { createLiveHost, createLiveViewer, LIVE_PEER_OPTIONS } from "./liveTransport";
import { encodeHello, encodeSnapshot, LIVE_PROTOCOL } from "./liveProtocol";

const fake = vi.hoisted(() => {
  class Emitter {
    listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    on(event: string, callback: (...args: unknown[]) => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), callback]);
      return this;
    }
    emit(event: string, ...args: unknown[]) { for (const callback of this.listeners.get(event) ?? []) callback(...args); }
  }
  class Connection extends Emitter {
    label = "molkky-fun/live";
    open = true;
    sent: string[] = [];
    send(data: string) { this.sent.push(data); }
    close() { if (this.open) { this.open = false; this.emit("close"); } }
  }
  const peers: Peer[] = [];
  class Peer extends Emitter {
    destroyed = false;
    outgoing = new Connection();
    constructor(..._args: unknown[]) { super(); peers.push(this); }
    connect() { return this.outgoing; }
    destroy() { this.destroyed = true; this.outgoing.close(); this.emit("close"); }
  }
  return { Peer, Connection, peers };
});
vi.mock("peerjs", () => ({ Peer: fake.Peer }));

describe("live transport", () => {
  const game = createGame([{ id: "a", name: "A" }, { id: "b", name: "B" }]);
  const invitation = { peerId: "mf-parent", token: "a".repeat(32) };
  beforeEach(() => { fake.peers.length = 0; vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("uses only STUN, never TURN", () => {
    expect(LIVE_PEER_OPTIONS.config.iceServers).toEqual([{ urls: "stun:stun.l.google.com:19302" }]);
  });

  it("authenticates each viewer, broadcasts only the current game, and ignores child edits", () => {
    const state = vi.fn();
    const host = createLiveHost(game, state);
    const peer = fake.peers[0];
    peer.emit("open");
    const token = state.mock.lastCall![0].invitation.token;
    const invalid = new fake.Connection();
    peer.emit("connection", invalid);
    invalid.emit("data", encodeHello("wrong"));
    expect(invalid.open).toBe(false);
    expect(invalid.sent).toHaveLength(0);
    const a = new fake.Connection(), b = new fake.Connection(), unauthenticated = new fake.Connection();
    for (const connection of [a, b, unauthenticated]) peer.emit("connection", connection);
    for (const connection of [a, b]) connection.emit("data", encodeHello(token));
    expect(state.mock.lastCall![0].viewers).toBe(2);
    const updated = { ...game, turns: [{ playerId: "a", pins: [12], playedAt: new Date().toISOString() }] };
    host.publish(updated);
    for (const connection of [a, b]) {
      expect(JSON.parse(connection.sent.at(-1)!)).toMatchObject({ type: "snapshot", revision: 1, game: updated });
      expect(JSON.parse(connection.sent.at(-1)!)).not.toHaveProperty("history");
    }
    expect(unauthenticated.sent).toHaveLength(0);
    a.emit("data", encodeSnapshot("fake", 10, null));
    const c = new fake.Connection(); peer.emit("connection", c); c.emit("data", encodeHello(token));
    expect(JSON.parse(c.sent[0]).game).toEqual(updated);
    a.close();
    expect(state.mock.lastCall![0].viewers).toBe(2);
    host.stop();
    expect(peer.destroyed).toBe(true);
    expect(b.open).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes unauthenticated connections and stalled host startup", () => {
    const state = vi.fn();
    createLiveHost(game, state);
    const connection = new fake.Connection(); fake.peers[0].emit("connection", connection);
    vi.advanceTimersByTime(10_000);
    expect(connection.open).toBe(false);
    vi.advanceTimersByTime(15_000);
    expect(state.mock.lastCall![0].phase).toBe("error");
    expect(fake.peers[0].destroyed).toBe(true);
  });

  it("receives valid snapshots, skips stale data, and marks loss of updates", () => {
    const state = vi.fn(), onGame = vi.fn();
    createLiveViewer(invitation, state, onGame);
    const peer = fake.peers[0]; peer.emit("open");
    const connection = peer.outgoing; connection.emit("open");
    expect(JSON.parse(connection.sent[0])).toMatchObject({ type: "hello", token: invitation.token });
    connection.emit("data", encodeSnapshot(invitation.peerId, 2, game));
    expect(onGame).toHaveBeenCalledWith(game);
    expect(state.mock.lastCall![0].phase).toBe("live");
    connection.emit("data", encodeSnapshot(invitation.peerId, 1, null));
    connection.emit("data", encodeSnapshot("another-parent", 3, null));
    expect(onGame).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(22_000);
    expect(state.mock.lastCall![0].phase).toBe("disconnected");
    expect(onGame).toHaveBeenCalledTimes(1); // Last snapshot remains visible.
    expect(peer.destroyed).toBe(true);
  });

  it("times out failed direct connections and stops without late callbacks", () => {
    const state = vi.fn(), onGame = vi.fn();
    createLiveViewer(invitation, state, onGame);
    vi.advanceTimersByTime(32_000);
    expect(state.mock.lastCall![0].phase).toBe("error");
    const viewer = createLiveViewer(invitation, state, onGame);
    const peer = fake.peers[1]; peer.emit("open");
    viewer.stop();
    const calls = state.mock.calls.length;
    peer.outgoing.emit("data", encodeSnapshot(invitation.peerId, 1, game));
    expect(onGame).not.toHaveBeenCalled();
    expect(state).toHaveBeenCalledTimes(calls);
    expect(peer.outgoing.label).toBe(LIVE_PROTOCOL);
  });
});
