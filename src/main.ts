import shades from './shades.json'
import { setupProductGallery } from './product-gallery'
import { setupProductModel } from './product-model'
import { setupProductTryOn } from './product-try-on'
import { setupShadeComparison } from './shade-comparison'
import './style.css'
import './shade-comparison.css'

const options = document.querySelector<HTMLDivElement>('#shade-options')
const selectedShade = document.querySelector<HTMLSpanElement>('#selected-shade')
const neutralOption = document.querySelector<HTMLLabelElement>('#try-on-neutral')
const neutralInput = document.querySelector<HTMLInputElement>('#shade-none')
const setGalleryShade = setupProductGallery()
const setModelColor = setupProductModel()
let restoreShade: (() => void) | undefined
const tryOn = setupProductTryOn(() => {
  comparison?.reset()
  if (neutralInput?.checked) restoreShade?.()
})
const comparison = setupShadeComparison((enabled, shade) => tryOn?.setComparedShade(enabled, shade?.rgb ?? null))

neutralInput?.addEventListener('change', () => {
  if (selectedShade) selectedShade.textContent = 'Без оттенка'
  comparison?.setFirstShade()
  tryOn?.setShade(null)
})

if (options) {
  const storageKey = 'cosmetics-webar:first-shade'
  let initialShadeId = 'S001'
  try {
    const savedShadeId = localStorage.getItem(storageKey)
    if (savedShadeId !== null && shades.some(shade => shade.id === savedShadeId)) {
      initialShadeId = savedShadeId
    }
  } catch {
    // Use the default shade when storage is unavailable.
  }

  for (const shade of shades) {
    const color = `rgb(${shade.rgb.join(', ')})`
    const label = document.createElement('label')
    label.className = 'shade-option'
    label.title = shade.name
    label.style.setProperty('--swatch-color', color)

    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'shade'
    input.value = shade.id
    input.checked = shade.id === initialShadeId
    input.setAttribute('aria-label', shade.name)

    const swatch = document.createElement('span')
    swatch.className = 'swatch'
    swatch.setAttribute('aria-hidden', 'true')
    label.append(input, swatch)
    options.insertBefore(label, neutralOption)

    const selectShade = () => {
      input.checked = true
      restoreShade = selectShade
      if (selectedShade) selectedShade.textContent = shade.name
      document.documentElement.style.setProperty('--chosen-shade', color)
      setGalleryShade?.(shade.id.toLowerCase())
      setModelColor?.(color)
      comparison?.setFirstShade(shade)
      tryOn?.setShade(shade.rgb)
    }

    input.addEventListener('change', () => {
      document.documentElement.dataset.animateShade = ''
      selectShade()
      try {
        localStorage.setItem(storageKey, shade.id)
      } catch {
        // The current selection still works when storage is unavailable.
      }
    })
    if (input.checked) selectShade()
  }
}
