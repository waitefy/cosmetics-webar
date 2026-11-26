import shades from './shades.json'

type Shade = (typeof shades)[number]
type ShadeChange = (enabled: boolean, shade?: Shade) => void

export function setupShadeComparison(onShadeChange: ShadeChange) {
  const root = document.documentElement
  const panel = document.querySelector<HTMLDivElement>('#product-try-on')
  const mode = document.querySelector<HTMLButtonElement>('#compare-mode')
  const divider = document.querySelector<HTMLDivElement>('.compare-split')
  const slider = document.querySelector<HTMLDivElement>('#compare-slider')
  const firstNumber = document.querySelector<HTMLSpanElement>('#compare-first-number')
  const firstValue = document.querySelector<HTMLSpanElement>('.compare-first-value')
  const firstOptions = document.querySelector<HTMLDivElement>('#shade-options')
  const secondPalette = document.querySelector<HTMLFieldSetElement>('#compare-second-palette')
  const secondOptions = document.querySelector<HTMLDivElement>('#compare-second-options')
  const secondHeading = document.querySelector<HTMLDivElement>('#compare-second-heading')
  const secondName = document.querySelector<HTMLSpanElement>('#compare-second-shade')
  if (!panel || !mode || !divider || !slider || !firstNumber || !firstValue || !firstOptions ||
      !secondPalette || !secondOptions || !secondHeading || !secondName) return

  const neutralName = 'Без оттенка'
  const rightInputs = new Map<string, HTMLInputElement>()
  let firstShade: Shade | undefined
  let comparing = false
  let position = 50
  let dragOffset = 0

  for (const label of [...shades.map(shade => shade.name), neutralName]) {
    const measure = document.createElement('span')
    measure.className = 'selected-shade compare-shade-measure'
    measure.setAttribute('aria-hidden', 'true')
    measure.textContent = label
    firstValue.append(measure)
  }

  const setThemeTint = (side: 'left' | 'right', shade?: Shade) => {
    root.style.setProperty(`--compare-${side}-tint`, shade ? `rgb(${shade.rgb.join(', ')})` : '#fffaf4')
  }

  const buildSecondPalette = () => {
    if (rightInputs.size > 0) return
    for (const label of firstOptions.querySelectorAll<HTMLLabelElement>('.shade-option')) {
      const copy = label.cloneNode(true) as HTMLLabelElement
      const input = copy.querySelector('input')
      if (!input) continue
      copy.removeAttribute('id')
      copy.hidden = false
      input.removeAttribute('id')
      input.name = 'shade-right'
      rightInputs.set(input.value, input)
      secondOptions.append(copy)
    }
  }

  const setSecondShade = (shade?: Shade) => {
    secondName.textContent = shade?.name ?? neutralName
    setThemeTint('right', shade)
    onShadeChange(true, shade)
  }

  secondOptions.addEventListener('change', (event) => {
    if (comparing && event.target instanceof HTMLInputElement) {
      const id = event.target.value
      setSecondShade(shades.find(shade => shade.id === id))
    }
  })

  const split = (value: number) => {
    position = Math.min(100, Math.max(0, Math.round(value)))
    panel.style.setProperty('--split', `${position}%`)
    slider.setAttribute('aria-valuenow', String(position))
    slider.setAttribute('aria-valuetext', `Слева ${position} процентов, справа ${100 - position} процентов`)
  }

  const changeMode = (enabled: boolean) => {
    if (enabled === comparing) return
    comparing = enabled
    const action = enabled ? 'Один оттенок' : 'Сравнить оттенки'
    mode.setAttribute('aria-label', action)
    mode.title = action
    mode.setAttribute('aria-expanded', String(enabled))
    panel.toggleAttribute('data-compare', enabled)
    root.toggleAttribute('data-shade-compare', enabled)
    divider.hidden = secondPalette.hidden = secondHeading.hidden = firstNumber.hidden = !enabled
    divider.inert = secondPalette.inert = secondHeading.inert = !enabled
    firstNumber.setAttribute('aria-hidden', String(!enabled))
    if (!enabled) {
      onShadeChange(false)
      return
    }

    buildSecondPalette()
    const index = shades.findIndex(shade => shade.id === firstShade?.id)
    const nextShade = shades[(index + 1) % shades.length]
    const nextInput = nextShade && rightInputs.get(nextShade.id)
    if (nextInput) nextInput.checked = true
    split(50)
    setSecondShade(nextShade)
  }

  mode.addEventListener('click', () => changeMode(!comparing))
  slider.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return
    const { left, width } = panel.getBoundingClientRect()
    dragOffset = event.clientX - (left + width * position / 100)
    slider.focus({ preventScroll: true })
    slider.setPointerCapture(event.pointerId)
  })
  slider.addEventListener('pointermove', (event) => {
    if (!slider.hasPointerCapture(event.pointerId)) return
    const { left, width } = panel.getBoundingClientRect()
    split((event.clientX - left - dragOffset) * 100 / width)
  })
  slider.addEventListener('keydown', (event) => {
    const next = { ArrowLeft: position - 2, ArrowRight: position + 2, Home: 0, End: 100 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    split(next)
  })

  return {
    setFirstShade(shade?: Shade) {
      firstShade = shade
      setThemeTint('left', shade)
    },
    reset: () => changeMode(false),
  }
}
