// A map check can continue after the printable project is ready. Foreground
// operations take precedence, and each owner clears only its own indicator.
type Source = 'work' | 'naver'
type Progress = { label: string; done?: number; total?: number }
const active: Partial<Record<Source, Progress>> = {}

export function setProgress(source: Source, label?: string, done?: number, total?: number) {
  if (label) active[source] = { label, done, total }
  else delete active[source]

  const progress = active.work ?? active.naver
  const panel = document.getElementById('work-progress')!
  panel.hidden = !progress
  if (!progress) return

  const title = document.getElementById('progress-label')!
  if (title.textContent !== progress.label) title.textContent = progress.label
  const bar = document.getElementById('progress-bar')!
  const count = document.getElementById('progress-count')!
  if (progress.done !== undefined && progress.total !== undefined) {
    bar.setAttribute('aria-valuemax', String(progress.total))
    bar.setAttribute('aria-valuenow', String(progress.done))
    bar.style.setProperty('--filled', String(progress.done / progress.total))
    count.textContent = progress.done + ' / ' + progress.total
  } else {
    bar.removeAttribute('aria-valuenow')
    bar.removeAttribute('aria-valuemax')
    count.textContent = ''
  }
}
