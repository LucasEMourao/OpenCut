export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}

export function buildDownloadFilename(
  originalName: string,
  extension: string
): string {
  const baseName = originalName.replace(/\.[^/.]+$/, "").trim();
  const sanitizedBase = baseName.replace(/[^a-zA-Z0-9-_]+/g, "_") || "audio";
  return `${sanitizedBase}.${extension}`;
}
