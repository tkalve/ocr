import { joinLines } from './ocr.ts'

/** True when the current selection covers some of the text layer. */
export function selectionTouches(layer: HTMLElement | null, selection: Selection | null): selection is Selection {
  return Boolean(layer && selection && !selection.isCollapsed && selection.rangeCount > 0 && selection.containsNode(layer, true))
}

/**
 * Text selected inside the text layer, rebuilt from the line elements so that
 * line and paragraph breaks are identical in every browser (the layer is made
 * of absolutely positioned boxes, which browsers serialise inconsistently).
 */
export function selectedText(layer: HTMLElement, selection: Selection): string {
  const picked: { paragraph: number; text: string }[] = []
  const lineRange = document.createRange()
  for (const line of layer.querySelectorAll<HTMLElement>('[data-paragraph]')) {
    let text = ''
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i)
      if (!range.intersectsNode(line)) continue
      lineRange.selectNodeContents(line)
      if (range.compareBoundaryPoints(Range.START_TO_START, lineRange) > 0) {
        lineRange.setStart(range.startContainer, range.startOffset)
      }
      if (range.compareBoundaryPoints(Range.END_TO_END, lineRange) < 0) {
        lineRange.setEnd(range.endContainer, range.endOffset)
      }
      text += lineRange.toString()
    }
    text = text.trim()
    if (text) picked.push({ paragraph: Number(line.dataset.paragraph), text })
  }
  return joinLines(picked)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Clipboard API unavailable (insecure context) or denied: fall back to execCommand.
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
  document.body.append(area)
  const selection = document.getSelection()
  const saved = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  if (saved && selection) {
    selection.removeAllRanges()
    selection.addRange(saved)
  }
  return ok
}
