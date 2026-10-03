import { supabase } from "@/lib/supabase";
import { STORAGE_BUCKETS, sheetMusicPagePrefix } from "@/lib/storage";

/** Storage 单次调用的对象数上限：`list` 一页与 `remove` 一批都是 1000（官方文档） */
const STORAGE_PAGE_SIZE = 1000;

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
