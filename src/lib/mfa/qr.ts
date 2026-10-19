import qrcode from "qrcode-generator";

/**
 * The QR code for an `otpauth://` URI, as a grid of dark/light modules. Drawn
 * in the browser (see QrCode.tsx), so the secret is never sent to a third-party
 * QR service or put in a URL.
 */
export const QR_QUIET_ZONE = 4; // modules of margin the QR spec requires

export function qrMatrix(text: string): boolean[][] {
  // Type 0 = smallest version that fits; "M" error correction (15%) suits a screen.
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => qr.isDark(row, col)));
}

/** One SVG path covering every dark module, in module units (no quiet zone). */
export function qrPath(matrix: boolean[][]): string {
  const parts: string[] = [];
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) { x++; continue; }
      let run = 0;
      while (x + run < row.length && row[x + run]) run++;
      parts.push(`M${x} ${y}h${run}v1h-${run}z`);
      x += run;
    }
  });
  return parts.join("");
}
