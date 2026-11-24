import shades from './shades.json'
import { setupProductGallery } from './product-gallery'
import { setupProductModel } from './product-model'
import { setupProductTryOn } from './product-try-on'
import './style.css'

const options = document.querySelector<HTMLDivElement>('#shade-options')
const selectedShade = document.querySelector<HTMLSpanElement>('#selected-shade')
const neutralOption = document.querySelector<HTMLLabelElement>('#try-on-neutral')
const neutralInput = document.querySelector<HTMLInputElement>('#shade-none')
const setGalleryShade = setupProductGallery()
const setModelColor = setupProductModel()
let restoreShade: (() => void) | undefined
const setTryOnColor = setupProductTryOn(() => {
  if (neutralInput?.checked) restoreShade?.()
})

neutralInput?.addEventListener('change', () => {
  if (selectedShade) selectedShade.textContent = 'Без оттенка'
  setTryOnColor?.(null)
})

if (options) {
  for (const [index, shade] of shades.entries()) {
    const color = `rgb(${shade.rgb.join(', ')})`
    const label = document.createElement('label')
    label.className = 'shade-option'
    label.title = shade.name
    label.style.setProperty('--swatch-color', color)

    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'shade'
    input.value = shade.id
    input.checked = index === 0
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
      setTryOnColor?.(color)
    }

    input.addEventListener('change', selectShade)
    if (input.checked) selectShade()
  }
}
