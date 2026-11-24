import type { LipMask } from './lip-tracking'

function luma(red: number, green: number, blue: number) {
  return .2126 * red + .7152 * green + .0722 * blue
}

function blurCoverage(alpha: (offset: number) => number, center: number, row: number, column: number) {
  const edges = alpha(center - row) + alpha(center + row) + alpha(center - column) + alpha(center + column)
  const corners = alpha(center - row - column) + alpha(center - row + column) +
    alpha(center + row - column) + alpha(center + row + column)
  return (4 * alpha(center) + 2 * edges + corners) / (16 * 255)
}

export function createLipRenderer(view: CanvasRenderingContext2D) {
  const mask = document.createElement('canvas')
  const maskContext = mask.getContext('2d', { willReadFrequently: true })
  if (!maskContext) return

  return (frame: CanvasRenderingContext2D, { path, feather, x, y, width, height }: LipMask, shade: readonly number[]) => {
    const padding = 2
    const maskWidth = width + 2 * padding
    const maskHeight = height + 2 * padding
    const stride = maskWidth * 4
    if (maskWidth > mask.width) mask.width = maskWidth
    if (maskHeight > mask.height) mask.height = maskHeight
    maskContext.resetTransform()
    maskContext.clearRect(0, 0, maskWidth, maskHeight)
    maskContext.translate(padding - x, padding - y)
    maskContext.fill(path, 'evenodd')

    const coverage = maskContext.getImageData(0, 0, maskWidth, maskHeight).data
    const alpha = (offset: number) => coverage[offset] ?? 0
    const pixels = frame.getImageData(x, y, width, height)
    const [red = 0, green = 0, blue = 0] = shade
    const shadeLuma = luma(red, green, blue)
    const redOffset = red - shadeLuma
    const greenOffset = green - shadeLuma
    const blueOffset = blue - shadeLuma
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue)
    const opacity = .84 - .33 * chroma / 255
    const lightTransmission = .76 + shadeLuma / 510
    const shadowRange = Math.max(112, shadeLuma)
    const highlightRange = Math.max(1, 255 - shadeLuma)

    for (let row = 0; row < height; row++) {
      const maskRow = (row + padding) * stride + padding * 4 + 3
      for (let column = 0; column < width; column++) {
        const index = maskRow + column * 4
        const original = alpha(index) / 255
        if (original === 0) continue

        // Fade inward so tint cannot spread onto the skin or teeth.
        const nearby = blurCoverage(alpha, index, stride, 4)
        const feathered = feather > 1
          ? nearby + (blurCoverage(alpha, index, 2 * stride, 8) - nearby) * (feather - 1)
          : 1 + (nearby - 1) * feather
        const amount = opacity * original * feathered

        const i = (row * width + column) * 4
        const cameraRed = pixels.data[i] ?? 0
        const cameraGreen = pixels.data[i + 1] ?? 0
        const cameraBlue = pixels.data[i + 2] ?? 0
        // Lightness follows each camera pixel. Limit the added color in shadows and near white.
        const lightness = luma(cameraRed, cameraGreen, cameraBlue) * lightTransmission
        const chromaScale = Math.min(lightness / shadowRange, (255 - lightness) / highlightRange, 1)
        pixels.data[i] = cameraRed + amount * (lightness + redOffset * chromaScale - cameraRed)
        pixels.data[i + 1] = cameraGreen + amount * (lightness + greenOffset * chromaScale - cameraGreen)
        pixels.data[i + 2] = cameraBlue + amount * (lightness + blueOffset * chromaScale - cameraBlue)
      }
    }
    view.putImageData(pixels, x, y)
  }
}
