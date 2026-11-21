export interface BreakoutBox {
  width: number;
  marginLeft: number;
}

export interface ColumnDistribution {
  widths: number[];
  width: number;
}

export const DEFAULT_GUTTER_PX = 12;
export const DEFAULT_CAP_EM = 26;
export const DEFAULT_TOKEN_EM = 14;
export const DEFAULT_SQRT_FACTOR = 2.1;
export const DEFAULT_BASE_EM = 3;

/**
 * Compute an expanded wrapper box centered around the host content column while
 * staying inside the enclosing scroll pane's horizontal gutters.
 */
export function computeBreakoutBox(
  contentLeft: number,
  paneLeft: number,
  paneWidth: number,
  hostWidth: number,
  gutter: number,
  naturalWidth: number,
): BreakoutBox | null {
  const maxWidth = Math.max(hostWidth, Math.floor(paneWidth - gutter * 2));
  const needed = Math.ceil(naturalWidth);
  if (!(needed > hostWidth + 1)) return null;
  const width = Math.min(needed, maxWidth);
  const extra = width - hostWidth;
  const roomLeft = Math.max(0, contentLeft - (paneLeft + gutter));
  const roomRight = Math.max(0, paneLeft + paneWidth - gutter - (contentLeft + hostWidth));
  let shiftLeft = Math.min(roomLeft, extra / 2);
  let shiftRight = extra - shiftLeft;
  if (shiftRight > roomRight) {
    shiftLeft = Math.min(roomLeft, extra - roomRight);
    shiftRight = Math.min(roomRight, extra - shiftLeft);
  }
  const fit = Math.floor(hostWidth + shiftLeft + shiftRight);
  if (!(fit > hostWidth + 1)) return null;
  return { width: fit, marginLeft: shiftLeft === 0 ? 0 : -shiftLeft };
}

/**
 * LaTeX tabulary-inspired preferred column width: grows with the square root of
 * visual width (in em) plus border-box cell padding, clamped by minWidth, raw,
 * and cap.
 */
export function computePreferredWidth(
  raw: number,
  contentEm: number,
  em: number,
  pad: number,
  minWidth: number,
  cap: number,
): number {
  const guess = em * (DEFAULT_BASE_EM + DEFAULT_SQRT_FACTOR * Math.sqrt(Math.max(contentEm, 1))) + pad;
  let pref = guess;
  if (pref < minWidth) pref = minWidth;
  if (pref > raw) pref = raw;
  if (pref > cap) pref = cap;
  if (pref < minWidth && minWidth <= cap) pref = minWidth;
  return pref;
}

/**
 * CSS Tables 3 / Chromium TableLayoutAlgorithmAuto proportional distribution:
 * allocates extra space above column minimums proportionally to each column's
 * (max - min) deficit.
 */
export function distributeColumns(
  mins: readonly number[],
  maxs: readonly number[],
  available: number,
): ColumnDistribution {
  const count = mins.length;
  let sumMin = 0;
  let sumMax = 0;
  const clampedMaxs = new Array<number>(count);
  const widths = new Array<number>(count);
  for (let i = 0; i < count; i += 1) {
    const clamped = maxs[i] < mins[i] ? mins[i] : maxs[i];
    clampedMaxs[i] = clamped;
    sumMin += mins[i];
    sumMax += clamped;
  }
  if (sumMax <= available) {
    for (let i = 0; i < count; i += 1) widths[i] = clampedMaxs[i];
    return { widths, width: sumMax };
  }
  if (sumMin >= available) {
    for (let i = 0; i < count; i += 1) widths[i] = mins[i];
    return { widths, width: sumMin };
  }
  const extra = available - sumMin;
  const flex = sumMax - sumMin;
  let used = 0;
  for (let i = 0; i < count; i += 1) {
    widths[i] = Math.floor(mins[i] + (extra * (clampedMaxs[i] - mins[i])) / flex);
    used += widths[i];
  }
  const leftover = Math.round(available - used);
  if (leftover > 0) {
    let best = 0;
    for (let i = 1; i < count; i += 1) {
      if (clampedMaxs[i] - mins[i] > clampedMaxs[best] - mins[best]) best = i;
    }
    widths[best] += leftover;
  }
  return { widths, width: Math.round(available) };
}

/**
 * Split cell text into unbreakable token runs, allowing line breaks at spaces,
 * CJK/Latin list punctuation, path separators, and CJK character boundaries.
 */
export function splitBreakableTokens(text: string): string[] {
  const parts = String(text).split(/[\s、，,;；/\\|]+/);
  const tokens: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (/[\u3400-\u9fff]/.test(part)) {
      const runs = part.split(/[\u3400-\u9fff]+/);
      for (const run of runs) {
        if (run) tokens.push(run);
      }
      continue;
    }
    tokens.push(part);
  }
  return tokens;
}

/**
 * Generate scoped CSS rules for one managed table wrapper. Uses !important to
 * override Paseo's inline width:100% style without modifying React-managed
 * element.style properties.
 */
export function buildTableCss(
  token: string,
  colWidths: readonly number[],
  box: BreakoutBox | null,
  fitsInHost: boolean,
): string {
  const selector = `[data-paseo-smart-table="${token}"]`;
  let css = `${selector}{box-sizing:border-box!important;overflow-x:auto!important`;
  if (box && box.width >= 40) {
    const margin = Math.round(box.marginLeft * 100) / 100;
    css += `;width:${box.width}px!important;max-width:${box.width}px!important;margin-left:${margin}px!important`;
  } else if (!fitsInHost) {
    css += ";width:100%!important;max-width:100%!important;margin-left:0!important";
  } else {
    css += ";width:max-content!important;max-width:100%!important;margin-left:0!important";
  }
  css += `}${selector}>table{box-sizing:border-box!important;width:max-content!important;min-width:max-content!important}`;
  for (let i = 0; i < colWidths.length; i += 1) {
    const width = colWidths[i];
    const nth = i + 1;
    css +=
      `${selector}>table>thead>tr>th:nth-child(${nth}),` +
      `${selector}>table>tbody>tr>td:nth-child(${nth}),` +
      `${selector}>table>tr>th:nth-child(${nth}),` +
      `${selector}>table>tr>td:nth-child(${nth})` +
      `{box-sizing:border-box!important;width:${width}px!important;min-width:${width}px!important;max-width:${width}px!important;` +
      `vertical-align:top!important;white-space:normal!important;word-break:normal!important;line-break:strict!important;overflow-wrap:anywhere!important}`;
  }
  return css;
}
