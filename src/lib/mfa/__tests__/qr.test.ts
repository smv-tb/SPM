import { describe, it, expect } from "vitest";
import jsQR from "jsqr";
import { qrMatrix, qrPath, QR_QUIET_ZONE } from "@/lib/mfa/qr";
import { generateTotpSecret, otpauthUri } from "@/lib/mfa/totp";

/** Rasterises the matrix the way the browser draws it: white page, quiet zone, black modules. */
function toImage(matrix: boolean[][], scale = 4) {
  const modules = matrix.length + QR_QUIET_ZONE * 2;
  const size = modules * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((y + QR_QUIET_ZONE) * scale + dy) * size + (x + QR_QUIET_ZONE) * scale + dx;
          data.set([0, 0, 0, 255], px * 4);
        }
      }
    })
  );
  return { data, size };
}

describe("qrMatrix", () => {
  it("decodes back to exactly the otpauth URI an authenticator app needs", () => {
    for (const email of ["jane.doe@example.com", "a-much-longer.address+tag@subdomain.example.org"]) {
      const uri = otpauthUri(generateTotpSecret(), email);
      const { data, size } = toImage(qrMatrix(uri));
      const decoded = jsQR(data, size, size);
      expect(decoded?.data).toBe(uri);
    }
  });

  it("is square", () => {
    const m = qrMatrix("hello");
    expect(m.every((row) => row.length === m.length)).toBe(true);
  });
});

describe("qrPath", () => {
  it("draws exactly the dark modules", () => {
    const matrix = qrMatrix(otpauthUri(generateTotpSecret(), "a@b.co"));
    const dark = matrix.flat().filter(Boolean).length;
    const covered = [...qrPath(matrix).matchAll(/M\d+ \d+h(\d+)v1/g)].reduce((n, m) => n + Number(m[1]), 0);
    expect(covered).toBe(dark);
  });

  it("is empty for an empty grid", () => {
    expect(qrPath([[false, false]])).toBe("");
  });
});
