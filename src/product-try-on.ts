import type { FaceLandmarker } from '@mediapipe/tasks-vision'
import type { LipMask } from './lip-tracking'
import { createLipRenderer } from './lip-rendering'

type ShadeColor = readonly number[] | null

type TryOnSession = {
  stream?: MediaStream
  tracker?: FaceLandmarker
  track?: FrameRequestCallback
  frame?: number
}

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop()
}

function getCameraError(error: unknown) {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
        return 'Разрешите камеру в настройках браузера.'
      case 'NotFoundError':
        return 'Камера не найдена. Подключите камеру и попробуйте снова.'
      case 'NotReadableError':
        return 'Не удалось включить камеру. Проверьте, свободна ли она, и попробуйте снова.'
    }
  }
  return 'Не удалось запустить камеру. Попробуйте ещё раз.'
}

export function setupProductTryOn(onClose: () => void) {
  const visual = document.querySelector<HTMLElement>('.product-image')
  const scene = visual?.querySelector<HTMLElement>('.product-scene')
  const panel = document.querySelector<HTMLDivElement>('#product-try-on')
  const video = document.querySelector<HTMLVideoElement>('#try-on-video')
  const view = document.querySelector<HTMLCanvasElement>('#try-on-view')
  const rightView = document.querySelector<HTMLCanvasElement>('#try-on-right-view')
  const rightLayer = document.querySelector<HTMLElement>('.try-on-comparison-layer')
  const start = document.querySelector<HTMLButtonElement>('#try-on-start')
  const close = document.querySelector<HTMLButtonElement>('#try-on-close')
  const exit = document.querySelector<HTMLButtonElement>('#try-on-exit')
  const neutralOption = document.querySelector<HTMLLabelElement>('#try-on-neutral')
  const status = document.querySelector<HTMLElement>('#try-on-status')
  const errorStatus = document.querySelector<HTMLElement>('#try-on-error')
  const context = view?.getContext('2d')
  const rightContext = rightView?.getContext('2d')
  if (!visual || !scene || !panel || !video || !view || !rightView || !rightLayer || !start || !close || !exit ||
      !neutralOption || !status || !errorStatus || !context || !rightContext) return
  const renderLips = createLipRenderer(context)
  const renderRightLips = createLipRenderer(rightContext)

  let activeSession: TryOnSession | undefined
  let capturedFrame: CanvasRenderingContext2D | undefined
  let lipMask: LipMask | undefined
  let color: ShadeColor = null
  let comparedColor: ShadeColor = null
  let comparing = false
  let showingRight = false

  const hasShade = () => color !== null || comparedColor !== null

  const paint = () => {
    if (!capturedFrame || !lipMask || !hasShade()) {
      context.clearRect(0, 0, view.width, view.height)
      if (showingRight) rightContext.clearRect(0, 0, rightView.width, rightView.height)
      return
    }
    context.drawImage(capturedFrame.canvas, 0, 0)
    if (color) renderLips?.(capturedFrame, lipMask, color)
    if (showingRight) {
      rightContext.drawImage(capturedFrame.canvas, 0, 0)
      if (comparedColor) renderRightLips?.(capturedFrame, lipMask, comparedColor)
    }
  }

  const updateTracking = (session: TryOnSession) => {
    if (!hasShade()) {
      if (session.frame !== undefined) cancelAnimationFrame(session.frame)
      session.frame = undefined
      capturedFrame = undefined
      lipMask = undefined
      status.textContent = ''
      return
    }

    if (session.track) {
      if (status.textContent === 'Загрузка примерки…') status.textContent = ''
      if (session.frame === undefined) session.frame = requestAnimationFrame(session.track)
    } else if (session.stream) {
      status.textContent = 'Загрузка примерки…'
    }
  }

  const updateOutput = () => {
    if (activeSession) updateTracking(activeSession)
    paint()
  }

  const clearRightView = () => {
    showingRight = false
    comparedColor = null
    rightContext.clearRect(0, 0, rightView.width, rightView.height)
  }

  rightLayer.addEventListener('transitionend', (event) => {
    if (event.propertyName !== 'opacity' || comparing) return
    clearRightView()
    updateOutput()
  })

  const stopTryOn = (restoreFocus = true) => {
    const session = activeSession
    if (!session) return

    activeSession = undefined
    if (session.frame !== undefined) cancelAnimationFrame(session.frame)
    if (session.stream) stopStream(session.stream)
    video.pause()
    video.srcObject = null
    capturedFrame = undefined
    lipMask = undefined
    comparing = false
    clearRightView()
    paint()
    status.textContent = ''
    const cameraWasReady = panel.hasAttribute('data-camera-ready')
    delete panel.dataset.cameraReady
    panel.hidden = true
    scene.inert = false
    neutralOption.hidden = neutralOption.inert = true
    exit.hidden = true
    start.hidden = false
    delete visual.dataset.tryOn
    visual.toggleAttribute('data-try-on-ended', cameraWasReady)
    onClose()
    if (restoreFocus) start.focus({ preventScroll: true })
    session.tracker?.close()
  }

  const fail = (session: TryOnSession, message: string) => {
    if (activeSession !== session) return
    stopTryOn()
    errorStatus.textContent = message
  }

  const startTryOn = async () => {
    if (activeSession) return
    if (!window.isSecureContext) {
      errorStatus.textContent = 'Чтобы включить камеру, откройте сайт по HTTPS.'
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      errorStatus.textContent = 'Этот браузер не поддерживает доступ к камере.'
      return
    }

    const session: TryOnSession = {}
    activeSession = session
    errorStatus.textContent = ''
    panel.hidden = false
    scene.inert = true
    visual.dataset.tryOn = ''
    status.textContent = ''
    start.hidden = true
    neutralOption.hidden = neutralOption.inert = false
    exit.hidden = false
    exit.focus({ preventScroll: true })

    let permissionState: PermissionState | undefined
    try {
      permissionState = (await navigator.permissions?.query({ name: 'camera' as PermissionName }))?.state
    } catch {
      // Permissions API may not support querying camera state.
    }
    if (activeSession !== session) return
    status.textContent = permissionState === 'granted' ? (hasShade() ? 'Загрузка примерки…' : '') : 'Разрешите доступ к камере'
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      })
      if (activeSession !== session) {
        stopStream(stream)
        return
      }
      session.stream = stream
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => fail(session, 'Камера отключилась. Попробуйте включить примерку снова.'))
      }
      updateTracking(session)
      video.srcObject = stream
      await video.play()
    } catch (error) {
      fail(session, getCameraError(error))
      return
    }
    if (activeSession !== session) return

    try {
      const { createLipTracker, createLipMaskTracker } = await import('./lip-tracking')
      if (activeSession !== session) return
      const tracker = await createLipTracker()
      if (activeSession !== session) {
        tracker.close()
        return
      }
      session.tracker = tracker

      const source = document.createElement('canvas')
      const sourceContext = source.getContext('2d', { willReadFrequently: true })
      if (!sourceContext) throw new Error('Не удалось создать область захвата кадра')

      const frameInterval = 1000 / 30
      const maskTracker = createLipMaskTracker()
      let nextFrameTime = performance.now()
      let lastPaintedMask = nextFrameTime
      const track = (time: number) => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && time >= nextFrameTime) {
          nextFrameTime = Math.max(nextFrameTime + frameInterval, time)
          try {
            if (source.width !== video.videoWidth || source.height !== video.videoHeight) {
              source.width = video.videoWidth
              source.height = video.videoHeight
              view.width = rightView.width = source.width
              view.height = rightView.height = source.height
              capturedFrame = undefined
              lipMask = undefined
            }
            if (!capturedFrame) {
              maskTracker.reset()
              lastPaintedMask = time
            }
            // Read and display the same camera frame so the overlay cannot lag behind the preview.
            sourceContext.drawImage(video, 0, 0)
            const [face] = tracker.detectForVideo(source, time).faceLandmarks
            capturedFrame = sourceContext
            lipMask = maskTracker.update(face, sourceContext, time)
            if (lipMask) lastPaintedMask = time
            paint()
            const message = time - lastPaintedMask < 350 ? '' : 'Губы не распознаны'
            if (status.textContent !== message) status.textContent = message
          } catch (error) {
            console.error('Не удалось обработать кадр примерки', error)
            fail(session, 'Примерка прервалась. Попробуйте включить её ещё раз.')
            return
          }
        }
        // Video frame callbacks can stop when the composited canvas covers the video.
        session.frame = requestAnimationFrame(track)
      }

      session.track = track
      updateTracking(session)
      panel.dataset.cameraReady = ''
    } catch (error) {
      if (activeSession === session) console.error('Не удалось загрузить модель примерки', error)
      fail(session, 'Не удалось загрузить примерку. Попробуйте ещё раз.')
    }
  }

  start.addEventListener('click', () => void startTryOn())
  close.addEventListener('click', () => stopTryOn())
  exit.addEventListener('click', () => stopTryOn())
  document.addEventListener('keydown', (event) => {
    if (activeSession && event.key === 'Escape') {
      event.preventDefault()
      stopTryOn()
    }
  })
  window.addEventListener('pagehide', () => stopTryOn(false))

  return {
    setShade(nextColor: ShadeColor) {
      color = nextColor
      updateOutput()
    },
    setComparedShade(enabled: boolean, nextColor: ShadeColor) {
      comparing = enabled
      if (enabled) {
        showingRight = true
        comparedColor = nextColor
      } else if (Number(getComputedStyle(rightLayer).opacity) === 0) {
        clearRightView()
      }
      updateOutput()
    },
  }
}
