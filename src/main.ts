import shades from './shades.json'
import './style.css'

const options = document.querySelector<HTMLDivElement>('#shade-options')

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
      document.documentElement.style.setProperty('--selected-color', color)
    }

    input.addEventListener('change', selectShade)
    if (input.checked) selectShade()
  }
}
