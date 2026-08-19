import { describe, expect, it } from "vitest";
import { buildMutateOps, mergePatch } from "../lib/gateway.js";

describe("buildMutateOps", () => {
  it("顶层 null 键 → unset", () => {
    expect(buildMutateOps({ enabled: null })).toEqual([{ op: "unset", path: ["enabled"] }]);
  });

  it("providers 内 null 键 → unset [providers, k]", () => {
    expect(buildMutateOps({ providers: { p: null } })).toEqual([
      { op: "unset", path: ["providers", "p"] },
    ]);
  });

  it("普通值 → set", () => {
    expect(buildMutateOps({ enabled: false })).toEqual([
      { op: "set", path: ["enabled"], value: false },
    ]);
  });

  it("providers 内普通值 → set [providers, k]", () => {
    expect(buildMutateOps({ providers: { p: { rate: 1, burst: 2 } } })).toEqual([
      { op: "set", path: ["providers", "p"], value: { rate: 1, burst: 2 } },
    ]);
  });

  it("混合场景：顶层 set + providers 内 set/unset", () => {
    expect(
      buildMutateOps({
        enabled: true,
        providers: { a: { rate: 1, burst: 1 }, b: null },
      }),
    ).toEqual([
      { op: "set", path: ["enabled"], value: true },
      { op: "set", path: ["providers", "a"], value: { rate: 1, burst: 1 } },
      { op: "unset", path: ["providers", "b"] },
    ]);
  });

  it("空 patch → 空操作序列", () => {
    expect(buildMutateOps({})).toEqual([]);
  });
});

describe("mergePatch", () => {
  const current = {
    enabled: true,
    providers: { a: { rate: 1, burst: 1 }, b: { rate: 2, burst: 2 } },
  };

  it("null 键从 current 中删除", () => {
    expect(mergePatch({ enabled: null }, current)).toEqual({
      providers: { a: { rate: 1, burst: 1 }, b: { rate: 2, burst: 2 } },
    });
  });

  it("非 null 值覆盖", () => {
    expect(mergePatch({ enabled: false }, current)).toEqual({
      enabled: false,
      providers: { a: { rate: 1, burst: 1 }, b: { rate: 2, burst: 2 } },
    });
  });

  it("providers 递归合并：覆盖 + 删除", () => {
    expect(
      mergePatch({ providers: { a: { rate: 9, burst: 9 }, b: null } }, current),
    ).toEqual({
      enabled: true,
      providers: { a: { rate: 9, burst: 9 } },
    });
  });

  it("providers 合并保留未涉及的键", () => {
    expect(mergePatch({ providers: { c: { rate: 3, burst: 3 } } }, current)).toEqual({
      enabled: true,
      providers: {
        a: { rate: 1, burst: 1 },
        b: { rate: 2, burst: 2 },
        c: { rate: 3, burst: 3 },
      },
    });
  });

  it("无 current 时（空对象）", () => {
    expect(mergePatch({ enabled: false, providers: { p: { rate: 1, burst: 1 } } }, {})).toEqual({
      enabled: false,
      providers: { p: { rate: 1, burst: 1 } },
    });
  });

  it("current 无 providers 时 providers 合并仍成立", () => {
    expect(mergePatch({ providers: { p: { rate: 1, burst: 1 } } }, { enabled: true })).toEqual({
      enabled: true,
      providers: { p: { rate: 1, burst: 1 } },
    });
  });
});