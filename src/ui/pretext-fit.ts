import { layout, prepare } from "@chenglou/pretext";

const numberData = (
  element: HTMLElement,
  key: string,
  fallback: number,
) => {
  const value = Number(element.dataset[key]);
  return Number.isFinite(value) ? value : fallback;
};

const availableSize = (element: HTMLElement) => {
  const style = getComputedStyle(element);
  const horizontal =
    Number.parseFloat(style.paddingLeft) +
    Number.parseFloat(style.paddingRight);
  const vertical =
    Number.parseFloat(style.paddingTop) +
    Number.parseFloat(style.paddingBottom);
  return {
    width: Math.max(1, element.clientWidth - horizontal),
    height: Math.max(1, element.clientHeight - vertical),
  };
};

/**
 * Uses Cheng Lou's Pretext measurements to choose the largest font size that
 * stays inside the fixed grid cell assigned to a text element.
 */
export function fitTextElement(element: HTMLElement) {
  const text = element.textContent?.trim() ?? "";
  if (!text || typeof Intl.Segmenter !== "function") return;
  const { width, height } = availableSize(element);
  const style = getComputedStyle(element);
  const minimum = numberData(element, "fitMin", 9);
  const maximum = Math.max(minimum, numberData(element, "fitMax", 28));
  const maxLines = Math.max(1, numberData(element, "fitLines", 1));
  const lineRatio = Math.max(0.8, numberData(element, "fitLine", 1.08));
  const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
  const fontFamily = style.fontFamily || '"Barlow Condensed"';
  const fontWeight = style.fontWeight || "700";
  const fontStyle = style.fontStyle === "italic" ? "italic " : "";

  const fits = (fontSize: number) => {
    const lineHeight = fontSize * lineRatio;
    const prepared = prepare(
      text,
      `${fontStyle}${fontWeight} ${fontSize}px ${fontFamily}`,
      { letterSpacing },
    );
    const result = layout(prepared, width, lineHeight);
    return result.lineCount <= maxLines && result.height <= height + 0.5;
  };

  let low = minimum;
  let high = maximum;
  for (let iteration = 0; iteration < 9; iteration += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  const fontSize = Math.max(minimum, Math.min(maximum, low));
  element.style.fontSize = `${fontSize.toFixed(2)}px`;
  element.style.lineHeight = `${(fontSize * lineRatio).toFixed(2)}px`;
  element.dataset.pretextFit = "ready";
}

export function installPretextFit(root: ParentNode = document) {
  const elements = Array.from(
    root.querySelectorAll<HTMLElement>("[data-fit-text]"),
  );
  const pending = new Set(elements);
  let frame: number | undefined;
  const flush = () => {
    frame = undefined;
    for (const element of pending) fitTextElement(element);
    pending.clear();
  };
  const schedule = (element?: HTMLElement) => {
    if (element) pending.add(element);
    else for (const candidate of elements) pending.add(candidate);
    if (frame === undefined) frame = requestAnimationFrame(flush);
  };

  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) schedule(entry.target as HTMLElement);
  });
  const mutations = elements.map((element) => {
    resize.observe(element);
    const observer = new MutationObserver(() => schedule(element));
    observer.observe(element, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    return observer;
  });
  void document.fonts.ready.then(() => schedule());
  schedule();

  return () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    resize.disconnect();
    for (const mutation of mutations) mutation.disconnect();
  };
}
