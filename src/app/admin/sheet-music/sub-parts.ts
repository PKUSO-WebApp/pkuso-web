/**
 * 分声部号的规范形态与解析。
 *
 * 单独成模块的理由与 `staff-line.ts` 相同：这些是纯函数，而它们的正确性靠
 * **跨仓契约**与**用户手输**两侧夹着，必须能被测试直接 import。
 *
 * ## 契约（与 `pkuso-backend` 的 `parseSubParts` 是同一份）
 *
 * **唯一合法格式 = 英文逗号分隔的阿拉伯数字**，升序去重。它会同时落进两个地方：
 *
 * - `sheet_music_files.sub_parts`（`INTEGER[]`，排序/显示用）
 * - `sheet_music_files.file_name`（`圆号1,2,3,4.pdf`，用户下载时落到自己文件系统上）
 *   ⚠️ **历史行的 `file_name` 里是 `圆号_1,2,3,4.pdf`（带下划线）** —— 那是回填迁移
 *   （`20260924013000`）解析用的格式，它早已跑完；运行时代码**既不产生也不解析**它
 *   （号有自己的列 `sub_parts`，而那列自 `20260926130000` 起恒非 NULL）。
 *   库里因此两种写法并存：这只影响用户看到的历史文件名，不影响任何逻辑。
 *
 * ⚠️ 两边一旦不一致，会出现「文件名里是 `1,3` 而库里是 `[1,2,3]`」这种一眼看不出的错位 ——
 * 所以这里的解析规则是**照着后端抄的**，改一边就要想另一边。
 */

/**
 * 分声部号的**个数**上界。与后端那份保持一致 ——
 * `pkuso-backend/supabase/functions/llm-analyze/analyze.ts` 的 `MAX_SUB_PARTS`
 * （搜这个常量名就能定位，别写行号：行号会随改动漂走）。
 *
 * 那边防的是号进 `file_name` 把文件名撑爆，而界面正是生成这个名字的地方，
 * 所以这一层也得拦得住。
 *
 * ⚠️ **两份常量之间没有任何机制能发现漂移**，且两个方向不对称：
 * 后端调大 → 前端 `sanitizeSubParts` 会开始静默吞号（靠 `overSubPartsCap` 报警）；
 * 后端调小 → 前端仍允许用户手输到 32，只是契约文字失真。
 * 改任意一边时**两边一起看**。
 */
export const MAX_SUB_PARTS = 32;

/** 规范形态 → 展示/文件名用的字符串。`[1,2,3]` → `"1,2,3"`。 */
export function formatSubParts(subParts: number[]): string {
  return subParts.join(",");
}

/**
 * 文件名：`{乐器名}.pdf`，有号时 `{乐器名}{号,号,...}.pdf`。**声部不进文件名** —— 它存在
 * `sheet_music_parts.section` 列里（存储键见 `upload-modal.tsx` 的 `pathOf`）。
 *
 * 例：`木琴.pdf`、`圆号1.pdf`、`圆号1,2,3,4.pdf`、`小提琴1,2.pdf`。
 *
 * 一份文件覆盖多个分声部时把号**全列出来**（IMSLP 的 `Horn_1,_2,_3,_4.pdf` 就是这种），
 * 而不是只写第一个 —— 只写第一个正是本次要消灭的那类错（把「含 1、2、3、4」记成「只有 1」）。
 */
export function generateFileName(instrument: string, subParts: number[]): string {
  const base = instrument.trim();
  // ⚠️ 号与乐器名之间**不加下划线**（用户定的格式：`双簧管1,2.pdf`）。
  // 历史行里有 `圆号_1.pdf` 那种写法 —— 那是回填迁移（`20260924013000`）解析用的格式，
  // 它早已跑完；运行时代码**不解析文件名里的号**（号有自己的列 `sub_parts`），
  // 所以两种写法并存不影响任何逻辑，只是新文件统一成不带下划线的。
  if (subParts.length > 0) return `${base}${formatSubParts(subParts)}.pdf`;
  return `${base}.pdf`;
}

/**
 * 解析用户在「分声部」输入框里敲的东西。返回规范化后的数组 + 非法时的行内提示。
 *
 * 契约与后端一致，但**不做区间展开**：`1-4` 判非法并提示用户逐个写出。
 * 理由与后端同一条 —— 替用户猜语义就是猜（`1-4` 也可能被读成「第 1 和第 4」）。
 * 更要紧的是：一旦界面会展开，写法就有了两种，而其中一种只活在输入框里、
 * 落进文件名之后没人分得清当初是人展开的还是机器展开的。
 *
 * 接受全角逗号「，」与顿号「、」：中文输入法下太常见，且后端用的是同一套归一化。
 *
 * 返回 `invalid` 时 `value` 恒为 `[]` —— 调用方（`uploadBlocker`）会据此拦下上传，
 * 所以这个 `[]` 只是「占位，别用」，不是一个可以落库的值。
 */
export function parseSubPartsInput(raw: string): { value: number[]; invalid?: string } {
  const text = raw.trim();
  // 空 = 没有分声部（也是用户主动清空后的形态），合法
  if (text === "") return { value: [] };

  const tokens = text
    // NFKC 是后端归一化的**另一半**（`analyze.ts` 的 parseSubParts 同样先折它）。
    // 少了这一步，中文输入法**全角模式**下敲的 `２` 会被判非法 —— 而「中文输入法」
    // 正是这段归一化存在的理由，漏掉它等于把最常见的输入挡在门外。
    // 它折出来的范围比「全角」宽：`①`(U+2460)、`²`(U+00B2)、`𝟏`(U+1D7CF) 都会变成
    // 数字；`Ⅰ`(U+2160)→`I`、`⑵`→`(2)`、`½`→`1⁄2` 折完仍不是数字，照样弃权。
    .normalize("NFKC")
    .replace(/[，、]/g, ",")
    .split(",")
    .map((t) => t.trim())
    // 空片段只来自多打/少打逗号（`1,2,`），是格式噪声不是内容
    .filter((t) => t !== "");
  if (tokens.length === 0) return { value: [], invalid: "只接受逗号分隔的号，如 1,2,3" };

  const out = new Set<number>();
  for (const t of tokens) {
    if (!/^\d+$/.test(t)) {
      // 区间单独给一句 —— 它是这里最常见的非法输入。
      //
      // ⚠️ **不要把区间展开塞进提示里**（比如把 `-` 换成 `,`）：`1-4` 展开成
      // `1,4` 是个**不同**的集合，照着改的用户会得到一个错的号，而提示本身看着
      // 还挺贴心。展开语义正是上面拒绝的东西，不能在错误文案里偷偷做一遍。
      if (/^\d+-\d+$/.test(t)) {
        return { value: [], invalid: `不接受区间「${t}」，请逐个写出（如 1,2,3,4）` };
      }
      return { value: [], invalid: `「${t}」不是数字。只接受逗号分隔的号，如 1,2,3` };
    }
    const n = Number(t);
    if (!Number.isSafeInteger(n) || n < 1) {
      return { value: [], invalid: `「${t}」不是有效的分声部号` };
    }
    out.add(n);
  }
  const value = [...out].sort((a, b) => a - b);
  if (value.length > MAX_SUB_PARTS) {
    return { value: [], invalid: `分声部号最多 ${MAX_SUB_PARTS} 个` };
  }
  return { value };
}

/**
 * 把**后端响应里**的 `subParts` 收敛成契约形态（升序去重的正整数）。
 *
 * 即使后端已经校验过也要在这里再过一遍：`functions.invoke` 返回的 `data` 类型是 `any`，
 * 而这里的产物会**直接进文件名与数据库**。收敛成「不是合法数组就当空数组」，
 * 退化成「没有号」而不是「号是垃圾」。
 *
 * ⚠️ **理由要说准**（早先这里写的是「会拼出一个名字里带 `undefined` 的文件」，实测不成立）：
 * 字段名改了让 `data.subParts` 是 `undefined` 时，原样透传会**直接抛**
 * （`generateFileName` 读 `.length`），而不是拼出一个坏名字；真正危险的是
 * `["1","2"]` 这种**元素类型不对**的数组 —— 它会拼出 `圆号1,2.pdf`，一个**看着完全正常**
 * 的错名字，没有任何迹象。所以这里的收敛不是防崩，是防「看起来对的错值」。
 *
 * ⚠️ 与 `parseSubPartsInput` 分开是有意的：那个服务**用户手输**（要给出行内报错文案），
 * 这个服务**已校验过的响应**（只做安静的收敛）。合成一个函数就会被迫给响应也编一套
 * 用户看得见的错误话术，而那些话术对用户毫无意义（他改不了模型的输出）。
 */
export function sanitizeSubParts(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<number>();
  for (const x of v) {
    if (typeof x !== "number" || !Number.isSafeInteger(x) || x < 1) return [];
    out.add(x);
  }
  const value = [...out].sort((a, b) => a - b);
  return value.length > MAX_SUB_PARTS ? [] : value;
}

/**
 * 后端给的号是不是**超过了前端上界**（`sanitizeSubParts` 会因此把它们整个丢掉）。
 *
 * 这个函数存在的唯一理由是：**那条丢弃路径本身是静默的**。`subPartsRaw` 只在
 * 「后端解析失败」时出现，而「后端解析成功、只是给的个数比前端上界多」不会带任何信号 ——
 * 界面显示「已识别 → 圆号 / F调圆号」、号全空、上传照常放行，与本 issue 要消灭的
 * 静默丢号一模一样。
 *
 * 今天不可达（两个仓库的常量同为 32）。它防的是**常量漂移**：后端把上界调大之后，
 * 前端这一侧会开始静默吞号，而调用方据此给用户一句「上限不一致」的提示 ——
 * 提示的读者其实是维护者，因为用户解决不了它。
 */
export function overSubPartsCap(v: unknown): number | null {
  if (!Array.isArray(v) || v.length <= MAX_SUB_PARTS) return null;
  // ⚠️ 必须**先确认元素全都合法**再看个数：元素非法时 `sanitizeSubParts` 也会返回 `[]`，
  // 只看「sanitize 丢空了」会把「数组里混了字符串」也报成「超过上界」——
  // 那是一句风马牛不相及的提示，用户照着它改只会更糊涂。
  const allValid = v.every((x) => typeof x === "number" && Number.isSafeInteger(x) && x >= 1);
  return allValid ? v.length : null;
}

/**
 * 段级补号：某一段自己的文本里**没读出号**时，用**其它段**做减法补出来。
 *
 * 例：整份读出的号是 `[1,2]`，第 1 段的页眉读出 `[1]`、第 2 段的页眉上没印号
 * → 第 2 段补 `[2]`。
 *
 * ## 为什么需要它
 *
 * 切分时**不再按位置预填号**（「第 k 段 ↔ 第 k 个号」那种猜法碰到
 * `…--_Piccolo,_Flute_1,_2.pdf` 会把**每一段**都填成 `[1,2]` —— 长笛 1 那段与长笛 2
 * 那段于是撞成同一个文件名）。号一律由各段**自己的**首页文本识别得出 ——
 * 而总会有某一段的首页只有谱、没印页眉，那时它一个号都读不到。减法补的是这一种。
 *
 * ## 三条保守约束（一律「宁可不说，不要猜」）
 *
 * 1. **只在乐器与源行相同、且源行的号 ≥ 2 个时才补**。不同乐器时那份号对这一段
 *    根本不成立 —— 短笛段自己读出的是**空数组**，那是一个**完整**的答案，
 *    不是「没读出来」，补它就是把「本来就该没有号」的段补上一个号。
 *    乐器认不出来（空串）的段一律不补。
 * 2. **只有「漏号的段恰好一个」时才补**。两个以上漏号时谁该拿 `[2]` 谁该拿 `[3]`
 *    又要靠位置去猜 —— 那正是这次要拆掉的东西。
 * 3. **减完没有剩余就不补**（别的段已经把号全取走了）。
 *
 * @returns 与 `segments` 等长的数组，`null` = 这一段不动（调用方保留原值）
 */
export function fillMissingSubParts(input: {
  /** 源行（整份那份）识别出的乐器；空串 = 没认出来，那就谁都不补 */
  sourceInstrument: string;
  /** 源行（整份那份）识别出的号 */
  sourceSubParts: number[];
  /** 各段**自己**识别出的结果，顺序与段序一致 */
  segments: { instrument: string; subParts: number[] }[];
}): (number[] | null)[] {
  const untouched: (number[] | null)[] = input.segments.map(() => null);
  const src = input.sourceInstrument.trim();
  if (!src) return untouched;
  if (input.sourceSubParts.length < 2) return untouched;

  const taken = new Set<number>();
  const missing: number[] = [];
  input.segments.forEach((seg, i) => {
    if (seg.instrument.trim() !== src) return;
    if (seg.subParts.length > 0) for (const n of seg.subParts) taken.add(n);
    else missing.push(i);
  });
  if (missing.length !== 1) return untouched;

  const leftover = input.sourceSubParts.filter((n) => !taken.has(n));
  if (leftover.length === 0) return untouched;

  const out = [...untouched];
  out[missing[0]] = leftover;
  return out;
}
