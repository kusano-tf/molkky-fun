import { useEffect, useRef, type ReactNode } from "react";

export function OverlayDialog({ open, title, pageKey, onClose, onBack, children }: {
  open: boolean;
  title: string;
  pageKey: string;
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    contentRef.current?.scrollTo({ top: 0, behavior: "instant" });
    headingRef.current?.focus({ preventScroll: true });
  }, [open, pageKey]);

  return (
    <dialog
      ref={dialogRef}
      className="overlay-dialog"
      aria-labelledby="overlay-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="overlay-panel">
        <header className="overlay-header">
          {onBack && <button type="button" className="text-button" onClick={onBack}>← 戻る</button>}
          <h2 id="overlay-title" ref={headingRef} tabIndex={-1}>{title}</h2>
          <button type="button" className="icon-button" aria-label="閉じて元の画面に戻る" onClick={onClose}>×</button>
        </header>
        <div className="overlay-content" ref={contentRef}>{children}</div>
      </div>
    </dialog>
  );
}
