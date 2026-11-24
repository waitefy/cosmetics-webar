import shades from './shades.json'
import { setupProductModel } from './product-model'
import './style.css'

const options = document.querySelector<HTMLDivElement>('#shade-options')
const poster = document.querySelector<HTMLImageElement>('#product-poster')
const posters = import.meta.glob<string>('./assets/lipstick-*.webp', {
  eager: true,
  import: 'default',
  query: '?url',
})
const setModelColor = setupProductModel()

if (options) {
  for (const [index, shade] of shades.entries()) {
    const color = `rgb(${shade.rgb.join(', ')})`
    const posterUrl = posters[`./assets/lipstick-${shade.id.toLowerCase()}.webp`]
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
      if (poster && posterUrl) poster.src = posterUrl
      setModelColor?.(color)
    }

    input.addEventListener('change', selectShade)
    if (input.checked) selectShade()
  }
}
