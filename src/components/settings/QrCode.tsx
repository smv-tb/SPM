"use client";

import { useMemo } from "react";
import { qrMatrix, qrPath, QR_QUIET_ZONE } from "@/lib/mfa/qr";

/** A QR code drawn as SVG shapes (no innerHTML, no image service, nothing leaves the page). */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { path, size } = useMemo(() => {
    const matrix = qrMatrix(value);
    return { path: qrPath(matrix), size: matrix.length + QR_QUIET_ZONE * 2 };
  }, [value]);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} transform={`translate(${QR_QUIET_ZONE} ${QR_QUIET_ZONE})`} fill="#000" />
    </svg>
  );
}
