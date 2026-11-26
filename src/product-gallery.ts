const views = [
  { suffix: '', label: 'Открытая помада спереди' },
  { suffix: '-angle', label: 'Открытая помада в три четверти' },
  { suffix: null, label: 'Помада с колпачком' },
]

const posters = import.meta.glob<string>('./assets/lipstick-*.webp', {
  eager: true,
  import: 'default',
  query: '?url',
})

export function setupProductGallery() {
  const gallery = document.querySelector<HTMLDivElement>('#product-gallery')
  const photos = document.querySelector<HTMLDivElement>('#product-photos')
  const dots = gallery?.querySelector<HTMLDivElement>('.gallery-pagination')
  const prev = gallery?.querySelector<HTMLButtonElement>('.gallery-prev')
  const next = gallery?.querySelector<HTMLButtonElement>('.gallery-next')
  if (!gallery || !photos || !dots || !prev || !next) return

  let selectedIndex = 0
  const entries = views.map((view, index) => {
    const image = new Image(800, 800)
    if (index === 0) image.id = 'product-poster'
    image.alt = view.label
    image.className = 'product-poster'
    photos.append(image)

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'gallery-dot'
    button.setAttribute('aria-label', view.label)
    button.setAttribute('aria-controls', photos.id)
    button.addEventListener('click', () => selectView(index))
    dots.append(button)

    return { view, button, image }
  })

  function selectView(index: number) {
    const previous = entries[selectedIndex]?.image
    const direction = Math.sign(index - selectedIndex)
    selectedIndex = (index + entries.length) % entries.length
    for (const [position, { button, image }] of entries.entries()) {
      const active = position === selectedIndex
      image.toggleAttribute('data-active', active)
      image.setAttribute('aria-hidden', String(!active))
      button.setAttribute('aria-pressed', String(active))
    }

    const current = entries[selectedIndex]?.image
    if (!direction || !previous || !current) return

    for (const { image } of entries) {
      for (const animation of image.getAnimations()) animation.cancel()
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const timing = { duration: 340, easing: 'cubic-bezier(.25, .7, .25, 1)' }
    const center = { transform: 'translateX(0)', opacity: 1 }
    previous.animate([center, { transform: `translateX(${-direction * 100}cqi)`, opacity: 1 }], timing)
    current.animate([{ transform: `translateX(${direction * 100}cqi)`, opacity: 1 }, center], timing)
  }

  prev.addEventListener('click', () => selectView(selectedIndex - 1))
  next.addEventListener('click', () => selectView(selectedIndex + 1))
  gallery.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    selectView(selectedIndex + (event.key === 'ArrowLeft' ? -1 : 1))
  })

  selectView(0)
  gallery.hidden = false

  return (shade: string) => {
    for (const { view, image } of entries) {
      const fileName = view.suffix === null ? 'closed' : shade + view.suffix
      const url = posters[`./assets/lipstick-${fileName}.webp`]
      if (url && image.getAttribute('src') !== url) image.src = url
    }
  }
}
