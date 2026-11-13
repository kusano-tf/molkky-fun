import { useCallback, useEffect, useRef, useState } from "react";
import type { Game } from "./game";
import { invitationUrl, parseInvitation, type LiveInvitation } from "./liveProtocol";
import type { HostController, HostState, LiveController, ViewerState } from "./liveTransport";

export function useLiveSharing(game: Game | null) {
  const [host, setHost] = useState<HostState | null>(null);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [remoteGame, setRemoteGame] = useState<Game | null>(null);
  const [invitation, setInvitation] = useState<LiveInvitation | null>(null);
  const hostRef = useRef<HostController | null>(null);
  const viewerRef = useRef<LiveController | null>(null);
  const hostGeneration = useRef(0);
  const viewerGeneration = useRef(0);
  const gameRef = useRef(game);
  gameRef.current = game;

  const stopHost = useCallback(() => {
    hostGeneration.current++;
    hostRef.current?.stop();
    hostRef.current = null;
    setHost(null);
  }, []);

  const startHost = async () => {
    if (!gameRef.current || viewer) return;
    stopHost();
    const generation = ++hostGeneration.current;
    setHost({ phase: "starting", invitation: null, viewers: 0, error: "" });
    try {
      const { createLiveHost } = await import("./liveTransport");
      if (generation !== hostGeneration.current) return;
      hostRef.current = createLiveHost(gameRef.current, (state) => {
        if (generation === hostGeneration.current) setHost(state);
      });
    } catch {
      if (generation === hostGeneration.current) setHost({ phase: "error", invitation: null, viewers: 0, error: "ライブ共有を開始できませんでした。" });
    }
  };

  const join = useCallback(async (nextInvitation: LiveInvitation, keepSnapshot = false) => {
    stopHost();
    const generation = ++viewerGeneration.current;
    viewerRef.current?.stop();
    viewerRef.current = null;
    setInvitation(nextInvitation);
    window.history.replaceState(null, "", invitationUrl(window.location.href, nextInvitation));
    if (!keepSnapshot) setRemoteGame(null);
    setViewer({ phase: "connecting", error: "", updatedAt: null });
    try {
      const { createLiveViewer } = await import("./liveTransport");
      if (generation !== viewerGeneration.current) return;
      viewerRef.current = createLiveViewer(nextInvitation, (state) => {
        if (generation === viewerGeneration.current) setViewer(state);
      }, (nextGame) => {
        if (generation === viewerGeneration.current) setRemoteGame(nextGame);
      });
    } catch {
      if (generation === viewerGeneration.current) setViewer({ phase: "error", error: "ライブ観戦を開始できませんでした。", updatedAt: null });
    }
  }, [stopHost]);

  const leave = useCallback(() => {
    viewerGeneration.current++;
    viewerRef.current?.stop();
    viewerRef.current = null;
    setViewer(null);
    setRemoteGame(null);
    setInvitation(null);
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.slice(1));
    if (fragment.has("watch")) {
      fragment.delete("watch");
      url.hash = fragment.toString();
      window.history.replaceState(null, "", url);
    }
  }, []);

  useEffect(() => { hostRef.current?.publish(game); }, [game]);

  useEffect(() => {
    const handleLink = () => {
      const nextInvitation = parseInvitation(window.location.href);
      if (nextInvitation) void join(nextInvitation);
    };
    handleLink();
    window.addEventListener("hashchange", handleLink);
    return () => window.removeEventListener("hashchange", handleLink);
  }, [join]);

  useEffect(() => () => {
    hostGeneration.current++;
    viewerGeneration.current++;
    hostRef.current?.stop();
    viewerRef.current?.stop();
  }, []);

  return { host, viewer, remoteGame, startHost, stopHost, join, leave, retry: () => { if (invitation) void join(invitation, true); } };
}
