import shades from './shades.json'
import { setupProductGallery } from './product-gallery'
import { setupProductModel } from './product-model'
import './style.css'

const options = document.querySelector<HTMLDivElement>('#shade-options')
const setGalleryShade = setupProductGallery()
const setModelColor = setupProductModel()

if (options) {
  for (const [index, shade] of shades.entries()) {
    const color = `rgb(${shade.rgb.join(', ')})`
    const label = document.createElement('label')
    label.className = 'shade-option'
    label.style.setProperty('--swatch-color', color)

    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'shade'
    input.value = shade.id
    input.checked = index === 0

    const swatch = document.createElement('span')
    swatch.className = 'swatch'
    swatch.setAttribute('aria-hidden', 'true')
    label.append(input, swatch, shade.name)
    options.append(label)

    const selectShade = () => {
      setGalleryShade?.(shade.id.toLowerCase())
      setModelColor?.(color)
    }

    input.addEventListener('change', selectShade)
    if (input.checked) selectShade()
  }
}
