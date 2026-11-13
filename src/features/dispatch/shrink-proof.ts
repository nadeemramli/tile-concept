// Phone photos of a signed DO are usually several megabytes; the server accepts 700 KB.
// Before submit, a too-large JPEG or PNG is redrawn smaller as a JPEG and swapped into the input.
// PDFs and files already under the limit are left untouched. If the browser cannot do this,
// the original file stays and the server's size message applies.
const LIMIT = 700 * 1024;

export async function shrinkProof(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  if (!file || file.size <= LIMIT || !["image/jpeg", "image/png"].includes(file.type)) return;
  try {
    const bitmap = await createImageBitmap(file);
    let side = 1800;
    let quality = 0.8;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= LIMIT) {
        const name = file.name.replace(/\.[^.]*$/, "") + ".jpg";
        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], name, { type: "image/jpeg" }));
        input.files = transfer.files;
        return;
      }
      side = Math.round(side * 0.8);
      quality = Math.max(0.5, quality - 0.08);
    }
  } catch {
    // Leave the original file; the server reports the size limit.
  }
}
