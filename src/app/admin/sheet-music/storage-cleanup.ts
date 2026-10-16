import { supabase } from "@/lib/supabase";
import { STORAGE_BUCKETS, sheetMusicPagePrefix } from "@/lib/storage";
import type { Database } from "@/types/database";

/** 落库行的类型取生成类型（`part_id` 在库里可空，所以别自己写死成 `string`） */
type SheetMusicFileInsert = Database["public"]["Tables"]["sheet_music_files"]["Insert"];

/** Storage 单次调用的对象数上限：`list` 一页与 `remove` 一批都是 1000（官方文档） */
const STORAGE_PAGE_SIZE = 1000;

/**
 * 一次 `select` 里塞多少个值。`.in(...)` 的入参是进 URL 的，一批塞几百个会把请求行撑长
 * （文件名是中文时会被百分号编码成每个字三倍长），所以分块读。
 */
const QUERY_CHUNK = 50;

/**
 * 删除谱务文件对象，**连带删除它们的页图**。
 *
 * 页图（`…/x/p{n}.jpg`，上传时预渲染，键规则见 storage.ts 的 `sheetMusicPagePath`）是
 * PDF 的派生物——不跟着删就会在桶里留孤儿：界面上看不见、没有任何入口能删掉它们。
 *
 * 实现是「先 list、再合批 remove」：页图是某个前缀下的一串对象，而 Storage 的 remove
 * 只认精确键。list 对不存在的前缀返回空数组（不报错），所以从未生成过页图的老文件
 * 自然跳过、无需分支判断。
 *
 * ⚠️ **失败都不能吞**（本仓反复记载的「静默失败」）：`list` 失败 ⇒ 该前缀这一页的页图
 * 收不到（**第一页**失败就是该前缀的页图一个都不删）；`remove` 失败 ⇒ 那一批对象留在
 * 桶里。两种失败从界面上都看不出来（行已删、流程照常报成功），所以至少各留一条 warn。
 *
 * ⚠️ 调用方保证只在**库行删除成功之后**调这里（先删行、后删附件，Issue #368 的顺序）。
 * 失败语义沿用调用方原有约定：删附件是 best-effort 副作用，失败不影响删除结果。
 */
export async function removeSheetMusicObjects(pdfPaths: string[]): Promise<void> {
  if (pdfPaths.length === 0) return;
  const all = [...pdfPaths];
  for (const pdfPath of pdfPaths) {
    const prefix = sheetMusicPagePrefix(pdfPath);
    // 翻页取全：`list` 单次上限有限，超过它的文件尾部页图会被漏掉（且再无入口可删）
    for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKETS.sheetMusic)
        .list(prefix, { limit: STORAGE_PAGE_SIZE, offset });
      if (error) {
        console.warn(`[sheet-music] 列出页图失败（这些页图不会被删）：${prefix}`, error.message);
        break;
      }
      const batch = data ?? [];
      for (const obj of batch) all.push(`${prefix}${obj.name}`);
      if (batch.length < STORAGE_PAGE_SIZE) break;
    }
  }
  // ⚠️ `remove` **单次上限 1000 个对象**（官方文档明确）：整批塞进去会被**整批拒绝**
  // ——连 PDF 本体都删不掉。按 1000 分块；每块失败只 warn（不抛，best-effort 语义不变）
  for (let i = 0; i < all.length; i += STORAGE_PAGE_SIZE) {
    const chunk = all.slice(i, i + STORAGE_PAGE_SIZE);
    const { error } = await supabase.storage.from(STORAGE_BUCKETS.sheetMusic).remove(chunk);
    if (error) {
      console.warn(
        `[sheet-music] 删除存储对象失败（这批 ${chunk.length} 个可能成为孤儿对象）`,
        error.message,
      );
    }
  }
}

/**
 * upsert **之前**调：这些 `(part_id, file_name)` 眼下指向、而这次不再写的那些对象路径。
 *
 * 上传时那次 `upsert(rows, { onConflict: "part_id,file_name" })` 对**同一个声部下的同名文件**
 * 不是插入而是**更新** —— 那行的 `storage_path` 会被改成这次的新对象。于是旧对象
 * （PDF + 它的页图）**再没有任何行引用**：详情页的删除路径是按行枚举对象的，
 * 它既不会被删、界面上也没有入口（#387 里 dev 桶里那份 1 PDF + 10 张页图就是这么留下的）。
 *
 * 调用顺序是**硬约束**：必须在 upsert **之前**读，否则读回来的是新路径，等于什么都没发现
 * （返回值恒为空）。参数 `rows` 就是即将 upsert 的那批（取其中的 part_id / file_name 组合），
 * `keepPaths` 是这次要写的新路径 —— 相等说明是「同一个 `storageId` 的重试」，
 * 对象没被替换，不能删（契约第 6 条）。
 *
 * ⚠️ 上传路径上**别直接调它**：顺序（读→写→删）由 `storeSheetMusicFiles` 一次性保证。
 * ⚠️ 读失败只 warn 并返回空数组：**少删一次**远好过让上传失败。真正的删除在
 * `dropUnreferencedStorageObjects` 里还有一道「库里是否还有行指向它」的检查。
 */
export async function replacedStoragePaths(
  rows: Array<{ part_id?: string | null; file_name: string }>,
  keepPaths: ReadonlySet<string>,
): Promise<string[]> {
  if (rows.length === 0) return [];
  // `part_id` 为 NULL 的行跳过：唯一索引里 NULL 互不相等，`onConflict` 匹配不到它
  // （upsert 会新插一行、旧行原地不动），所以它不可能「被替换」。
  const partIds = [
    ...new Set(rows.map((r) => r.part_id).filter((id): id is string => Boolean(id))),
  ];
  if (partIds.length === 0) return [];
  // 只按 part_id 读、在内存里挑出**精确配对**：`.in(part_id).in(file_name)` 是笛卡尔积
  // （会把「别的声部下的同名文件」也捞进来），而文件名里的中文进 URL 更占地方。
  const wanted = new Set(rows.map((r) => pairKey(r)));
  const replaced: string[] = [];

  for (let i = 0; i < partIds.length; i += QUERY_CHUNK) {
    const { data, error } = await supabase
      .from("sheet_music_files")
      .select("part_id, file_name, storage_path")
      .in("part_id", partIds.slice(i, i + QUERY_CHUNK));
    if (error) {
      console.warn(
        "[sheet-music] 查同名旧行失败（被这次上传替换掉的旧对象这次不会被删）",
        error.message,
      );
      return [];
    }
    for (const row of data ?? []) {
      // NULL / 空 `part_id` 的行不参与配对 —— 与上面 partIds 的过滤同一条件
      if (!row.part_id) continue;
      if (!wanted.has(pairKey(row))) continue;
      if (keepPaths.has(row.storage_path)) continue;
      replaced.push(row.storage_path);
    }
  }
  return replaced;
}

/**
 * upsert **成功之后**调：把「库里已经没有任何行指向」的那些路径连同页图删掉。
 *
 * ⚠️ 判据是**库里现在的引用**，不是调用方手里的名单：`replacedStoragePaths` 读到的旧路径
 * 有可能仍被别的行用着（历史数据、并发落库），照名单删就会删掉别人正在用的对象 ——
 * 那比留一个孤儿糟得多（孤儿只是占空间，误删是**下载 404**，界面上看不出来）。
 * 所以查引用失败时一个都不删，只 warn。
 *
 * ⚠️ 顺序：只能在 upsert **成功之后**调。落库失败时旧行可能还指向这条路径 ——
 * 虽然上面那道查引用检查能兜住，但错误路径上不做删除动作更干净（契约第 3 条）。
 */
export async function dropUnreferencedStorageObjects(candidates: string[]): Promise<void> {
  const unique = [...new Set(candidates)];
  if (unique.length === 0) return;

  const referenced = new Set<string>();
  for (let i = 0; i < unique.length; i += QUERY_CHUNK) {
    const { data, error } = await supabase
      .from("sheet_music_files")
      .select("storage_path")
      .in("storage_path", unique.slice(i, i + QUERY_CHUNK));
    if (error) {
      console.warn("[sheet-music] 查被替换对象的引用失败，这批对象这次不删", error.message);
      return;
    }
    for (const row of data ?? []) referenced.add(row.storage_path);
  }

  const orphans = unique.filter((p) => !referenced.has(p));
  if (orphans.length > 0) await removeSheetMusicObjects(orphans);
}

/**
 * 落库队列 —— 同一批里两行算到**同一个** `(part_id, file_name)` 时（跨行重名：组内重名有拦截，
 * 跨行的没有），两次落库会交错成：两边都先读到「还没有行」→ 各自 upsert → 各自复查引用。
 * 后写的那次把行改指到自己，先写那份对象被挤掉，而**两次复查都发生在对方写之前** ⇒ 谁也不认领它。
 * 串行之后，第二次读必然看得见第一次写，它就成了「被替换掉的旧对象」被正常收掉。
 *
 * ⚠️ 只挡得住**同一个页面内**的并发（`PIPELINE_CONCURRENCY` 让多个单元同时在飞）。
 * 跨标签页 / 跨用户同时传同一个文件名仍会漏 —— 那要库侧的对账或 GC，客户端做不到。
 */
let storeQueue: Promise<unknown> = Promise.resolve();

/**
 * 这一次落库最长占住队头多久。**没有它就是队头阻塞**：supabase-js 的请求没有超时
 * （浏览器 `fetch` 默认也没有），对端静默不回包时这次落库**永不 settle**，而 `storeQueue`
 * 是**模块级**的 ⇒ 之后所有落库连请求都发不出去，行永远停在「上传中」，关掉弹窗重开、
 * 换一首曲子重传都照旧（同一 tab 内模块单例），只有刷页能清。
 *
 * 超时后队列照常往下走，这一次退化成「不串行」的旧行为 —— 一次落库慢/卡住，
 * 总比连坐后面所有上传好。60s 够覆盖慢活（删一批页图要 list 翻页 + remove 分块）。
 */
export const STORE_QUEUE_TIMEOUT_MS = 60_000;

/**
 * 上传落库这一步：写 `sheet_music_files` 的行，并把这次**换下来的旧对象**删掉。
 *
 * 为什么收成一个函数：**「读旧路径 → upsert → 删旧对象」三步的顺序是硬约束**，
 * 摊在调用点上谁挪一行都看不出来 ——
 * · 读必须在 upsert **之前**（写完再读回来的是新路径，等于什么都没发现）；
 * · 删必须在写**成功之后**（失败时旧行可能还指着它）。
 *
 * `upsert` + `onConflict` 是因为唯一约束 `(part_id, file_name)` 把「重试」变成「更新原来
 * 那几行」（幂等）；⚠️ 它要求那条唯一索引**已经存在**，否则 PG 报 42P10（pkuso-backend#29）。
 *
 * 返回 `{ error }` 而不是抛：文案由调用方翻译（见 `describeInsertError`）。
 * 落库失败时**不删任何对象**，并把错误原样交给调用方。
 *
 * 这个壳只负责排队（三步本体在 `commitSheetMusicFiles` 里，超时见 `STORE_QUEUE_TIMEOUT_MS`）。
 */
export function storeSheetMusicFiles(
  rows: SheetMusicFileInsert[],
  newPaths: readonly string[],
): Promise<{ error: { code?: string; message: string } | null }> {
  const run = storeQueue.then(() => commitSheetMusicFiles(rows, newPaths));
  // 排队的是「上一次落库结束」，失败不能毒化队列 —— 吞掉结果、只留时序
  const done = run.then(
    () => undefined,
    () => undefined,
  );
  // 但**不能等它到永远**：一次永不 settle 的落库占着队头会把后面全部堵死
  storeQueue = Promise.race([
    done,
    new Promise<void>((resolve) => setTimeout(resolve, STORE_QUEUE_TIMEOUT_MS)),
  ]);
  return run;
}

async function commitSheetMusicFiles(
  rows: SheetMusicFileInsert[],
  newPaths: readonly string[],
): Promise<{ error: { code?: string; message: string } | null }> {
  const replaced = await replacedStoragePaths(rows, new Set(newPaths));
  const { error } = await supabase
    .from("sheet_music_files")
    .upsert(rows, { onConflict: "part_id,file_name" });
  if (error) return { error };
  await dropUnreferencedStorageObjects(replaced);
  return { error: null };
}

/** `(part_id, file_name)` 的配对键 —— 唯一约束就是这两列，别用别的方式拼（会撞） */
function pairKey(row: { part_id?: string | null; file_name: string }): string {
  return `${row.part_id ?? ""}\n${row.file_name}`;
}
