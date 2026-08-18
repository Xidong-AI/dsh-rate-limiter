#!/usr/bin/env node
// 基于 git-commit-regulation 规范的自包含提交信息语法检查
// 规则源：https://github.com/PJ-568/git-commit-regulation（CC BY-SA 4.0）
// 用法：node scripts/check-grammar.mjs            自测（正反例断言 + 历史提交报告）
//       node scripts/check-grammar.mjs --file X  检查提交信息文件（commit-msg 钩子）

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO_DIR = fileURLToPath(new URL("..", import.meta.url));

// 标题语法正则（与 git-commit-regulation README 附录「标题语法」同步维护）
const TITLE_RE =
  /^【(?<type>初始|更改|新增|修复|格式|文档|测试|维护)(?:，(?<scope>[\p{Script=Han}A-Za-z0-9_-]{1,16}))?】(?<summary>[^\n]{1,60})$/u;
const HAN_ONLY_RE = /^[\p{Script=Han}]+$/u;
const ISSUE_RE = /#\d+/u;

// 解析提交信息；结构违规时抛出带原因的错误
function parse(message) {
  const text = message.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  const lines = text.split("\n");
  const titleLine = lines[0] ?? "";
  const m = TITLE_RE.exec(titleLine);
  if (!m) {
    throw new Error(titleLine === "" ? "标题缺失" : "标题不符合语法");
  }
  const rest = lines.slice(1);
  if (rest.length > 0 && rest[0] !== "") {
    throw new Error("描述必须以一个空行与标题相隔");
  }
  let description = null;
  if (rest.length > 1) {
    const body = rest.slice(1).join("\n").replace(/\n+$/, "");
    if (body !== "") description = body;
  }
  return {
    type: m.groups.type,
    scope: m.groups.scope ?? null,
    summary: m.groups.summary,
    description,
  };
}

// 警告项（解析器应接受并提示）
function warnings(parsed) {
  const ws = [];
  if (HAN_ONLY_RE.test(parsed.summary) && [...parsed.summary].length > 30) {
    ws.push("摘要为纯汉字且超过 30 汉字（人工建议）");
  }
  if (ISSUE_RE.test(parsed.summary)) {
    ws.push("标题包含问题编号，应移至描述");
  }
  return ws;
}

// —— 命令行模式：检查提交信息文件（commit-msg 钩子）——
// simp: 只过滤 git 注释行（# 开头）；正文中顶格的 #568 行同样被过滤，
//       与 git 默认 cleanup 行为一致，故钩子不单独校验描述中的问题编号。
const [mode, filePath] = process.argv.slice(2);
if (mode === "--file") {
  if (!filePath) {
    console.error("用法：node scripts/check-grammar.mjs --file <路径>");
    process.exit(2);
  }
  const cleaned = readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();
  if (cleaned === "") {
    console.error("错误：提交信息为空");
    process.exit(1);
  }
  try {
    const parsed = parse(cleaned);
    const ws = warnings(parsed);
    if (ws.length > 0) {
      console.warn("警告：\n" + ws.map((w) => `- ${w}`).join("\n"));
    }
  } catch (e) {
    console.error(`错误：${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// 正例与反例（与 git-commit-regulation README 附录表格一致）
const positives = [
  ["最小提交", "【修复】解决登录界面的输入验证问题"],
  ["带范围", "【修复，认证】解决登录界面的输入验证问题"],
  ["摘要 60 码点上限", "【新增】" + "a".repeat(60)],
  [
    "带描述",
    "【修复，认证】解决登录界面的输入验证问题\n\n修复了登录界面中输入验证逻辑的问题。\n\n相关问题编号：\n\n#568",
  ],
];

const negatives = [
  ["摘要为空", "【初始】"],
  ["类型不在枚举内", "【验证】执行检查"],
  ["缺少左括号", "修复】解决登录界面的输入验证问题"],
  ["半角逗号", "【修复,认证】解决登录界面的输入验证问题"],
  ["范围含空格", "【修复， 认证】解决登录界面的输入验证问题"],
  ["摘要超过 60 码点", "【新增】" + "a".repeat(61)],
  ["描述未以空行相隔", "【修复】解决登录界面的输入验证问题\n第二行直接开始"],
  ["空消息", ""],
];

let checked = 0;
for (const [name, msg] of positives) {
  assert.doesNotThrow(() => parse(msg), `正例应合法：${name}`);
  checked++;
}
for (const [name, msg] of negatives) {
  assert.throws(() => parse(msg), `反例应非法：${name}`);
  checked++;
}
// 警告项断言
assert.equal(
  warnings(parse("【新增】" + "功".repeat(31))).length,
  1,
  "纯汉字摘要超过 30 汉字应发出警告",
);
assert.equal(
  warnings(parse("【修复】解决 #568 问题")).length,
  1,
  "标题包含问题编号应发出警告",
);
checked += 2;

// 项目历史提交检查（报告，不阻塞）
// simp: 历史提交本身存在违规（如【初始】），故只报告不断言，避免脚本永远失败。
let history = [];
try {
  const log = execSync("git log --format=%s%x00", { cwd: REPO_DIR }).toString();
  // git 每条记录后附加换行，NUL 分割后需去除首尾空白
  history = log
    .split("\0")
    .map((m) => m.trim())
    .filter((m) => m !== "");
} catch {
  console.log("（跳过历史检查：非 git 环境）");
}
const report = [];
for (const msg of history) {
  try {
    const ws = warnings(parse(msg));
    if (ws.length > 0) report.push(`${msg}：${ws.join("；")}`);
  } catch (e) {
    report.push(`${msg}：${e.message}`);
  }
}

console.log(
  `断言通过：${checked} 个正反例与警告断言、${history.length} 条历史提交`,
);
if (report.length > 0) {
  console.log("历史提交检查报告（不阻塞）：");
  for (const r of report) console.log(`- ${r}`);
} else {
  console.log("历史提交检查报告：全部合规");
}