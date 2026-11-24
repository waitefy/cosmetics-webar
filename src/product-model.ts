import type { ModelViewerElement } from '@google/model-viewer'
import modelUrl from './assets/lipstick.glb?url'

const orbitRadius = '0.255m'
const initialOrbit = `28deg 75deg ${orbitRadius}`
const closedTarget = '0m 0.042m 0m'
const openTarget = '0.015m 0.045m 0m'
const mechanism = 'Mechanism'
// Poses in the Mechanism animation, in seconds.
const closed = 0
const capOff = 36 / 30
const stickOut = 55 / 30

export function setupProductModel() {
  const panel = document.querySelector<HTMLDivElement>('#product-model')
  const toggle = document.querySelector<HTMLButtonElement>('#model-toggle')
  const status = document.querySelector<HTMLParagraphElement>('#model-status')
  const gallery = document.querySelector<HTMLDivElement>('#product-gallery')
  const actions = document.querySelector<HTMLDivElement>('#model-actions')
  const cap = document.querySelector<HTMLButtonElement>('#cap-toggle')
  const stick = document.querySelector<HTMLButtonElement>('#stick-toggle')

  if (!panel || !toggle || !status || !gallery || !actions || !cap || !stick) return

  let viewer: ModelViewerElement | undefined
  let color = ''
  let failedLoads = 0
  let pose = closed
  let moving = false

  const updateColor = () => {
    viewer?.model?.getMaterialByName('Lipstick')?.pbrMetallicRoughness.setBaseColorFactor(color)
  }

  const updateActions = () => {
    cap.setAttribute('aria-label', pose === closed ? 'Снять колпачок' : 'Надеть колпачок')
    stick.setAttribute('aria-label', pose === stickOut ? 'Вкрутить стик' : 'Выкрутить стик')
    cap.toggleAttribute('data-reverse', pose !== closed)
    stick.toggleAttribute('data-reverse', pose === stickOut)
    cap.setAttribute('aria-disabled', String(moving))
    stick.setAttribute('aria-disabled', String(moving))
  }

  const moveTo = (target: number) => {
    const model = viewer
    if (!model?.loaded || moving) return

    model.cameraTarget = target === closed ? closedTarget : openTarget

    const finish = () => {
      model.currentTime = target
      pose = target
      moving = false
      updateActions()
    }

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish()
      void model.updateComplete.then(() => model.jumpCameraToGoal())
      return
    }

    const start = performance.now()
    const duration = Math.abs(target - pose) * 1000
    moving = true
    updateActions()

    const step = (now: number) => {
      if (viewer !== model) return
      const progress = Math.max(0, (now - start) / duration)
      if (progress >= 1) {
        finish()
        return
      }
      model.currentTime = pose + (target - pose) * progress
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  cap.addEventListener('click', () => moveTo(pose === closed ? capOff : closed))
  stick.addEventListener('click', () => moveTo(pose === stickOut ? capOff : stickOut))

  const setOpen = (open: boolean) => {
    panel.hidden = !open
    gallery.hidden = open
    actions.hidden = !open || !panel.hasAttribute('data-ready')
    toggle.textContent = open ? '2D' : '3D'
    toggle.setAttribute('aria-label', open ? 'Вернуться к 2D-изображению' : 'Посмотреть в 3D')
    toggle.setAttribute('aria-expanded', String(open))
  }

  const showError = (message: string) => {
    viewer?.remove()
    viewer = undefined
    pose = closed
    moving = false
    updateActions()
    panel.removeAttribute('data-ready')
    if (panel.hidden) return

    setOpen(false)
    status.textContent = message
  }

  toggle.addEventListener('click', async () => {
    const open = panel.hasAttribute('hidden')
    setOpen(open)
    status.textContent = ''
    if (!open) {
      if (viewer?.loaded) {
        viewer.cameraOrbit = initialOrbit
        viewer.jumpCameraToGoal()
      }
      return
    }

    if (panel.hasAttribute('data-ready')) return

    status.textContent = 'Загрузка 3D-модели…'
    if (viewer) return

    try {
      await import('@google/model-viewer')
      if (panel.hidden || viewer) return

      const model = document.createElement('model-viewer')
      model.alt = 'Трёхмерная модель помады «Мягкий цвет»'
      model.cameraControls = true
      model.interactionPrompt = 'none'
      model.cameraOrbit = initialOrbit
      model.cameraTarget = closedTarget
      model.fieldOfView = '30deg'
      model.maxCameraOrbit = `auto auto ${orbitRadius}`
      model.disablePan = true
      model.disableZoom = true
      model.touchAction = 'pan-y'
      model.loading = 'eager'
      model.animationName = mechanism
      model.addEventListener('load', () => {
        if (viewer !== model) return

        // Keep the clip paused and seek only through the requested part.
        model.play({ repetitions: 1, pingpong: false })
        model.pause()
        if (!model.availableAnimations.includes(mechanism) || model.duration <= stickOut) {
          showError('Не удалось загрузить анимацию помады.')
          return
        }

        model.currentTime = closed
        updateColor()
        panel.setAttribute('data-ready', '')
        actions.hidden = panel.hidden
        status.textContent = ''
      })
      model.addEventListener('error', () => {
        if (viewer !== model) return

        failedLoads += 1
        showError('Не удалось загрузить 3D-модель. Попробуйте ещё раз.')
      })

      const url = new URL(modelUrl, document.baseURI)
      // The loader caches rejected requests by URL.
      if (failedLoads > 0) url.searchParams.set('retry', String(failedLoads))
      viewer = model
      model.src = url.href
      panel.append(model)
    } catch {
      showError('Не удалось открыть 3D-просмотр. Обновите страницу и попробуйте ещё раз.')
    }
  })

  return (nextColor: string) => {
    color = nextColor
    updateColor()
  }
}
