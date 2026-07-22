/** Client-side downscale before upload (mobile-friendly). */
export async function prepareUploadFile(
  file: File,
  maxLongEdge = 2048,
): Promise<{ blob: Blob; filename: string; contentType: string }> {
  const bitmap = await createImageBitmap(file)
  try {
    const long = Math.max(bitmap.width, bitmap.height)
    const scale = long > maxLongEdge ? maxLongEdge / long : 1
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not prepare image')
    ctx.drawImage(bitmap, 0, 0, w, h)

    const contentType = 'image/jpeg'
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Encode failed'))),
        contentType,
        0.9,
      )
    })

    const base = file.name.replace(/\.[^.]+$/, '') || 'fish'
    return { blob, filename: `${base}.jpg`, contentType }
  } finally {
    bitmap.close()
  }
}
