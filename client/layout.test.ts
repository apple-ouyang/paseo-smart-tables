import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTableCss,
  computeBreakoutBox,
  computePreferredWidth,
  DEFAULT_CAP_EM,
  distributeColumns,
  splitBreakableTokens,
} from "./layout.ts";

describe("computeBreakoutBox", () => {
  it("keeps short tables inside the content column", () => {
    assert.equal(computeBreakoutBox(290, 0, 1400, 820, 12, 640), null);
    assert.equal(computeBreakoutBox(290, 0, 1400, 820, 12, 821), null);
  });

  it("expands medium tables symmetrically without touching pane edges", () => {
    const box = computeBreakoutBox(290, 0, 1400, 820, 12, 1100);
    assert.deepEqual(box, { width: 1100, marginLeft: -140 });
    assert.ok(box && 290 + box.marginLeft > 12);
    assert.ok(box && 290 + box.marginLeft + box.width < 1388);
  });

  it("clamps wide tables to pane gutters", () => {
    const box = computeBreakoutBox(290, 0, 1400, 820, 12, 2000);
    assert.deepEqual(box, { width: 1376, marginLeft: -278 });
    assert.equal(290 + box.marginLeft, 12);
    assert.equal(290 + box.marginLeft + box.width, 1388);
  });

  it("clamps both left and right edges for asymmetric hosts", () => {
    const box = computeBreakoutBox(112, 0, 1000, 700, 12, 1200);
    assert.ok(box !== null);
    assert.ok(112 + box.marginLeft >= 12);
    assert.ok(112 + box.marginLeft + box.width <= 988);
  });

  it("handles narrow pane with little left margin", () => {
    const box = computeBreakoutBox(12, 0, 400, 360, 12, 900);
    assert.deepEqual(box, { width: 376, marginLeft: 0 });
  });
});

describe("computePreferredWidth", () => {
  const em = 16;
  const pad = 26;
  const cap = DEFAULT_CAP_EM * em + pad;

  it("keeps short labels at their own single-line width", () => {
    const label = computePreferredWidth(110 + pad, 110 / em, em, pad, 32 + pad, cap);
    assert.equal(label, 110 + pad);
  });

  it("wraps long filename lists and caps extreme prose", () => {
    const filename = computePreferredWidth(900 + pad, 900 / em, em, pad, 40 + pad, cap);
    const huge = computePreferredWidth(2880 + pad, 2880 / em, em, pad, 40 + pad, cap);
    assert.ok(filename < 900 + pad);
    assert.equal(huge, cap);
  });

  it("allocates wider columns to denser cells", () => {
    const shortCell = computePreferredWidth(160 + pad, 160 / em, em, pad, 40 + pad, cap);
    const longCell = computePreferredWidth(1200 + pad, 1200 / em, em, pad, 40 + pad, cap);
    assert.ok(longCell > shortCell);
  });
});

describe("distributeColumns", () => {
  it("does not stretch short tables", () => {
    assert.deepEqual(distributeColumns([40, 80], [40, 80], 820), {
      widths: [40, 80],
      width: 120,
    });
  });

  it("allocates surplus space proportionally to (max - min)", () => {
    const result = distributeColumns([40, 40], [80, 400], 300);
    assert.equal(result.width, 300);
    assert.ok(result.widths[1] > result.widths[0]);
    assert.equal(result.widths[0] + result.widths[1], 300);
  });

  it("falls back to column minimums when available width is smaller than sumMin", () => {
    assert.deepEqual(distributeColumns([100, 120], [200, 300], 150), {
      widths: [100, 120],
      width: 220,
    });
  });
});

describe("splitBreakableTokens", () => {
  it("breaks on CJK enumeration commas, Latin punctuation, and CJK runs", () => {
    const tokens = splitBreakableTokens(
      "基础公设卡 + PhaseHarmonyAndKnots.lean、CausalDiamonds.lean/Foo",
    );
    assert.deepEqual(tokens, [
      "+",
      "PhaseHarmonyAndKnots.lean",
      "CausalDiamonds.lean",
      "Foo",
    ]);
  });
});

describe("buildTableCss", () => {
  it("emits border-box and max-content !important overrides for breakout tables", () => {
    const css = buildTableCss("st-1", [180, 240], { width: 422, marginLeft: -10 }, false);
    assert.ok(css.includes('[data-paseo-smart-table="st-1"]{box-sizing:border-box!important'));
    assert.ok(css.includes("width:422px!important;max-width:422px!important;margin-left:-10px!important"));
    assert.ok(css.includes("width:max-content!important;min-width:max-content!important"));
    assert.ok(css.includes("box-sizing:border-box!important;width:180px!important"));
    assert.ok(css.includes("box-sizing:border-box!important;width:240px!important"));
  });

  it("keeps fitting tables at max-content inside the content column", () => {
    const css = buildTableCss("st-2", [80, 140], null, true);
    assert.ok(css.includes("width:max-content!important;max-width:100%!important;margin-left:0!important"));
  });
});
