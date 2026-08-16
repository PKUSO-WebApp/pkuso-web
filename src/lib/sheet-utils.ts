/**
 * Excel sheet 命名工具（纯函数，可单测）
 * 用于导出考勤等场景的 sheet 名清洗 + 重名去重。
 * Issue #169：导出全部考勤在微信浏览器无效（sheet 名含非法字符 / 重名会导致 XLSX 抛错）。
 */

/** Excel sheet 名非法字符：\ / ? * [ ] : */
const SHEET_NAME_ILLEGAL_CHARS = /[\/\\?*\[\]:]/g;

/** Excel sheet 名最大长度（XLSX 规范为 31 个字符） */
const SHEET_NAME_MAX_LENGTH = 31;

/**
 * 清洗 sheet 名：非法字符（\ / ? * [ ] :）替换为 _，再截断至 31 字符。
 * 清洗后为空时回退为 "Sheet"，避免 XLSX 空 sheet 名抛错。
 */
export function sanitizeSheetName(raw: string): string {
  const cleaned = raw.replace(SHEET_NAME_ILLEGAL_CHARS, "_").slice(0, SHEET_NAME_MAX_LENGTH);
  return cleaned || "Sheet";
}

/**
 * 批量生成唯一 sheet 名：
 * - 每个名字先经 sanitizeSheetName 清洗
 * - 重名时追加序号（从 2 开始），如 `排练_2026-08-16` → `排练_2026-08-16(2)`
 * - 追加序号后仍保证 ≤ 31 字符（先截断 base 再拼后缀）
 * - 若序号拼出的名字与既有名字冲突，继续递增直到唯一
 */
export function buildUniqueSheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base = sanitizeSheetName(raw);
    let candidate = base;
    let n = 1;
    while (used.has(candidate)) {
      n += 1;
      const suffix = `(${n})`;
      candidate = `${base.slice(0, SHEET_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
    }
    used.add(candidate);
    return candidate;
  });
}
