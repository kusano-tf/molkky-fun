import { Peer, type DataConnection } from "peerjs";
import type { Match as Game } from "./match";
import { LIVE_PROTOCOL, decodeSnapshot, encodeHeartbeat, encodeHello, encodeSnapshot, isHeartbeat, isHello, type LiveInvitation } from "./liveProtocol";

// Explicitly override PeerJS defaults: STUN only, with no TURN relays.
export const LIVE_PEER_OPTIONS = {
  secure: true,
  config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
};
export type HostState = { phase: "starting" | "ready" | "offline" | "error"; invitation: LiveInvitation | null; viewers: number; error: string };
export type ViewerState = { phase: "connecting" | "live" | "disconnected" | "error"; error: string; updatedAt: number | null };
export type LiveController = { stop: () => void };
export type HostController = LiveController & { publish: (game: Game | null) => void };

function errorMessage(error: unknown): string {
  const type = error && typeof error === "object" && "type" in error ? error.type : "";
  if (type === "peer-unavailable") return "共有元が見つかりません。親端末で共有が続いているか確認してください。";
  if (type === "browser-incompatible") return "このブラウザーはライブ共有に対応していません。";
  if (type === "webrtc") return "この回線の組み合わせでは直接接続できませんでした。";
  return "接続できませんでした。通信状態を確認して、もう一度お試しください。";
}

export function createLiveHost(game: Game | null, onState: (state: HostState) => void): HostController {
  const invitation: LiveInvitation = { peerId: `mf-${crypto.randomUUID()}`, token: crypto.randomUUID().replaceAll("-", "") };
  const peer = new Peer(invitation.peerId, LIVE_PEER_OPTIONS);
  const connections = new Map<DataConnection, { authorized: boolean; timeout: ReturnType<typeof setTimeout> }>();
  let disposed = false;
  let revision = 0;
  let message = encodeSnapshot(invitation.peerId, revision, game);
  let phase: HostState["phase"] = "starting";
  let error = "";
  const emit = () => {
    if (!disposed) onState({ phase, error, invitation: phase === "starting" ? null : invitation, viewers: [...connections.values()].filter((connection) => connection.authorized).length });
  };
  const send = (connection: DataConnection, data: string) => {
    if (!connection.open) return;
    try { connection.send(data); } catch { connection.close(); }
  };
  const stop = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(startTimeout);
    clearInterval(heartbeat);
    for (const [connection, state] of connections) {
      clearTimeout(state.timeout);
      connection.close();
    }
    connections.clear();
    peer.destroy();
  };
  const startTimeout = setTimeout(() => {
    phase = "error"; error = "共有の準備ができませんでした。通信状態を確認してください。"; emit(); stop();
  }, 25_000);
  const heartbeat = setInterval(() => {
    for (const [connection, state] of connections) if (state.authorized) send(connection, encodeHeartbeat(invitation.peerId));
  }, 4_000);
  peer.on("open", () => { clearTimeout(startTimeout); phase = "ready"; error = ""; emit(); });
  peer.on("connection", (connection) => {
    if (disposed || connection.label !== LIVE_PROTOCOL || connections.size >= 16) { connection.close(); return; }
    const state = { authorized: false, timeout: setTimeout(() => connection.close(), 10_000) };
    connections.set(connection, state);
    connection.on("data", (data) => {
      if (disposed || state.authorized) return; // Viewer messages never mutate the parent game.
      if (!isHello(data, invitation.token)) { connection.close(); return; }
      state.authorized = true;
      clearTimeout(state.timeout);
      send(connection, message);
      emit();
    });
    const remove = () => { clearTimeout(state.timeout); connections.delete(connection); emit(); };
    connection.on("close", remove);
    connection.on("error", () => { remove(); connection.close(); });
  });
  peer.on("call", (call) => call.close());
  peer.on("disconnected", () => { phase = "offline"; error = "新しい接続の受付が中断しています。接続済みの端末への配信は続きます。"; emit(); });
  peer.on("error", (cause) => { phase = "error"; error = errorMessage(cause); emit(); stop(); });
  emit();
  return {
    stop,
    publish(nextGame) {
      if (disposed) return;
      message = encodeSnapshot(invitation.peerId, ++revision, nextGame);
      for (const [connection, state] of connections) if (state.authorized) send(connection, message);
    },
  };
}

export function createLiveViewer(invitation: LiveInvitation, onState: (state: ViewerState) => void, onGame: (game: Game | null) => void): LiveController {
  const peer = new Peer(LIVE_PEER_OPTIONS);
  let disposed = false;
  let connection: DataConnection | undefined;
  let revision = -1;
  let lastSeen = Date.now();
  let updatedAt: number | null = null;
  let received = false;
  const stop = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(watchdog);
    connection?.close();
    peer.destroy();
  };
  const fail = (phase: "disconnected" | "error", error: string) => {
    if (disposed) return;
    onState({ phase, error, updatedAt });
    stop();
  };
  const watchdog = setInterval(() => {
    if (Date.now() - lastSeen > (received ? 20_000 : 30_000)) fail(received ? "disconnected" : "error", received
      ? "更新が途切れました。最後に受信した内容を表示しています。"
      : "直接接続できませんでした。共有元や回線の組み合わせを確認してください。");
  }, 2_000);
  peer.on("open", () => {
    if (disposed) return;
    connection = peer.connect(invitation.peerId, { label: LIVE_PROTOCOL, serialization: "json", reliable: true });
    connection.on("open", () => {
      try { connection?.send(encodeHello(invitation.token)); }
      catch { fail("error", "共有元への接続を開始できませんでした。"); }
    });
    connection.on("data", (data) => {
      if (disposed) return;
      if (isHeartbeat(data, invitation.peerId)) { if (received) lastSeen = Date.now(); return; }
      const snapshot = decodeSnapshot(data, invitation.peerId, revision);
      if (!snapshot) return;
      revision = snapshot.revision;
      received = true;
      updatedAt = lastSeen = Date.now();
      onGame(snapshot.game);
      onState({ phase: "live", error: "", updatedAt });
    });
    connection.on("close", () => fail("disconnected", "共有元との接続が終了しました。最後に受信した内容を表示しています。"));
    connection.on("error", (cause) => fail("error", errorMessage(cause)));
  });
  peer.on("connection", (incoming) => incoming.close());
  peer.on("call", (call) => call.close());
  peer.on("error", (cause) => fail("error", errorMessage(cause)));
  peer.on("close", () => fail("disconnected", "接続が終了しました。"));
  return { stop };
}
