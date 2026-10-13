"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function photoUrl(id: string, version?: string | null) {
  return version ? `/api/employees/${encodeURIComponent(id)}/photo?v=${encodeURIComponent(version)}` : null;
}

// Shows the employee photo, falling back to the coloured initials when there is none or it fails to load.
// Clicking a real photo opens it large (click anywhere, press Esc or use Close to go back). `keyboard` makes the small
// photo reachable with Tab/Enter; leave it off where the photo already sits inside another button (the staff list).
export function EmployeePhoto({ id, version, initials, className, name, keyboard }: { id: string; version?: string | null; initials: string; className: string; name?: string; keyboard?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { setFailed(false); setOpen(false); }, [id, version]);
  const src = photoUrl(id, version);
  const showing = Boolean(src && !failed);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  const enlarge = showing ? {
    onClick: (event: React.MouseEvent) => { event.stopPropagation(); event.preventDefault(); setOpen(true); },
    title: "Click to enlarge",
    style: { cursor: "zoom-in" },
    ...(keyboard ? { role: "button", tabIndex: 0, "aria-label": `Enlarge photo${name ? ` of ${name}` : ""}`, onKeyDown: (event: React.KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); setOpen(true); } } } : {}),
  } : {};
  return <>
    <i className={className} {...enlarge}>{showing ? <img src={src!} alt="" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit", display: "block" }} /> : initials}</i>
    {open && showing && createPortal(
      <div className="photo-lightbox" role="dialog" aria-modal="true" aria-label={name ? `Photo of ${name}` : "Employee photo"} onClick={event => { event.stopPropagation(); setOpen(false); }}>
        <figure onClick={event => event.stopPropagation()}>
          <img src={src!} alt={name ? `Photo of ${name}` : "Employee photo"} />
          <figcaption><span>{name}</span><button type="button" autoFocus onClick={() => setOpen(false)}>Close</button></figcaption>
        </figure>
      </div>,
      document.body,
    )}
  </>;
}
