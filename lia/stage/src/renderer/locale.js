import { stageLocale, stageText } from '../shared/locale.ts'

const locale = stageLocale(await window.liaStageLanguage.get().catch(() => undefined))
document.documentElement.lang = locale

export function t(text) {
  return stageText(locale, text)
}

for (const element of document.querySelectorAll('[data-translate]'))
  element.textContent = t(element.textContent)
for (const element of document.querySelectorAll('[aria-label]'))
  element.setAttribute('aria-label', t(element.getAttribute('aria-label')))
