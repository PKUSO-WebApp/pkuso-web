import { pinyin } from "pinyin-pro";
import { FULL_SCORE_SECTION, INSTRUMENT_ORDER } from "@/constants/instruments";

/**
 * 曲子详情页的三级排序（pkuso-web#289）。
 *
 * 契约（2026-09-23 定）：
 *
 * 1. **声部**：按 `INSTRUMENT_ORDER`；**总谱最前**；**「其他」最后**
 * 2. **同声部内**：按乐器名拼音
 * 3. **同乐器内**：按第一个分声部号；**没有号的排最前**
 *
 * ## 为什么不在数据库里排
 *
 * 两个现成的列都不表达业务顺序，而且是**看起来能用**的那种：
 *
 * - `sheet_music_parts.sort_order` 实际全是 0（历史遗留，上传时写死 0）
 * - `sheet_music_files.created_at` 是**并发 worker 的完成顺序** —— #288 把流水线改成
 *   有界并发之后更是如此，同一个曲子重传一次顺序就可能变
 *
 * 所以顺序在这里按业务含义算。「恰好相等」时保持传入顺序（JS 的 sort 是稳定的），
 * 而传入顺序来自查询的 `created_at` —— 至少是个确定的顺序，不会每次刷新都跳。
 *
 * ⚠️ 排在这里还顺带绕开了一件事：`sub_parts` 是**数组**，在 SQL 里按首元素排要写
 * 表达式（`(sub_parts)[1]`）且 NULL/空数组的排序语义还得单独调；这里就是 `[0]`。
 */

interface SortableFile {
  instrument: string | null;
  sub_parts: number[] | null;
}

interface SortablePart {
  section: string | null;
  files: SortableFile[];
}

/**
 * 声部 → 排序档位。**总谱最前、「其他」最后**，其余按 `INSTRUMENT_ORDER` 的下标。
 *
 * 一切**未知**（NULL、空串、闭集外的值）与「其他」同档：它们都是「不知道这是什么声部」，
 * 而闭集外的值只可能来自 prompt 词表漂移（界面上已有 `isKnownSection` 告警）——
 * 排在最后比混进正常声部里更容易被发现。
 */
export function sectionSortKey(section: string | null): number {
  const s = (section ?? "").trim();
  if (s === FULL_SCORE_SECTION) return -1;
  const i = INSTRUMENT_ORDER.indexOf(s as (typeof INSTRUMENT_ORDER)[number]);
  return i === -1 ? INSTRUMENT_ORDER.length : i;
}

/**
 * 拼音排序键：`长笛` → `changdi`，`A调单簧管` → `atiaodanhuangguan`。
 *
 * ## 为什么用 `pinyin-pro` 而不是 `Intl.Collator("zh-CN")`
 *
 * 一开始用的是 `Intl.Collator`（仓库先例见 `src/lib/roster-utils.ts`，且它零成本）。
 * **实测否掉了它** —— 拿线上真实存在的乐器名逐个对比，五个用例错四个：
 *
 * | 比较 | ICU（zh-CN） | pinyin-pro | 实际数据里 |
 * | --- | --- | --- | --- |
 * | 长笛 vs 短笛 | 短笛在前 ✗ | 长笛在前 ✓ | 长笛声部两个都有 |
 * | 长号 vs 低音长号 | 低音长号在前 ✗ | 长号在前 ✓ | 长号声部两个都有 |
 * | 降E调单簧管 vs A调单簧管 | 降E调在前 ✗ | A调在前 ✓ | 单簧管声部两个都有 |
 * | 长笛 vs 大管 | 长笛在后 ✗ | 长笛在前 ✓ | 「其他」里可能同框 |
 *
 * 两处根因：① ICU 把 `长` 读成 **zhǎng**（长笛掉进 `zh` 档，于是排在 `d`、`s` 之后）；
 * ② **以拉丁字母开头的名字被排到所有中文名之后**（`A调单簧管` 落到末尾）。
 * 而契约（pkuso-web#289）写的是「同声部内按乐器名拼音」—— 这不是口味问题，
 * 是没兑现。
 *
 * 代价：`pinyin-pro` 的 dist 约 324KB（gzip 后约 1/3），而这条路由本来就加载
 * pdf.js 与 jszip，所以为正确性付这个体积是划算的。它已经是本仓依赖
 * （`src/lib/name-search.ts` 用它做花名册搜索）。
 *
 * ⚠️ **键要缓存**：每次比较都算一遍拼音会把这个函数变成排序里的热点（O(n log n) 次调用）。
 * 一个曲子里的乐器名只有几个，Map 足够。
 */
const keyCache = new Map<string, string>();

function pinyinKey(s: string): string {
  let key = keyCache.get(s);
  if (key === undefined) {
    key = pinyin(s, { toneType: "none", type: "array" }).join("").toLowerCase();
    keyCache.set(s, key);
  }
  return key;
}

/**
 * 文件 → 排序用的「第一个分声部号」。没有号（`[]`、或本迁移之前历史行的 NULL）返回 0，
 * 于是**排在所有有号的前面** —— 合法的分声部号恒 ≥ 1，所以 0 是个安全的哨兵，
 * 不需要再分一层「空数组 vs NULL」。
 */
function firstSubPart(f: SortableFile): number {
  const first = f.sub_parts?.[0];
  return typeof first === "number" ? first : 0;
}

/** 文件比较：先按乐器名拼音，再按第一个分声部号，最后保持原顺序（稳定排序）。 */
export function compareFiles(a: SortableFile, b: SortableFile): number {
  const ka = pinyinKey(a.instrument ?? "");
  const kb = pinyinKey(b.instrument ?? "");
  // 用 `<` / `>` 而不是 `localeCompare`：键已经是纯小写拉丁串，码点序就是拼音序。
  // （换成 ICU 比较会**把 Latin 开头的名字排到最后**，正是要修的那个 bug。）
  if (ka !== kb) return ka < kb ? -1 : 1;
  return firstSubPart(a) - firstSubPart(b);
}

/**
 * 排好一个曲子的全部声部与文件。**不修改入参**（返回新数组，文件也是新数组）——
 * 调用方是 React 的 state，原地排序会让「值没变」的引用比较失效。
 */
export function sortPartsForDisplay<T extends SortablePart>(parts: T[]): T[] {
  return [...parts]
    .sort((a, b) => sectionSortKey(a.section) - sectionSortKey(b.section))
    .map((part) => ({ ...part, files: [...part.files].sort(compareFiles) }));
}
