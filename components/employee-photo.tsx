"use client";
import { useEffect, useState } from "react";

export function photoUrl(id: string, version?: string | null) {
  return version ? `/api/employees/${encodeURIComponent(id)}/photo?v=${encodeURIComponent(version)}` : null;
}

// Shows the employee photo, falling back to the coloured initials when there is none or it fails to load.
export function EmployeePhoto({ id, version, initials, className }: { id: string; version?: string | null; initials: string; className: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id, version]);
  const src = photoUrl(id, version);
  return <i className={className}>{src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit", display: "block" }} /> : initials}</i>;
}
