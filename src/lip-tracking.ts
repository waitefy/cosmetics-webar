import { FaceLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import modelAssetPath from './assets/face_landmarker.task?url'

// The two lip loops from MediaPipe's FACE_LANDMARKS_LIPS, in traversal order.
const outerLip = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146]
const innerLip = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]
const seamSamples = [[3, 17], [5, 15], [7, 13]] as const

type Point = { x: number; y: number }
type LipVisibility = 'visible' | 'partial' | 'missing'

export type LipMask = {
  path: Path2D
  feather: number
  x: number
  y: number
  width: number
  height: number
}

function mix(a: Point, b: Point, amount: number): Point {
  return { x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount }
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function getLipVisibility(outer: Point[], inner: Point[], mouthWidth: number, frame: CanvasRenderingContext2D): LipVisibility {
  const getSkinSamplePoint = (index: number) => {
    const border = outer[index]
    const opening = inner[index]
    return border && opening && mix(border, opening, -.7)
  }
  // The skin samples can extend past the lip contour when the lips are pursed.
  const sampleBounds = [...outer, ...inner, ...seamSamples.flat().flatMap(index => getSkinSamplePoint(index) ?? [])]
  const x = Math.max(0, Math.floor(Math.min(...sampleBounds.map(point => point.x))))
  const y = Math.max(0, Math.floor(Math.min(...sampleBounds.map(point => point.y))))
  const rightEdge = Math.min(frame.canvas.width, Math.ceil(Math.max(...sampleBounds.map(point => point.x))) + 1)
  const bottomEdge = Math.min(frame.canvas.height, Math.ceil(Math.max(...sampleBounds.map(point => point.y))) + 1)
  if (rightEdge <= x || bottomEdge <= y) return 'missing'

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

  const readLipBand = (index: number) => {
    const border = outer[index]
    const opening = inner[index]
    if (!border || !opening || distance(border, opening) < 1) return

    const band = [.35, .5, .65].map(position => readColor(mix(border, opening, position)))
    const skinSamplePoint = getSkinSamplePoint(index)
    const skin = skinSamplePoint && readColor(skinSamplePoint)
    if (!skin || band.some(color => !color)) return
    const lightness = band.reduce((total, color) => total + (color?.lightness ?? 0), 0) / band.length
    const chroma = band.reduce((total, color) => total + (color?.chroma ?? 0), 0) / band.length
    const chromaContrast = chroma - skin.chroma
    const supported = chromaContrast > .025 || (chromaContrast > .005 && skin.lightness - lightness > 10)
    return { lightness, supported }
  }

  const columns = seamSamples.map(([top, bottom]) => {
    const topEdge = inner[top]
    const bottomEdge = inner[bottom]
    const topBand = readLipBand(top)
    const bottomBand = readLipBand(bottom)
    const upper = topBand?.supported ?? false
    const lower = bottomBand?.supported ?? false
    if (!topEdge || !bottomEdge || !topBand || !bottomBand) return { upper, lower, opening: false }

    const seam = readColor(mix(topEdge, bottomEdge, .5))
    if (!seam) return { upper, lower, opening: false }

    const bandLightness = Math.max(topBand.lightness, bottomBand.lightness)
    const hasDarkCrease = bandLightness - seam.lightness >= Math.max(6, bandLightness * .10)
    const hasVisibleTeeth = distance(topEdge, bottomEdge) >= 2 && seam.lightness - bandLightness >= 10
    return { upper, lower, opening: hasDarkCrease || hasVisibleTeeth }
  })

  const upperSupport = columns.filter(column => column.upper).length
  const lowerSupport = columns.filter(column => column.lower).length
  const bandSupport = upperSupport + lowerSupport
  const upperOpening = inner[5]
  const lowerOpening = inner[15]
  const mouthOpen = upperOpening && lowerOpening && distance(upperOpening, lowerOpening) > mouthWidth * .07
  if (mouthOpen && bandSupport >= 3 && upperSupport > 0 && lowerSupport > 0) return 'visible'

  const openings = columns.filter(column => column.opening)
  // During a head turn a single column can still distinguish both lip bands and the opening.
  if (bandSupport >= 2 && (openings.length >= 2 || openings.some(column => column.upper && column.lower))) return 'visible'
  return bandSupport > 0 || openings.length >= 2 ? 'partial' : 'missing'
}

export function createLipTracker() {
  return FaceLandmarker.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
    baseOptions: { modelAssetPath, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    minFacePresenceConfidence: .6,
  })
}

function readLipFrame(face: NormalizedLandmark[], frame: CanvasRenderingContext2D) {
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
  if (mouthWidth < 12 || distance(upper, lower) < 2) return

  const inset = outer.map((point, index) => {
    const opening = inner[index]
    const isCorner = index === 0 || index === 10
    return opening ? mix(point, opening, isCorner ? .45 : .08) : point
  })
  const path = new Path2D()
  for (const outline of [inset, inner]) {
    const roundCorners = outline === inset
    for (const [index, point] of outline.entries()) {
      const next = outline[(index + 1) % outline.length] ?? point
      if (index === 0) {
        const start = roundCorners ? mix(outline.at(-1) ?? point, point, .5) : point
        path.moveTo(start.x, start.y)
      }
      if (roundCorners || (index !== 0 && index !== outline.length / 2)) {
        const end = mix(point, next, .5)
        path.quadraticCurveTo(point.x, point.y, end.x, end.y)
      } else if (index !== 0) {
        path.lineTo(point.x, point.y)
      }
    }
    path.closePath()
  }

  const outline = [...inset, ...inner]
  const x = Math.max(0, Math.floor(Math.min(...outline.map(point => point.x))) - 1)
  const y = Math.max(0, Math.floor(Math.min(...outline.map(point => point.y))) - 1)
  const rightEdge = Math.min(width, Math.ceil(Math.max(...outline.map(point => point.x))) + 1)
  const bottomEdge = Math.min(height, Math.ceil(Math.max(...outline.map(point => point.y))) + 1)
  if (rightEdge <= x || bottomEdge <= y) return
  const thickness = (distance(upper, inner[5] ?? upper) + distance(lower, inner[15] ?? lower)) / 2
  const feather = Math.min(2, mouthWidth * .025, thickness * .33)
  const mask: LipMask = { path, feather, x, y, width: rightEdge - x, height: bottomEdge - y }
  return { mask, visibility: getLipVisibility(outer, inner, mouthWidth, frame) }
}

export function createLipMaskTracker() {
  const partialHoldMs = 320
  const missingEvidenceHoldMs = 75
  const missingLandmarksHoldMs = 65
  let mask: LipMask | undefined
  let lastConfirmed = -Infinity
  let lastEvidence = -Infinity
  let lastLandmarks = -Infinity
  let confirmedFrames = 0

  return {
    reset() {
      mask = undefined
      lastConfirmed = lastEvidence = lastLandmarks = -Infinity
      confirmedFrames = 0
    },
    update(face: NormalizedLandmark[] | undefined, frame: CanvasRenderingContext2D, time: number) {
      const current = face && readLipFrame(face, frame)
      if (current) {
        lastLandmarks = time
        if (current.visibility !== 'missing') lastEvidence = time
      }
      if (current?.visibility === 'visible') {
        lastConfirmed = time
        confirmedFrames = Math.min(confirmedFrames + 1, 2)
      } else {
        confirmedFrames = 0
      }

      const canKeepMask = mask && time - lastConfirmed < partialHoldMs &&
        time - lastEvidence < missingEvidenceHoldMs && time - lastLandmarks < missingLandmarksHoldMs
      // Keep updating from the current shape while the color check is inconclusive.
      if (confirmedFrames === 2 || canKeepMask) mask = current?.mask ?? mask
      else mask = undefined
      return mask
    },
  }
}
