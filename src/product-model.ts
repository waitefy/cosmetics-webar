import type { ModelViewerElement } from '@google/model-viewer'
import modelUrl from './assets/lipstick.glb?url'

const initialOrbit = '28deg 75deg 135%'

export function setupProductModel() {
  const panel = document.querySelector<HTMLDivElement>('#product-model')
  const toggle = document.querySelector<HTMLButtonElement>('#model-toggle')
  const status = document.querySelector<HTMLParagraphElement>('#model-status')

  if (!panel || !toggle || !status) return

  let viewer: ModelViewerElement | undefined
  let color = ''
  let failedLoads = 0

  const updateColor = () => {
    viewer?.model?.getMaterialByName('Lipstick')?.pbrMetallicRoughness.setBaseColorFactor(color)
  }

  const setOpen = (open: boolean) => {
    panel.hidden = !open
    toggle.textContent = open ? '2D' : '3D'
    toggle.setAttribute('aria-label', open ? 'Вернуться к 2D-изображению' : 'Посмотреть в 3D')
    toggle.setAttribute('aria-expanded', String(open))
  }

  const showError = (message: string) => {
    viewer?.remove()
    viewer = undefined
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

    if (viewer?.loaded) return

    status.textContent = 'Загрузка 3D-модели…'
    if (viewer) return

    try {
      await import('@google/model-viewer')
      if (panel.hidden || viewer) return

      const model = document.createElement('model-viewer')
      model.alt = 'Трёхмерная модель открытой помады «Мягкий цвет»'
      model.cameraControls = true
      model.cameraOrbit = initialOrbit
      model.maxCameraOrbit = 'auto auto 140%'
      model.disablePan = true
      model.disableZoom = true
      model.touchAction = 'pan-y'
      model.loading = 'eager'
      model.addEventListener('load', () => {
        if (viewer !== model) return

        updateColor()
        panel.setAttribute('data-ready', '')
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
