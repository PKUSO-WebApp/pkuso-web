/**
 * Supabase Storage：bucket 名与「从 URL 反推对象路径」的唯一入口。
 *
 * ## 为什么要有这个文件
 *
 * 改成这个形态之前，bucket 名是**散在 7 处的字符串字面量**
 * （`"sheet-music"` ×4、`"community-images"` ×3），而「从公开 URL 里抠出对象路径」
 * 那段逻辑**只活在一个私有闭包里**（`usePosts` 的 `remove`）。
 *
 * 两件事都会**静默**出问题：
 *
 * - **bucket 改名 / 打错**：上传照常成功，删除却删不掉（路径抠不出来时旧代码只是
 *   跳过删除）。界面上是「删了，但存储里还留着」，而没有任何报错。
 * - **路径抠错**：对象名里可能有中文（URL 里是百分号编码），漏掉 `decodeURIComponent`
 *   就会拿一个编码后的键去删 —— 删不掉，同样无声。
 *
 * 所以这里的两个函数都**只在能确定时才返回路径，否则返回 `null`**，
 * 让调用方显式处理「抠不出来」这种情况，而不是把一个猜出来的键交给 storage。
 *
 * ⚠️ `CLAUDE.md` 的「前端设计原则」把它写成「统一用 `indexOf("bucket/")` +
 * `decodeURIComponent`，try/catch 兜底（参考 `usePosts.remove`）」—— 那段描述在本次
 * 改动前是**没有可 import 的落点**的（原文自己就指着别人的私有闭包）。现在落点在这里。
 */

/** 本仓用到的 storage bucket。加新 bucket 时改这里，别在调用处写字面量。 */
export const STORAGE_BUCKETS = {
  /** 谱务：分谱 PDF */
  sheetMusic: "sheet-music",
  /** 社区帖子配图 */
  communityImages: "community-images",
} as const;

export type StorageBucket = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

/**
 * 从公开 URL 里抠出 bucket 内的对象路径。
 *
 * 认的是 URL 里第一处 `<bucket>/`，其后的部分就是路径（可能带百分号编码）。
 * 认不出来就返回 `null` —— **不猜**：拿一个错的键去 `remove()` 会静默失败，
 * 而拿 `null` 回到调用处，至少日志里能看出「这条没删」。
 *
 * ⚠️ 只在**公开 URL**（`/storage/v1/object/public/<bucket>/…`）上验证过。
 * 签名 URL 的路径段结构不同，要用的话先补用例。
 *
 * @example
 * storagePathFromUrl(
 *   "https://x.supabase.co/storage/v1/object/public/community-images/u1/%E5%9B%BE.png",
 *   STORAGE_BUCKETS.communityImages,
 * ); // => "u1/图.png"
 */
export function storagePathFromUrl(
  url: string | null | undefined,
  bucket: StorageBucket,
): string | null {
  if (!url) return null;

  const marker = `${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;

  const encoded = url.slice(idx + marker.length);
  if (!encoded) return null;

  try {
    return decodeURIComponent(encoded);
  } catch {
    // 非法百分号编码（如 "%zz"）：退回原串，让调用方仍能删掉「键本来就长这样」的对象。
    // 这里**不**返回 null —— 那种 URL 在库里可能是历史脏数据，删掉比留着好。
    return encoded;
  }
}

/**
 * 谱务分谱在 bucket 内的存储键：`{scoreId}/{storageId}.pdf`。
 *
 * 这是**存储键的唯一定义**：上传（`upload-modal`）与下载/删除（详情页）都用它，
 * 别处要拼这个键也请 import，不要在本地再写一遍模板串。
 *
 * ⚠️ **不能用声部/乐器名做路径段** —— Supabase Storage 的键只允许
 * 字母数字与 `_ - . ' , ! * & $ @ = ; : + ? ( )` 和空白，**中日韩字符一律被
 * 拒为 `Invalid key`**（官方文档 *File names restrictions*）。中文名此前一直
 * 写在路径里，所以这个上传功能**从来没有成功过一次**（`sheet_music_files` 长期 0 行
 * 就是这个原因，不是「新功能还没用」）。
 *
 * 人类可读的名字改放 DB：`sheet_music_files.file_name` 与 `.instrument` 两列，
 * 下载时由客户端 `a.download = file_name` 还原文件名（`storage.download(path)`
 * 拿回 blob 后自己触发下载，**不走 `download` 选项**）。用行自己的 id 还顺带让
 * 「两个文件算出同一条路径互相覆盖」由**构造**消失（每个键唯一），不再需要批内查重。
 *
 * （这段说明原先挂在 `upload-modal.tsx` 的私有 `pathOf` 上 —— 键的定义搬到这里，
 * 说明也一起搬：`sub-parts.ts` / `unsafe-name.ts` 都指着它，而私有函数指不进来。）
 */
export function sheetMusicPath(scoreId: string, storageId: string): string {
  return `${scoreId}/${storageId}.pdf`;
}

/**
 * 页图对象的前缀，**由 PDF 的 storage_path 推导**：`…/x.pdf` → `…/x/`。
 *
 * 为什么以 PDF 路径为输入而不是 `(scoreId, storageId)`：三处调用方手里拿到的都是
 * storage_path（上传流程的 `paths[k]`、删除流程的行数据、小程序阅读器的 `storage_path`），
 * 让它们各自去拆 scoreId/storageId 会散出三套解析。一个规则、一个函数。
 *
 * 页图是「上传时预渲染的整页 JPEG」（最长边 2400 / q0.8），小程序阅读器直接显示它，
 * 不再在小程序里跑 pdf.js 的纯 JS 解码（一页 300dpi 扫描件约 6 秒）。
 * PDF 本身**始终保留**——打印/转发/管理端依赖它。
 */
export function sheetMusicPagePrefix(pdfStoragePath: string): string {
  return `${pdfStoragePath.replace(/\.pdf$/, "")}/`;
}

/** 第 n 页页图的对象键（n 从 1 起）。路径段全部 ASCII（CJK 会被 Storage 拒为 Invalid key）。 */
export function sheetMusicPagePath(pdfStoragePath: string, pageNo: number): string {
  return `${sheetMusicPagePrefix(pdfStoragePath)}p${pageNo}.jpg`;
}
