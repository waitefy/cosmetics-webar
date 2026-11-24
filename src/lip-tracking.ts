import { FaceLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import modelAssetPath from './assets/face_landmarker.task?url'

// The two lip loops from MediaPipe's FACE_LANDMARKS_LIPS, in traversal order.
const outerLip = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146]
const innerLip = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]
const upperLipSamples = [3, 5, 7]
const lowerLipSamples = [13, 15, 17]
const seamSamples = [[3, 17], [5, 15], [7, 13]] as const

type Point = { x: number; y: number }

function mix(a: Point, b: Point, amount: number): Point {
  return { x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount }
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function hasVisibleLips(outer: Point[], inner: Point[], mouthWidth: number, frame: CanvasRenderingContext2D) {
  const padding = Math.ceil(mouthWidth * .2)
  const x = Math.floor(Math.min(...outer.map(point => point.x))) - padding
  const y = Math.floor(Math.min(...outer.map(point => point.y))) - padding
  const rightEdge = Math.ceil(Math.max(...outer.map(point => point.x))) + padding
  const bottomEdge = Math.ceil(Math.max(...outer.map(point => point.y))) + padding
  if (x < 0 || y < 0 || rightEdge > frame.canvas.width || bottomEdge > frame.canvas.height) return false

  const pixels = frame.getImageData(x, y, rightEdge - x, bottomEdge - y)
  const readColor = (point: Point) => {
    const column = Math.round(point.x) - x
    const row = Math.round(point.y) - y
    if (column < 0 || column >= pixels.width || row < 0 || row >= pixels.height) return
    const offset = (row * pixels.width + column) * 4
    const r = pixels.data[offset] ?? 0
    const g = pixels.data[offset + 1] ?? 0
    const b = pixels.data[offset + 2] ?? 0
    return { chroma: (r + b - 2 * g) / Math.max(100, r + g + b), lightness: (r + 2 * g + b) * .25 }
  }

  const samples = outer.map((border, index) => {
    const opening = inner[index]
    if (!opening || distance(border, opening) < 1.5) return

    const band = [.35, .5, .65].map(position => readColor(mix(border, opening, position)))
    const skin = readColor(mix(border, opening, -.7))
    if (!skin || band.some(color => !color)) return
    const lightness = band.reduce((total, color) => total + (color?.lightness ?? 0), 0) / band.length
    const chroma = band.reduce((total, color) => total + (color?.chroma ?? 0), 0) / band.length
    return { lightness, chromaContrast: chroma - skin.chroma, lightnessContrast: skin.lightness - lightness }
  })

  const supported = (index: number) => {
    const sample = samples[index]
    return sample && (sample.chromaContrast > .025 || (sample.chromaContrast > .005 && sample.lightnessContrast > 10))
  }
  const upperSupport = upperLipSamples.filter(supported).length
  const lowerSupport = lowerLipSamples.filter(supported).length
  if (upperSupport + lowerSupport < 3) return false

  const upperOpening = inner[5]
  const lowerOpening = inner[15]
  if (upperOpening && lowerOpening && distance(upperOpening, lowerOpening) > mouthWidth * .07) {
    return upperSupport > 0 && lowerSupport > 0
  }

  // For a closed mouth, confirm the crease between the lips as well as the color of the lip bands.
  return seamSamples.filter(([top, bottom]) => {
    const topEdge = inner[top]
    const bottomEdge = inner[bottom]
    const topSample = samples[top]
    const bottomSample = samples[bottom]
    if (!topEdge || !bottomEdge || !topSample || !bottomSample) return false

    const seam = readColor(mix(topEdge, bottomEdge, .5))
    const bandLightness = Math.max(topSample.lightness, bottomSample.lightness)
    return seam && bandLightness - seam.lightness >= Math.max(6, bandLightness * .10)
  }).length >= 2
}

export function createLipTracker() {
  return FaceLandmarker.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
    baseOptions: { modelAssetPath, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    minFacePresenceConfidence: .6,
  })
}

export function createLipMask(face: NormalizedLandmark[], frame: CanvasRenderingContext2D, requireVisibility = true) {
  const { width, height } = frame.canvas
  const project = (landmark: number) => {
    const point = face[landmark]
    return point && { x: point.x * width, y: point.y * height }
  }
  const outer = outerLip.map(project).filter(point => point !== undefined)
  const inner = innerLip.map(project).filter(point => point !== undefined)
  const left = outer[0]
  const right = outer[10]
  const upper = outer[5]
  const lower = outer[15]
  if (outer.length !== outerLip.length || inner.length !== innerLip.length || !left || !right || !upper || !lower) return

  const mouthWidth = distance(left, right)
  if (mouthWidth < 12 || distance(upper, lower) < mouthWidth * .15) return
  if (requireVisibility && !hasVisibleLips(outer, inner, mouthWidth, frame)) return

  const inset = outer.map((point, index) => {
    const opening = inner[index]
    const isCorner = index === 0 || index === 10
    return opening ? mix(point, opening, isCorner ? .45 : .08) : point
  })
  const mask = new Path2D()
  for (const outline of [inset, inner]) {
    for (const [index, point] of outline.entries()) {
      const next = outline[(index + 1) % outline.length] ?? point
      if (index === 0) mask.moveTo(point.x, point.y)
      else if (index === outline.length / 2) mask.lineTo(point.x, point.y)
      else {
        const end = mix(point, next, .5)
        mask.quadraticCurveTo(point.x, point.y, end.x, end.y)
      }
    }
    mask.closePath()
  }
  return mask
}
