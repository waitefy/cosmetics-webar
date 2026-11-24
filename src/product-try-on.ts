import type { FaceLandmarker } from '@mediapipe/tasks-vision'

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
        return 'Разрешите доступ к камере в настройках браузера и попробуйте снова.'
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
  const panel = document.querySelector<HTMLDivElement>('#product-try-on')
  const video = document.querySelector<HTMLVideoElement>('#try-on-video')
  const view = document.querySelector<HTMLCanvasElement>('#try-on-view')
  const start = document.querySelector<HTMLButtonElement>('#try-on-start')
  const close = document.querySelector<HTMLButtonElement>('#try-on-close')
  const exit = document.querySelector<HTMLButtonElement>('#try-on-exit')
  const neutralOption = document.querySelector<HTMLLabelElement>('#try-on-neutral')
  const status = document.querySelector<HTMLElement>('#try-on-status')
  const errorStatus = document.querySelector<HTMLElement>('#try-on-error')
  const context = view?.getContext('2d')
  if (!visual || !panel || !video || !view || !start || !close || !exit || !neutralOption || !status || !errorStatus || !context) return

  let activeSession: TryOnSession | undefined
  let capturedFrame: HTMLCanvasElement | undefined
  let lipMask: Path2D | undefined
  let color: string | null = null

  const paint = () => {
    if (!capturedFrame || !lipMask || !color) {
      context.clearRect(0, 0, view.width, view.height)
      return
    }
    context.drawImage(capturedFrame, 0, 0)

    context.save()
    context.fillStyle = color
    context.globalAlpha = .22
    context.filter = 'blur(.8px)'
    context.fill(lipMask, 'evenodd')
    // Keep the camera's highlights and lip texture while applying the shade's chroma.
    context.globalCompositeOperation = 'color'
    context.globalAlpha = .86
    context.fill(lipMask, 'evenodd')
    context.restore()
  }

  const updateTracking = (session: TryOnSession) => {
    if (!color) {
      if (session.frame !== undefined) cancelAnimationFrame(session.frame)
      session.frame = undefined
      capturedFrame = undefined
      lipMask = undefined
      if (session.stream) status.textContent = ''
      return
    }

    if (session.track && session.frame === undefined) {
      session.frame = requestAnimationFrame(session.track)
    } else if (!session.track && session.stream) {
      status.textContent = 'Загрузка примерки…'
    }
  }

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
    paint()
    status.textContent = ''
    panel.hidden = true
    neutralOption.hidden = true
    exit.hidden = true
    start.hidden = false
    delete visual.dataset.tryOn
    onClose()
    if (restoreFocus) start.focus()
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
    visual.dataset.tryOn = ''
    status.textContent = 'Разрешите доступ к камере'
    start.hidden = true
    neutralOption.hidden = false
    exit.hidden = false
    close.focus()

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
      const { createLipTracker, createLipMask } = await import('./lip-tracking')
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
      const trackingGrace = 100
      let nextFrameTime = performance.now()
      let lastVisibleLips = -Infinity
      let confirmedFrames = 0

      const track = (time: number) => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && time >= nextFrameTime) {
          nextFrameTime = Math.max(nextFrameTime + frameInterval, time)
          try {
            if (source.width !== video.videoWidth || source.height !== video.videoHeight) {
              source.width = video.videoWidth
              source.height = video.videoHeight
              view.width = source.width
              view.height = source.height
              capturedFrame = undefined
              lipMask = undefined
            }
            if (!capturedFrame) {
              lastVisibleLips = -Infinity
              confirmedFrames = 0
            }
            // Read and display the same camera frame so the overlay cannot lag behind the preview.
            sourceContext.drawImage(video, 0, 0)
            const [face] = tracker.detectForVideo(source, time).faceLandmarks
            capturedFrame = source
            const visibleMask = face && createLipMask(face, sourceContext)
            confirmedFrames = visibleMask ? Math.min(confirmedFrames + 1, 2) : 0
            if (visibleMask) {
              lastVisibleLips = time
              if (lipMask || confirmedFrames === 2) lipMask = visibleMask
            } else if (lipMask && time - lastVisibleLips < trackingGrace) {
              // Follow current landmarks while the image-based visibility check recovers.
              if (face) lipMask = createLipMask(face, sourceContext, false)
            } else {
              lipMask = undefined
            }
            paint()
            const message = time - lastVisibleLips < 350 ? '' : face ? 'Губы не распознаны' : 'Посмотрите в камеру'
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

  return (nextColor: string | null) => {
    color = nextColor
    if (activeSession) updateTracking(activeSession)
    paint()
  }
}
