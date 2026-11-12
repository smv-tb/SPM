import { describe, it, expect } from "vitest";
import {
  attachmentDisposition,
  cleanAttachmentName,
  formatFileSize,
  sniffAttachmentType,
} from "@/lib/accounting/bill-attachment";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (s: string) => new TextEncoder().encode(s);

describe("sniffAttachmentType", () => {
  it("knows PDF, PNG and JPEG by their first bytes", () => {
    expect(sniffAttachmentType(text("%PDF-1.7\n…"))).toBe("application/pdf");
    expect(sniffAttachmentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffAttachmentType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
  });

  it("refuses everything else, whatever it is called", () => {
    expect(sniffAttachmentType(text("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffAttachmentType(text("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffAttachmentType(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull(); // zip / docx
    expect(sniffAttachmentType(bytes(0x25, 0x50, 0x44))).toBeNull(); // too short to be "%PDF-"
    expect(sniffAttachmentType(new Uint8Array())).toBeNull();
  });
});

describe("cleanAttachmentName", () => {
  it("keeps an ordinary name", () => {
    expect(cleanAttachmentName("Acme invoice 4471.pdf", "application/pdf")).toBe("Acme invoice 4471.pdf");
    expect(cleanAttachmentName("receipt.JPEG", "image/jpeg")).toBe("receipt.jpeg");
  });

  it("drops any directory part and unsafe characters", () => {
    expect(cleanAttachmentName("..\\..\\windows\\evil.pdf", "application/pdf")).toBe("evil.pdf");
    expect(cleanAttachmentName("/etc/a\"b<c>\u0000d.pdf", "application/pdf")).toBe("abcd.pdf");
  });

  it("ends in what the file really is", () => {
    expect(cleanAttachmentName("invoice.html", "application/pdf")).toBe("invoice.html.pdf");
    expect(cleanAttachmentName("scan", "image/png")).toBe("scan.png");
    expect(cleanAttachmentName("photo.jpg", "image/jpeg")).toBe("photo.jpg");
  });

  it("names a file that has no usable name", () => {
    expect(cleanAttachmentName("", "application/pdf")).toBe("document.pdf");
    expect(cleanAttachmentName(".pdf", "application/pdf")).toBe("document.pdf");
  });

  it("stays within 200 characters", () => {
    const name = cleanAttachmentName(`${"x".repeat(500)}.pdf`, "application/pdf");
    expect(name.length).toBeLessThanOrEqual(200);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});

describe("attachmentDisposition", () => {
  it("is always a download, with an ASCII fallback and the real name", () => {
    expect(attachmentDisposition("Café bill.pdf")).toBe(
      `attachment; filename="Caf_ bill.pdf"; filename*=UTF-8''Caf%C3%A9%20bill.pdf`
    );
  });

  it("cannot be broken out of with quotes", () => {
    expect(attachmentDisposition('a";b.pdf')).toMatch(/^attachment; filename="a_;b\.pdf"; /);
  });
});

describe("formatFileSize", () => {
  it("reads naturally", () => {
    expect(formatFileSize(200)).toBe("1 KB");
    expect(formatFileSize(340 * 1024)).toBe("340 KB");
    expect(formatFileSize(1.25 * 1024 * 1024)).toBe("1.3 MB");
  });
});
