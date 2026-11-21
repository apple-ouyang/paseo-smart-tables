import {
  buildTableCss,
  computeBreakoutBox,
  computePreferredWidth,
  DEFAULT_CAP_EM,
  DEFAULT_GUTTER_PX,
  DEFAULT_TOKEN_EM,
  distributeColumns,
  splitBreakableTokens,
  type BreakoutBox,
} from "./layout.ts";

const ATTR_NAME = "data-paseo-smart-table";
const STYLE_ATTR = "data-paseo-smart-tables";
const PROBE_ID = "paseo-smart-tables-probe";

interface MeasuredTable {
  mins: number[];
  maxs: number[];
  cappedRaws: number[];
  tableBorder: number;
}

interface ManagedEntry {
  token: string;
  wrapper: HTMLElement;
  table: HTMLTableElement;
  resizeObserver: ResizeObserver | null;
  observedPane: HTMLElement | null;
  cellObserver: MutationObserver | null;
  rafId: number;
  fit: () => void;
  scheduleFit: () => void;
  dispose: () => void;
}

function getWindow(doc: Document): Window & typeof globalThis {
  return (doc.defaultView || window) as Window & typeof globalThis;
}

function isMarkdownTableWrapper(wrapper: HTMLElement, table: HTMLTableElement): boolean {
  if (wrapper.tagName !== "DIV") return false;
  if (wrapper.children.length !== 1 || wrapper.firstElementChild !== table) return false;
  if (wrapper.closest("[data-paseo-smart-table-ignore]")) return false;
  if (table.rows.length === 0) return false;
  const view = getWindow(wrapper.ownerDocument);
  const wrapperOverflowX = wrapper.style.overflowX || view.getComputedStyle(wrapper).overflowX;
  if (wrapperOverflowX !== "auto" && wrapperOverflowX !== "scroll" && wrapperOverflowX !== "overlay") {
    return false;
  }
  const collapse = table.style.borderCollapse || view.getComputedStyle(table).borderCollapse;
  return collapse === "collapse";
}

function findScrollPane(host: HTMLElement): HTMLElement | null {
  if (!host.parentElement) return null;
  const view = getWindow(host.ownerDocument);
  for (
    let node: HTMLElement | null = host.parentElement;
    node && node !== host.ownerDocument.body;
    node = node.parentElement
  ) {
    const style = view.getComputedStyle(node);
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;
    const clips =
      overflowX === "hidden" ||
      overflowX === "clip" ||
      overflowY === "hidden" ||
      overflowY === "clip";
    if (clips && node.clientWidth <= host.clientWidth + 2) return null;
    const scrolls = overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
    if (scrolls && node.clientWidth > host.clientWidth + 32) return node;
  }
  return null;
}

function getHostMetrics(host: HTMLElement): { left: number; width: number } {
  const view = getWindow(host.ownerDocument);
  const style = view.getComputedStyle(host);
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padRight = parseFloat(style.paddingRight) || 0;
  const width = Math.max(0, host.clientWidth - padLeft - padRight);
  const left = host.getBoundingClientRect().left + borderLeft + padLeft;
  return { left, width };
}

function ensureStyleSheet(doc: Document): HTMLStyleElement {
  let node = doc.querySelector<HTMLStyleElement>(`style[${STYLE_ATTR}]`);
  if (!node) {
    node = doc.createElement("style");
    node.setAttribute(STYLE_ATTR, "");
    (doc.head || doc.documentElement).appendChild(node);
  }
  return node;
}

function ensureProbe(doc: Document): HTMLSpanElement {
  let probe = doc.getElementById(PROBE_ID) as HTMLSpanElement | null;
  if (!probe) {
    probe = doc.createElement("span");
    probe.id = PROBE_ID;
    probe.setAttribute(STYLE_ATTR, "probe");
    probe.style.cssText =
      "position:absolute;left:-99999px;top:0;visibility:hidden;white-space:nowrap;width:max-content;pointer-events:none";
    (doc.body || doc.documentElement).appendChild(probe);
  }
  return probe;
}

function measureMinTokenWidth(text: string, probe: HTMLSpanElement, em: number): number {
  const tokens = splitBreakableTokens(text);
  let longest = 2 * em;
  const tokenCap = DEFAULT_TOKEN_EM * em;
  for (const token of tokens) {
    probe.textContent = token;
    if (probe.offsetWidth > longest) longest = probe.offsetWidth;
  }
  return longest > tokenCap ? tokenCap : longest;
}

function measureTable(table: HTMLTableElement): MeasuredTable | null {
  const rows = table.rows;
  if (!rows || rows.length === 0) return null;
  let count = 0;
  for (let r = 0; r < rows.length; r += 1) {
    count = Math.max(count, rows[r].cells.length);
  }
  if (count === 0) return null;
  const doc = table.ownerDocument;
  const view = getWindow(doc);
  const sample = rows[0].cells[0];
  if (!sample) return null;
  const style = view.getComputedStyle(sample);
  const tableStyle = view.getComputedStyle(table);
  const em = parseFloat(style.fontSize) || 16;
  const pad = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0) + 2;
  const tableBorder = Math.max(
    2,
    Math.ceil(
      (parseFloat(tableStyle.borderLeftWidth) || 0) + (parseFloat(tableStyle.borderRightWidth) || 0),
    ),
  );
  const probe = ensureProbe(doc);
  probe.style.font = style.font;
  probe.style.letterSpacing = style.letterSpacing;
  const floor = 3 * em + pad;
  const cap = DEFAULT_CAP_EM * em + pad;
  const mins = new Array<number>(count).fill(floor);
  const raws = new Array<number>(count).fill(floor);
  const contentEms = new Array<number>(count).fill(1);

  for (let r = 0; r < rows.length; r += 1) {
    const cells = rows[r].cells;
    for (let c = 0; c < cells.length; c += 1) {
      const cell = cells[c];
      const text = (cell.textContent || "").replace(/\s+/g, " ").trim().slice(0, 4000);
      if (!text) continue;
      probe.textContent = text;
      const codeCount = cell.querySelectorAll ? cell.querySelectorAll("code").length : 0;
      const textWidth = probe.offsetWidth + codeCount * 10;
      const raw = textWidth + pad;
      const token = measureMinTokenWidth(text, probe, em) + (codeCount > 0 ? 10 : 0) + pad;
      const cellEm = textWidth / em;
      if (raw > raws[c]) raws[c] = raw;
      if (token > mins[c]) mins[c] = token;
      if (cellEm > contentEms[c]) contentEms[c] = cellEm;
    }
  }

  const maxs = new Array<number>(count);
  const cappedRaws = new Array<number>(count);
  for (let c = 0; c < count; c += 1) {
    if (mins[c] > cap) mins[c] = cap;
    cappedRaws[c] = Math.min(raws[c], cap);
    if (cappedRaws[c] < mins[c]) cappedRaws[c] = mins[c];
    maxs[c] = computePreferredWidth(raws[c], contentEms[c], em, pad, mins[c], cap);
    if (mins[c] > maxs[c]) mins[c] = maxs[c];
  }
  return { mins, maxs, cappedRaws, tableBorder };
}

function reconcileWrapper(
  wrapper: HTMLElement,
  table: HTMLTableElement,
  token: string,
  colWidths: readonly number[],
  box: BreakoutBox | null,
  contentLeft: number,
  paneLeft: number,
  paneWidth: number,
  hostWidth: number,
  paneMax: number,
): string | null {
  const rectWidth = table.getBoundingClientRect ? table.getBoundingClientRect().width : 0;
  const actual = Math.ceil(Math.max(table.scrollWidth || 0, rectWidth || 0));
  if (!(actual > 0)) return null;
  const wrapperWidth = wrapper.clientWidth || (box ? box.width : hostWidth);
  if (!(actual > wrapperWidth)) return null;
  if (!(paneMax > wrapperWidth + 1)) return null;
  const target = Math.min(actual + 2, paneMax);
  const widened = computeBreakoutBox(
    contentLeft,
    paneLeft,
    paneWidth,
    hostWidth,
    DEFAULT_GUTTER_PX,
    target,
  );
  if (!widened || (box && widened.width <= box.width)) return null;
  return buildTableCss(token, colWidths, widened, false);
}

export function installSmartTables(doc: Document): () => void {
  const view = getWindow(doc);
  const cssByToken = new Map<string, string>();
  const entries = new Map<HTMLElement, ManagedEntry>();
  let seq = 0;
  let scanRaf = 0;
  let disposed = false;

  const renderSheet = () => {
    if (disposed) return;
    let css = "";
    for (const rule of cssByToken.values()) css += rule;
    const sheet = ensureStyleSheet(doc);
    if (sheet.textContent !== css) sheet.textContent = css;
  };

  const attachWrapper = (wrapper: HTMLElement, table: HTMLTableElement) => {
    if (disposed || entries.has(wrapper)) return;
    seq += 1;
    const token = `st-${seq}`;
    wrapper.setAttribute(ATTR_NAME, token);

    const entry: ManagedEntry = {
      token,
      wrapper,
      table,
      resizeObserver: null,
      observedPane: null,
      cellObserver: null,
      rafId: 0,
      fit: () => {},
      scheduleFit: () => {},
      dispose: () => {},
    };

    const fit = () => {
      entry.rafId = 0;
      if (disposed || !wrapper.isConnected) return;
      const host = wrapper.parentElement;
      if (!host || host.clientWidth < 40) {
        cssByToken.delete(token);
        renderSheet();
        return;
      }
      const measured = measureTable(table);
      if (!measured) {
        cssByToken.delete(token);
        renderSheet();
        return;
      }
      const hostMetrics = getHostMetrics(host);
      const hostWidth = hostMetrics.width >= 40 ? hostMetrics.width : host.clientWidth;
      const contentLeft = hostMetrics.left;
      const tableBorder = measured.tableBorder || 2;
      let sumRaw = 0;
      let sumMax = 0;
      for (let i = 0; i < measured.maxs.length; i += 1) {
        sumMax += measured.maxs[i];
        sumRaw += measured.cappedRaws[i];
      }
      const useRaw = sumRaw + tableBorder <= hostWidth;
      const chosenMaxs = useRaw ? measured.cappedRaws : measured.maxs;
      const chosenSum = useRaw ? sumRaw : sumMax;

      const pane = findScrollPane(host);
      if (pane && entry.resizeObserver && entry.observedPane !== pane) {
        if (entry.observedPane) entry.resizeObserver.unobserve(entry.observedPane);
        entry.resizeObserver.observe(pane);
        entry.observedPane = pane;
      }

      let paneMax = hostWidth;
      let paneLeft = 0;
      let paneWidth = hostWidth;
      if (pane) {
        const paneRect = pane.getBoundingClientRect();
        paneLeft = paneRect.left;
        paneWidth = pane.clientWidth;
        paneMax = Math.max(hostWidth, Math.floor(pane.clientWidth - DEFAULT_GUTTER_PX * 2));
      }

      const maxColsBudget = Math.max(0, paneMax - tableBorder);
      const available =
        chosenSum + tableBorder <= hostWidth ? chosenSum : Math.min(chosenSum, maxColsBudget);
      const laid = distributeColumns(measured.mins, chosenMaxs, available);
      const colWidths = laid.widths.map((w) => Math.round(w));
      const colSum = colWidths.reduce((acc, w) => acc + w, 0);
      const neededWidth = colSum + tableBorder;
      const fitsInHost = neededWidth <= hostWidth + 1;
      const box =
        pane && !fitsInHost
          ? computeBreakoutBox(
              contentLeft,
              paneLeft,
              paneWidth,
              hostWidth,
              DEFAULT_GUTTER_PX,
              neededWidth,
            )
          : null;

      cssByToken.set(token, buildTableCss(token, colWidths, box, fitsInHost));
      renderSheet();

      if (pane) {
        const reconciled = reconcileWrapper(
          wrapper,
          table,
          token,
          colWidths,
          box,
          contentLeft,
          paneLeft,
          paneWidth,
          hostWidth,
          paneMax,
        );
        if (reconciled) {
          cssByToken.set(token, reconciled);
          renderSheet();
        }
      }
    };

    const scheduleFit = () => {
      if (disposed || entry.rafId) return;
      if (typeof view.requestAnimationFrame === "function") {
        entry.rafId = view.requestAnimationFrame(fit);
      } else {
        fit();
      }
    };

    entry.fit = fit;
    entry.scheduleFit = scheduleFit;
    entry.dispose = () => {
      entry.resizeObserver?.disconnect();
      entry.cellObserver?.disconnect();
      if (entry.rafId && typeof view.cancelAnimationFrame === "function") {
        view.cancelAnimationFrame(entry.rafId);
        entry.rafId = 0;
      }
      wrapper.removeAttribute(ATTR_NAME);
      cssByToken.delete(token);
      entries.delete(wrapper);
    };

    if (typeof view.ResizeObserver === "function") {
      const resizeObserver = new view.ResizeObserver(scheduleFit);
      entry.resizeObserver = resizeObserver;
      if (wrapper.parentElement) resizeObserver.observe(wrapper.parentElement);
    }
    if (typeof view.MutationObserver === "function") {
      const cellObserver = new view.MutationObserver(scheduleFit);
      entry.cellObserver = cellObserver;
      cellObserver.observe(table, { childList: true, subtree: true, characterData: true });
    }

    entries.set(wrapper, entry);
    fit();
  };

  const scan = () => {
    scanRaf = 0;
    if (disposed) return;
    let pruned = false;
    for (const [wrapper, entry] of entries) {
      if (!wrapper.isConnected || !entry.table.isConnected) {
        entry.dispose();
        pruned = true;
      }
    }
    const tables = doc.querySelectorAll("table");
    for (let i = 0; i < tables.length; i += 1) {
      const table = tables[i];
      const wrapper = table.parentElement;
      if (!wrapper || entries.has(wrapper)) continue;
      if (isMarkdownTableWrapper(wrapper, table)) {
        attachWrapper(wrapper, table);
      }
    }
    if (pruned) renderSheet();
  };

  const scheduleScan = () => {
    if (disposed || scanRaf) return;
    if (typeof view.requestAnimationFrame === "function") {
      scanRaf = view.requestAnimationFrame(scan);
    } else {
      scan();
    }
  };

  scan();

  let rootObserver: MutationObserver | null = null;
  if (typeof view.MutationObserver === "function" && doc.body) {
    const observer = new view.MutationObserver((mutations: MutationRecord[]) => {
      for (let i = 0; i < mutations.length; i += 1) {
        const m = mutations[i];
        if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
          scheduleScan();
          return;
        }
      }
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    rootObserver = observer;
  }

  return () => {
    disposed = true;
    rootObserver?.disconnect();
    if (scanRaf && typeof view.cancelAnimationFrame === "function") {
      view.cancelAnimationFrame(scanRaf);
      scanRaf = 0;
    }
    for (const entry of [...entries.values()]) {
      entry.dispose();
    }
    cssByToken.clear();
    doc.querySelector(`style[${STYLE_ATTR}]`)?.remove();
    doc.getElementById(PROBE_ID)?.remove();
  };
}
