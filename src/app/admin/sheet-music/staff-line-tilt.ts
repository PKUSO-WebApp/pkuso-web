/**
 * 谱线检测的**倾斜层**：「斜率跟随」的提案 → 复核。
 *
 * 判据本体（最长连续暗段、成组、间距带、裁切决策）全在 `staff-line.ts`，本模块只做
 * 一件事——把那份判据放到**按候选斜率剪切后的行**上再问一遍。拆成两个文件不是分层
 * 洁癖：判据那半边是「业已稳定的既有行为」，这半边是「对倾斜的搜索」，
 * 两者要能各自被单独读懂（`scripts/check-design-debt.mjs` 也要求单文件不过 400 行）。
 *
 * ## 为什么需要这一层
 *
 * 判据「行内最长连续暗段 ≥ 页宽 35%」隐含「谱线在**同一行**里连续」，零点几度的倾斜
 * 就把它打掉：平扫一根倾斜线，最长连续段只有约 `1/|slope|` px（`slope = 0.005` 时约
 * 200px，而阈值是页宽的 35%）⇒ 凑不满 `MIN_LINES` 条 ⇒ 整个第一谱表被跳过 ⇒ 答案
 * latch 到后面某一组 ⇒ 裁切条把第一谱表的音符全带进送检图。
 *
 * 实测复现样本：`example-data/艾格蒙特序曲/3份_长笛_1,_2.pdf` 第 2 页（按 app 渲染
 * 尺度，最长边 2400px）。逐页数值、复现步骤与重放脚本都在仓库外 `.render-harness/
 * tilt/`（`node verify-final.mjs` 对全语料跑新旧对照）—— 具体像素数会随渲染尺度与
 * 样本变，这里只留机理。
 *
 * 两条被实测淘汰的路（别再走回去）：
 *
 * - **自由暗路径**（「每列至多升/降 1px」的单调路径，或限制总降幅的版本）：离线语料
 *   上的检出数比现行判据差一个数量级以上。原因是路径能在**同一谱表内部**沿着符干
 *   跳线，长路径随处可得 ⇒ 相邻带被连成一片 ⇒ 间距判据失效。
 * - **先估全局倾斜角再校正**：复现页估出来是 0（这一页的倾斜是**局部的**，同一页
 *   其余部分是平的），校正后的答案与不校正相同。
 *
 * ## 为什么它不随扫描仪/出版社漂移
 *
 * 1. 判据本体没变——「最长连续段 ≥ 页宽 35%」是**比例**，成组、间距带、容差、
 *    `MIN_LINES`/`CONFIRM_MIN_LINES` 全部留在 `staff-line.ts` 里由同一个
 *    `findFirstStaffLine` 使用（本模块不另抄一份，抄了就会漂），分辨率与页尺寸约掉。
 * 2. 候选斜率只是**搜索空间**，不是判据：范围/密度挑得不合适时，后果是「退化成旧
 *    行为」（见下条），不会给出新的错误答案，所以它不构成一个会随语料漂移的阈值。
 * 3. 最终答案必须**同时**满足：(a) 由同一套成组机制确认（5 条等距线 + 下方还有一组），
 *    (b) 比旧判据的答案至少高一个 `GAP_MIN_PCT`（同一谱表内相邻线的最小间距）。
 *    第 (b) 条把「同一组线上的几像素差」全部折成零位移：旧判据本来就能找到第一组的
 *    页，返回值与旧实现**逐像素相同**；只有旧答案明显 latch 到后面某一组（或干脆没有
 *    答案）时，才会换成倾斜判据的解。
 * 4. 物理边界（写在这里，不假装覆盖）：倾斜大到「谱表内相邻两条线在一个页宽内互相
 *    错开 ≥ 内间距」时，任何只看行结构的判据都会失手（本模块不做全页去斜）。
 */

import {
  GAP_MIN_PCT,
  INK_THRESHOLD,
  findFirstStaffLine,
  rowLongestRun,
  type RowRun,
} from "./staff-line";

/**
 * 倾斜搜索只扫页面上这么一段（占页高比例）。
 * 答案超过 `MAX_CROP_PCT` 就不裁了，所以再往下的搜索没有意义；留出的一半余量给
 * 「第一组线以下还要有一组」的确认。
 */
const TILT_SCAN_PCT = 0.4;

/**
 * 粗扫的下采样块（像素）。粗扫只负责**挑斜率**，答案一律由全分辨率精扫给出，
 * 所以块内取「有墨即算」的最大池化即可：谱线被压成 1 个粗像素行也不会丢。
 */
const COARSE_POOL = 4;

/**
 * 候选斜率（水平方向每像素的垂直漂移）：0.00125 一格、±0.0125 封顶。
 *
 * - 范围 ±1.25%：来自离线语料上「逐档斜率打分、取 Σrun² 最大」的读数（估计器格子
 *   到 ±1.5%，被选中的最大档是 ±1.13% 那一格，艾格蒙特 A3 总谱若干页），取整到
 *   一档余量。**这是搜索范围不是判据**：超出的后果是退回旧行为（见文件头第 2 条），
 *   不会给出新的错误答案。另有一次行为上的复核（`.render-harness/tilt/slope-range.mjs`，
 *   换语料要重跑）：把范围放宽一倍（±2.5%）在语料 364 页上不改变任何一页的答案 ⇒
 *   当前瓶颈不在这里，所以没有理由把搜索空间铺得更宽。
 * - 密度 0.125%：相邻两档在页宽内的漂移差 ≈ 2px，与谱线线厚同量级 —— 再稀就会
 *   「两条候选都追不上同一根线」，再密只是白花时间。
 * - **不含 0**：`s = 0` 的候选必然复核失败（理由见 `findFirstStaffLineInImage`），
 *   留着只会白花一次复核。
 */
const TILT_SLOPES: readonly number[] = (() => {
  const slopes: number[] = [];
  for (let k = 1; k <= 10; k++) slopes.push(k * 0.00125, -k * 0.00125);
  return slopes;
})();

/**
 * 一页最多复核几个候选斜率。
 *
 * 这是**成本旋钮，不是判据**：这个数挑错了的后果是「少救回几页」（退回旧答案），
 * 不会给出新的错误答案。离线实测 6 与 4 的召回差别在个位数页，成本差别远小于同一
 * 链路上的一次页面渲染（脚本：`.render-harness/tilt/probes-cost.mjs`，换语料要重跑）。
 * 名额越少越依赖候选排序（证据强的先复核），而排序只是启发式 ⇒ 留出余量。
 */
const TILT_MAX_PROBES = 6;

/**
 * 先按 `INK_THRESHOLD` 扫出二值墨迹掩码，再按 `pool × pool` 最大池化出粗掩码：
 *
 * - `mask`：页面顶部 `rows` 行的墨迹掩码（1 字节/像素）——精扫要反复读它；
 * - `coarseMask`：`mask` 的 `pool × pool` 最大池化（块内有墨即算，尺寸按块缩小）——粗扫用。
 *
 * 两张掩码必须来自**同一份像素、同一个阈值**（`INK_THRESHOLD` 与 `rowLongestRun` 同源），
 * 否则粗扫与精扫说的不是一件事；**粗 = 细的最大池化**这条关系由单测逐字节钉住。
 *
 * 写成两遍（先掩码、再池化）而不是「合成一遍」：合成版省掉的只是掩码的第二遍读取，
 * 而**实测它反而更慢** —— 顺序交替、7 轮取中位的计时里「合成/两遍」的逐页比值中位
 * 1.08×（p10 1.05×、p90 1.12×；脚本 `.render-harness/tilt/probes-cost.mjs` ②，
 * 换机器/语料要重跑）。两遍也更贴近单测与离线重放里的独立参考实现，便于逐字节对照。
 *
 * 导出是给单测与离线重放用的（后者要拿它建同一份掩码，而不是另抄一套阈值）——
 * 模块内没有别的调用方。
 */
export function buildTiltMasks(
  data: Uint8ClampedArray,
  width: number,
  rows: number,
  pool: number,
): { mask: Uint8Array; coarseMask: Uint8Array; coarseWidth: number; coarseHeight: number } {
  const mask = new Uint8Array(width * rows);
  for (let y = 0; y < rows; y++) {
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      mask[y * width + x] =
        data[i] < INK_THRESHOLD || data[i + 1] < INK_THRESHOLD || data[i + 2] < INK_THRESHOLD
          ? 1
          : 0;
    }
  }

  const coarseWidth = Math.ceil(width / pool);
  const coarseHeight = Math.ceil(rows / pool);
  const coarseMask = new Uint8Array(coarseWidth * coarseHeight);
  for (let cy = 0; cy < coarseHeight; cy++) {
    const yEnd = Math.min((cy + 1) * pool, rows);
    for (let cx = 0; cx < coarseWidth; cx++) {
      const xEnd = Math.min((cx + 1) * pool, width);
      let hit = 0;
      for (let y = cy * pool; y < yEnd && hit === 0; y++) {
        const base = y * width;
        for (let x = cx * pool; x < xEnd; x++) {
          if (mask[base + x]) {
            hit = 1;
            break;
          }
        }
      }
      coarseMask[cy * coarseWidth + cx] = hit;
    }
  }
  return { mask, coarseMask, coarseWidth, coarseHeight };
}

/**
 * 「斜率跟随」版的行特征：第 y 行量的是**剪切行** `yy = y + round(slope·(x - x0))`
 * 上的最长连续暗段。
 *
 * 锚点 x0 取页边**较高那一角**（slope > 0 取左沿、slope < 0 取右沿），于是倾斜线的
 * 最高那一行正好被记账 —— 答案落在线的**上沿**（精度受候选斜率格子限制：胜出的那一格
 * 与真倾斜差一格时，报出来的上沿最多差 1~2px，与线厚同量级，不会深到下一根线）。
 *
 * `slope = 0` 时剪切行就是原行，与 `rowLongestRun` 逐像素同值（有单测钉住）。
 *
 * 实现按「dy 恒定的列段」走：dy 随列单调，取值相同的连续列并成一段，段内指针自增
 * （没有逐像素乘法与边界检查）—— 段数是 `2·|slope|·width` 的量级（1.25% 斜率、1700px
 * 宽时不到 50 段），所以比逐像素版明显快。与逐像素 `Math.round` 版**逐元素同值**：
 * 单测在合成掩码上钉住，离线重放又在真实页掩码上比过一遍。倾斜复核一页要在全分辨率
 * 掩码上扫很多遍，这一步是主要成本。
 */
export function shearedRowRun(
  mask: Uint8Array,
  width: number,
  height: number,
  slope: number,
): RowRun {
  const runs = new Int32Array(height);
  if (width <= 0 || height <= 0) return runs;
  const x0 = slope > 0 ? 0 : width;

  // 列段：dy 相同的连续列区间。段数 ≤ 2·|slope|·width + 1（斜率 1.25%、宽 1700 时 ≈ 43 段）
  const segStart: number[] = [];
  const segEnd: number[] = [];
  const segDy: number[] = [];
  let prevDy = Math.round(slope * (0 - x0));
  let start = 0;
  for (let x = 1; x < width; x++) {
    const dy = Math.round(slope * (x - x0));
    if (dy !== prevDy) {
      segStart.push(start);
      segEnd.push(x);
      segDy.push(prevDy);
      start = x;
      prevDy = dy;
    }
  }
  segStart.push(start);
  segEnd.push(width);
  segDy.push(prevDy);

  for (let y = 0; y < height; y++) {
    let best = 0;
    let current = 0;
    for (let s = 0; s < segStart.length; s++) {
      const yy = y + segDy[s];
      // 段内 dy 相同 ⇒ 段首越界则整段越界，与「逐像素判越界」同值（越界即断开）
      if (yy < 0 || yy >= height) {
        current = 0;
        continue;
      }
      let p = yy * width + segStart[s];
      for (let x = segStart[s]; x < segEnd[s]; x++, p++) {
        if (mask[p]) {
          current++;
          if (current > best) best = current;
        } else {
          current = 0;
        }
      }
    }
    runs[y] = best;
  }
  return runs;
}

/**
 * 生产入口：在整页像素上找第一条谱线的 y（像素）。找不到返回 null。
 *
 * 两段：
 * 1. 旧判据（逐行最长连续暗段）先给一个答案 `yFlat`，行为逐像素不变；
 * 2. 「斜率跟随」**提案 → 复核**：粗扫（1/`COARSE_POOL` 下采样）在 `TILT_SLOPES` 每个
 *    候选斜率上各问一次「第一条合格谱表在哪」，按答案行的连续段有多长从强到弱排序，
 *    逐个在全分辨率上复核，在复核名额内取**最浅**的被确认答案。
 *
 * 为什么 `s = 0` 不参与提案：`s = 0` 的剪切行就是原行，喂给 `findFirstStaffLine` 的
 * 是同一份像素、同一段行、同一个页高 ⇒ 它的答案**只能是** `yFlat` 本身（或 `null`），
 * 永远过不了「比 `yFlat` 高一个 `GAP_MIN_PCT`」那条线。留着只会白花一次复核。
 *
 * 合并规则见文件头第 3 条：倾斜判据的答案必须比旧答案**至少高一个 `GAP_MIN_PCT`**
 * （同一谱表内相邻线的最小间距，两条答案靠得比它还近就只能是同一根线）才会被采纳，
 * 否则一律返回旧答案。于是：
 *
 * - 旧判据本来就能找到第一组的页 ⇒ 返回旧答案，零位移；
 * - 旧答案 latch 到后面某一组、或旧判据没有答案 ⇒ 用倾斜判据的解（旧答案缺位时直接采纳）。
 *
 * 代价构成：一次旧判据的全页扫描（`rowLongestRun` + `findFirstStaffLine`），加每个
 * 候选一次粗扫，被复核的候选（最多 `TILT_MAX_PROBES` 个）再各一次搜索窗内的剪切行
 * 全分辨率扫描。量级上仍远小于同链路上的页面渲染（渲染是秒级）。
 */
export function findFirstStaffLineInImage(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): number | null {
  // 只收整数尺寸（生产调用方传的就是 canvas.width/height 这样的整数）：非整数会一路
  // 走完流程、给出一个看似正常的答案（`new Int32Array(1000.5)` 静默截断成 1000），
  // 与契约「非法入参 → null」不符。`Number.isInteger` 同时挡掉 NaN 与 ±Infinity。
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return null;
  }
  // 缓冲必须真的容得下 width×height 个 RGBA 像素，少了就是非法入参（契约：非法 → null）。
  // 少了也能「跑出个答案」：读越界元素得 undefined，按「无墨」处理，于是短缓冲悄悄变成
  // 一张部分空白的页；更糟的是尺寸没有上界，一次尺寸写错（如把 height 写成宽度的量级）
  // 就会让下面的扫描跑上几十亿次而不返回 —— 6 字节缓冲 + 40000×40000 实测 5s 未返回。
  if (data.length < width * height * 4) return null;
  const yFlat = findFirstStaffLine(rowLongestRun(data, width, height), width, height);

  // 页面太小时倾斜搜索没有意义（掩码/池化都退化了），直接返回旧答案
  const rows = Math.round(height * TILT_SCAN_PCT);
  if (width < COARSE_POOL * 2 || rows < COARSE_POOL * 2) return yFlat;

  const { mask, coarseMask, coarseWidth, coarseHeight } = buildTiltMasks(
    data,
    width,
    rows,
    COARSE_POOL,
  );

  // 粗扫提案：池化画像就是「1/COARSE_POOL 缩放的页面」，所以把**页高除以池化块**喂给
  // 同一套成组机制 —— 这样间距带在两个尺度上说的是同一件事（0.3%~1.5% 页高）。传池化
  // 行数（= 页高/池化块 × TILT_SCAN_PCT）会让间距带窄 4 倍，实测会把真谱表也筛掉。
  const candidates: Array<{ slope: number; y: number; run: number }> = [];
  for (const slope of TILT_SLOPES) {
    const profile = shearedRowRun(coarseMask, coarseWidth, coarseHeight, slope);
    const y = findFirstStaffLine(profile, coarseWidth, height / COARSE_POOL);
    if (y !== null) candidates.push({ slope, y, run: profile[y] });
  }
  // 证据强的先复核：答案行的连续段越长越像真的谱线（文字行/装饰线凑不出长段）。
  // 排序只是复核顺序（成本）：答案是名额内的最小值，与顺序无关。
  candidates.sort((a, b) => b.run - a.run || a.y - b.y || Math.abs(a.slope) - Math.abs(b.slope));

  const gapMin = height * GAP_MIN_PCT;

  let best = yFlat;
  let probes = 0;
  for (const candidate of candidates) {
    if (probes >= TILT_MAX_PROBES) break;
    // 剪枝：按**粗答案**估计这个候选还能不能给出比当前答案更浅的解 —— 不值得就别占复核
    // 名额（下面 `probes++` 只在真复核时发生）。
    //
    // 这是一个**启发式，不是界**：粗域是池化过的（块内有墨即算 + 两个尺度各自取整），
    // 它既可能把精域里凑不成组的线认成谱表（于是粗答案比精扫答案深得多），也可能让
    // 同一根线落在相邻的粗行上（差 1px）。全语料实测（页 × 斜率里两侧都非 null 的
    // 1786 组）：精扫答案**比「粗答案 × 池化块」更浅**的有 359 组，多半只差 1px，
    // 最深的一组差 466px。所以「被跳过 ⇒ 不可能更浅」这条推理不成立。
    //
    // 它换来的是名额：实测把这一行去掉（其余逐字节相同，只有这一个补丁）跑全语料，
    // 5 页的答案变深 4~127px、无一页变浅，累计耗时约 1.3×（比值随机器变，只记量级）
    // —— 名额被「粗答案不足以更浅」的候选吃掉之后，真正能给更浅解的候选反而排不进来。
    // 换语料这条要重新量。
    const limit = best === null ? rows : best - gapMin;
    if (candidate.y * COARSE_POOL >= limit) continue;

    probes++;
    // 复核扫**整个搜索窗**，不按「候选下沿 + 若干线距」截断：`hasGroupBelow` 接受的是
    // **任意**更靠下的一组线，真实页里那往往是下一个谱表（隔十几个线距），按「确认组
    // 紧跟第一组」估窗口会把确认组截掉 ⇒ 精扫 null ⇒ 该救回的页原地不动（实测两页
    // 分谱：舒五 9份_二提 p8、舒八 长笛1 p2）。代价是窗口下半段的扫描量。
    //
    // 两种窗口不保证同解，别把「窗口只是漏看了下面几行」当成「结论不会变」：截断窗
    // 会在切口处截断剪切行的连续段、并让贴着切口的末条线心偏低，等于在窗口底部凭空
    // 改写证据。实测同一候选：截断窗 null、全窗 678（11份_一提 p10）。
    const answer = findFirstStaffLine(
      shearedRowRun(mask, width, rows, candidate.slope),
      width,
      height,
    );
    if (answer === null) continue;
    // **不**在首个采纳处收手：候选排序按的是「证据强度」，与答案深浅无关，而同一页
    // 上下段各有局部倾斜时，最强的候选往往是在**更靠下**的一组线上被确认的 —— 粗扫
    // 的池化把上段的局部畸变吸收掉，于是粗提案指向首组，精扫在同一斜率下却凑不出
    // 首组。首个采纳即停会让这个「先被确认的深答案」压住稍后才被确认的浅答案：实测
    // 11份_一提 p10 停 ⇒ 678（送检图混进两个谱表），继续探 ⇒ 275（首谱表上沿）。
    // 名额之内取**最浅**的被确认答案；更深的候选随后由上面的 `limit` 剪枝跳过。
    if (best === null || answer <= best - gapMin) best = answer;
  }
  return best;
}
