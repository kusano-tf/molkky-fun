import { t } from "./i18n";
import { useEffect, useState } from "react";
import { invitationCode, invitationUrl, parseInvitation, type LiveInvitation } from "./liveProtocol";
import type { HostState, ViewerState } from "./liveTransport";

export function LiveSharingPanel({ host, viewer, onStart, onStop, onJoin, onLeave, onRetry }: {
  host: HostState | null;
  viewer: ViewerState | null;
  onStart: () => void;
  onStop: () => void;
  onJoin: (invitation: LiveInvitation) => void;
  onLeave: () => void;
  onRetry: () => void;
}) {
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState("");
  const [qr, setQr] = useState("");
  const url = host?.invitation ? invitationUrl(window.location.href, host.invitation) : "";
  useEffect(() => {
    let cancelled = false;
    setQr("");
    if (url) {
      import("qrcode").then((qrCode) => qrCode.toDataURL(url, { width: 280, margin: 2, errorCorrectionLevel: "M" }))
        .then((value) => { if (!cancelled) setQr(value); })
        .catch(() => { if (!cancelled) setNotice("QRコードを作成できませんでした。URLを共有してください。"); });
    }
    return () => { cancelled = true; };
  }, [url]);

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice("コピーしました。"); }
    catch { setNotice("コピーできませんでした。接続URLを長押ししてコピーしてください。"); }
  }
  async function share() {
    if (!navigator.share) { await copy(url); return; }
    try { await navigator.share({ title: t("Mölkky Fun ライブ観戦"), url }); }
    catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) await copy(url); }
  }

  return (
    <div className="live-sharing-panel">
      {viewer ? (
        <section className="live-section">
          <h3>{t("ライブ観戦中")}</h3>
          <p>{t("この端末は閲覧専用です。")}</p>
          {viewer.error && <p role="status">{t(viewer.error)}</p>}
          {viewer.phase !== "live" && viewer.phase !== "connecting" && <button className="primary-button" onClick={onRetry}>{t("再接続する")}</button>}
          <button className="text-button" onClick={onLeave}>{t("観戦を終了して自分の画面に戻る")}</button>
        </section>
      ) : (
        <>
          <section className="live-section">
            <h3>{t("この試合を共有")}</h3>
            {!host ? <>
              <p>{t("ほかの端末に試合をリアルタイムで表示します。")}</p>
              <button className="primary-button" onClick={onStart}>{t("ライブ共有を始める")}</button>
            </> : <>
              <p role="status">{host.phase === "starting" ? t("共有の準備中…") : host.phase === "ready" ? t("{0} 台が観戦中", [host.viewers]) : host.error ? t(host.error) : ""}</p>
              {host.phase !== "starting" && host.phase !== "error" && url && <>
                {qr && <img className="live-qr" src={qr} alt={t("ライブ観戦の接続QRコード")} width="280" height="280" />}
                <label className="live-field">{t("接続URL")}<input readOnly value={url} onFocus={(event) => event.target.select()} /></label>
                <div className="live-share-actions">
                  <button className="primary-button" onClick={() => void share()}>{t("URLをシェア ↗")}</button>
                  <button className="text-button" onClick={() => void copy(url)}>{t("URLをコピー")}</button>
                  <button className="text-button" onClick={() => void copy(invitationCode(host.invitation!))}>{t("接続文字列をコピー")}</button>
                </div>
              </>}
              {(host.phase === "error" || host.phase === "offline") && <button className="primary-button" onClick={onStart}>{t("共有をやり直す")}</button>}
              <button className="text-button" onClick={onStop}>{t("共有を停止する")}</button>
            </>}
          </section>
          {!host && <section className="live-section">
            <h3>{t("共有された試合を見る")}</h3>
            <form onSubmit={(event) => {
              event.preventDefault();
              const invitation = parseInvitation(input);
              if (!invitation) { setNotice("接続URLまたは接続文字列を確認してください。"); return; }
              setNotice("");
              onJoin(invitation);
            }}>
              <label className="live-field">{t("接続URL・接続文字列")}<textarea rows={3} value={input} onChange={(event) => setInput(event.target.value)} placeholder={t("共有されたURLや接続文字列を貼り付け")} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={2048} /></label>
              <button className="primary-button" disabled={!input.trim()}>{t("観戦する →")}</button>
            </form>
          </section>}
        </>
      )}
      {notice && <p className="notice" role="status">{t(notice)}</p>}
    </div>
  );
}
