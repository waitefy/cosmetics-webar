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
type ReadLipColor = (point: Point) => { chroma: number; lightness: number } | undefined

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

function getSkinSamplePoint(outer: Point[], inner: Point[], index: number) {
  const border = outer[index]
  const opening = inner[index]
  return border && opening && mix(border, opening, -.7)
}

function createLipColorSampler(outer: Point[], inner: Point[], padding: number, frame: CanvasRenderingContext2D): ReadLipColor | undefined {
  const sampleBounds = [...outer, ...inner, ...seamSamples.flat().flatMap(index => getSkinSamplePoint(outer, inner, index) ?? [])]
  const x = Math.max(0, Math.floor(Math.min(...sampleBounds.map(point => point.x)) - padding))
  const y = Math.max(0, Math.floor(Math.min(...sampleBounds.map(point => point.y)) - padding))
  const rightEdge = Math.min(frame.canvas.width, Math.ceil(Math.max(...sampleBounds.map(point => point.x)) + padding) + 1)
  const bottomEdge = Math.min(frame.canvas.height, Math.ceil(Math.max(...sampleBounds.map(point => point.y)) + padding) + 1)
  if (rightEdge <= x || bottomEdge <= y) return

  const pixels = frame.getImageData(x, y, rightEdge - x, bottomEdge - y)
  return point => {
    const column = Math.round(point.x) - x
    const row = Math.round(point.y) - y
    if (column < 0 || column >= pixels.width || row < 0 || row >= pixels.height) return
    const offset = (row * pixels.width + column) * 4
    const r = pixels.data[offset] ?? 0
    const g = pixels.data[offset + 1] ?? 0
    const b = pixels.data[offset + 2] ?? 0
    return { chroma: (r + b - 2 * g) / Math.max(100, r + g + b), lightness: (r + 2 * g + b) * .25 }
  }
}

function getLipVisibility(outer: Point[], inner: Point[], mouthWidth: number, pucker: number, readColor: ReadLipColor): LipVisibility {
  const readLipBand = (index: number) => {
    const border = outer[index]
    const opening = inner[index]
    if (!border || !opening || distance(border, opening) < 1) return

    const band = [.35, .5, .65].map(position => readColor(mix(border, opening, position)))
    const skinSamplePoint = getSkinSamplePoint(outer, inner, index)
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
  // The seam can disappear in a pucker even when both lip bands are fully visible.
  if (pucker > .5 && bandSupport === seamSamples.length * 2) return 'visible'

  const openings = columns.filter(column => column.opening)
  // During a head turn a single column can still distinguish both lip bands and the opening.
  if (bandSupport >= 2 && (openings.length >= 2 || openings.some(column => column.upper && column.lower))) return 'visible'
  return bandSupport > 0 || openings.length >= 2 ? 'partial' : 'missing'
}

function findLipEdgeInset(border: Point, opening: Point, inset: number, step: number, readColor: ReadLipColor) {
  const thickness = distance(border, opening)
  if (thickness < 1) return inset

  const interval = step / thickness
  const lipSample = readColor(mix(border, opening, .45))
  const skinSample = readColor(mix(border, opening, -5 * interval))
  if (!lipSample || !skinSample) return inset
  const range = lipSample.chroma - skinSample.chroma
  if (range < .025) return inset

  // Keep weak or ambiguous edges close to the inset from the face model.
  const confidence = Math.min(1, (range - .025) / .035)
  const modelWeight = .0005
  let total = modelWeight
  let weightedOffset = -inset * modelWeight
  // Search both sides of the landmark for a local drop in lip chroma toward the skin.
  for (let offset = -3; offset <= 4; offset++) {
    const outward = offset * interval
    if (outward < -.65) continue
    const lip = readColor(mix(border, opening, -outward + interval))
    const skin = readColor(mix(border, opening, -outward - interval))
    if (!lip || !skin) continue

    const contrast = lip.chroma - skin.chroma
    // Favor the transition near skin color over a strong gradient within the lip.
    const position = ((lip.chroma + skin.chroma) / 2 - skinSample.chroma) / range
    const difference = (position - .35) / .25
    const weight = confidence * Math.max(0, contrast - .014 - .0015 * Math.abs(offset)) ** 2 / (1 + difference ** 2)
    total += weight
    weightedOffset += outward * weight
  }
  return -weightedOffset / total
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
  const [upper, lower, upperOpening, lowerOpening] = [outer[5], outer[15], inner[5], inner[15]]
  if (outer.length !== outerLip.length || inner.length !== innerLip.length ||
    !left || !right || !upper || !lower || !upperOpening || !lowerOpening) return

  const mouthWidth = distance(left, right)
  if (mouthWidth < 12 || distance(upper, lower) < 2) return

  const thickness = (distance(upper, upperOpening) + distance(lower, lowerOpening)) / 2
  // Treat thick, pursed lips separately from a large opening between the lips.
  const pucker = Math.max(0, Math.min(1, (2 * thickness / mouthWidth - .4) / .35))
  const wideOpening = Math.max(0, Math.min(1, (distance(upperOpening, lowerOpening) / mouthWidth - .5) / .5))
  const step = Math.max(1, Math.min(3, mouthWidth * .03))
  const refineBorder = pucker > 0 || wideOpening > 0
  const readColor = createLipColorSampler(outer, inner, refineBorder ? 5 * step : 0, frame)
  const visibility = readColor ? getLipVisibility(outer, inner, mouthWidth, pucker, readColor) : 'missing'
  const insets = outer.map((point, index) => mix(point, inner[index] ?? point, index === 0 || index === 10 ? .45 : .08))
  const border = !readColor || !refineBorder || visibility === 'missing' ? insets : insets.map((inset, index) => {
    // At a wide opening, recover the lower rim and taper the correction at the corners.
    const lowerLip = wideOpening * Math.max(0, Math.min(1, (index - 10) / 2, (outer.length - index) / 2))
    if (pucker === 0 && lowerLip === 0) return inset
    const point = outer[index] ?? inset
    const opening = inner[index] ?? point
    const amount = index === 0 || index === 10 ? .45 : .08
    const edgeInset = findLipEdgeInset(point, opening, amount, step, readColor)
    const strength = edgeInset < amount ? Math.max(pucker, lowerLip * .92) : pucker
    return mix(inset, mix(point, opening, edgeInset), strength)
  })
  // Smooth only the correction, preserving the original shape where colors are inconclusive.
  const smoothed = border === insets ? border : border.map((point, index) => {
    const before = (index + border.length - 1) % border.length
    const after = (index + 1) % border.length
    const center = insets[index] ?? point
    const neighbors = mix(border[before] ?? point, border[after] ?? point, .5)
    const base = mix(insets[before] ?? center, insets[after] ?? center, .5)
    return mix(point, { x: center.x + neighbors.x - base.x, y: center.y + neighbors.y - base.y }, .4)
  })
  const path = new Path2D()
  for (const outline of [smoothed, inner]) {
    const roundCorners = outline === smoothed
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

  const outline = [...smoothed, ...inner]
  const x = Math.max(0, Math.floor(Math.min(...outline.map(point => point.x))) - 1)
  const y = Math.max(0, Math.floor(Math.min(...outline.map(point => point.y))) - 1)
  const rightEdge = Math.min(width, Math.ceil(Math.max(...outline.map(point => point.x))) + 1)
  const bottomEdge = Math.min(height, Math.ceil(Math.max(...outline.map(point => point.y))) + 1)
  if (rightEdge <= x || bottomEdge <= y) return
  const feather = Math.min(2, mouthWidth * .025, thickness * .33)
  const mask: LipMask = { path, feather, x, y, width: rightEdge - x, height: bottomEdge - y }
  return { mask, visibility }
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
