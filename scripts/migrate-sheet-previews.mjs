#!/usr/bin/env node
/**
 * 一次性迁移：给**已有**的谱务 PDF 生成页图（小程序阅读器的图片模式依赖它）。
 *
 * 为什么需要：新上传的文件由 web 端在上传流程里自动生成页图（#378/#379），
 * 但改动**之前**就存在的那批文件 `page_count` 是 NULL —— 阅读器会走 pdf.js 回退
 * （每页约 6 秒）。本脚本补上页图，让它们也走图片模式。
 *
 * 用法（在仓库根、且 `.env.local` 存在时运行）：
 *   node scripts/migrate-sheet-previews.mjs --dry-run            只列出会处理什么
 *   node scripts/migrate-sheet-previews.mjs --only=<id 或路径片段> 只处理匹配的行（试跑）
 *   node scripts/migrate-sheet-previews.mjs                     全部（幂等，可重跑）
 *   node scripts/migrate-sheet-previews.mjs --force             忽略「已完成」跳过，重渲染覆盖
 *   node scripts/migrate-sheet-previews.mjs --verbose           打开 pdf.js 详细日志（诊断用）
 *   node scripts/migrate-sheet-previews.mjs --prod              改用 PROD 库（默认 DEV）
 *
 * 需要的 env（`.env.local`，均已存在）：`NEXT_PUBLIC_{DEV,PROD}_SUPABASE_URL` +
 * `NEXT_PUBLIC_{DEV,PROD}_SUPABASE_SERVICE_ROLE_KEY`。
 *
 * 幂等：锚点是「**已完成**」= `page_count` 已写 **且** 页图已存在；中断了重跑即可
 *（`upsert` 覆盖）。半套状态（页图传了一部分、`page_count` 没写）会被**重做**而不是跳过。
 *
 * ⚠️ **渲染规格必须与 web 端一致**（`src/app/admin/sheet-music/pdf-render.ts` 的
 * `OCR_MAX_SCALE` / `OCR_TARGET_LONGEST_SIDE` / `OCR_JPEG_QUALITY`）。那边是浏览器
 * 代码，Node 里跑不了，所以这里复制了一份值 —— 调参时两处同步改。
 * ⚠️ 其中 **JPEG 质量的量纲不同**：web 的 `toBlob(..., q)` 用 0–1，而这里
 * `toBuffer("image/jpeg", q)` 用百分制 ⇒ 必须写 80 而不是 0.8（写 0.8 会掉到最低档
 * 且不报错）。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

/** 与 `src/lib/storage.ts` 的 `STORAGE_BUCKETS.sheetMusic` 一致 */
const BUCKET = "sheet-music";
const MAX_SCALE = 3;
const TARGET_LONGEST_SIDE = 2400;
/** ⚠️ **百分制**（= web 端 `OCR_JPEG_QUALITY` 的 0.8 × 100）——量纲不同，别直接抄 0.8 */
const JPEG_QUALITY = 80;
/** pdf.js 的资源目录：**wasm 是 JBIG2/JPX 扫描件的必需品**（缺了会静默画空白） */
const PDFJS_DIR = path.join(process.cwd(), "node_modules/pdfjs-dist");
/**
 * 看门狗白名单：**只有这些硬信号**才判定「这一页坏了」。
 * 不能拿「任何 console 警告」一票否决 —— pdf.js 对可恢复的情况也会 warn
 * （字体类型识别不出、OCG 缺失等），那会把正常页误判成失败（#379 对抗指出）。
 *
 * ⚠️ `#instantiateWasm:` 的字面含义是「wasm 实例化失败、已退化到 JS 解码器」而不是
 * 「解码失败」。这里判它致命，是因为 **Node 里那条 JS 回退不可达**（回退用
 * `import(wasmUrl + filename)`，Windows 绝对路径会报 ERR_UNSUPPORTED_ESM_URL_SCHEME）——
 * 若将来把 wasmUrl 换成 file:// URL 让回退真能成功，这条要重新评估。
 */
const WATCHDOG_PATTERNS = ["Unable to decode image", "#instantiateWasm:"];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const useProd = args.includes("--prod");
/** 忽略「已完成」的跳过判断，重渲染覆盖（用于修复早先跑坏的页图） */
const force = args.includes("--force");
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? "";

/** 与 `src/lib/storage.ts` 的 `sheetMusicPagePath` 同规则（`{storage_path 去 .pdf}/p{n}.jpg`） */
const pagePath = (storagePath, n) => `${storagePath.replace(/\.pdf$/, "")}/p${n}.jpg`;

/**
 * pdf.js 的警告捕获（看门狗）。
 *
 * 为什么不用「渲染出来是白页 ⇒ 报错」：扫描件里的**空白页是合法的**（实测总谱第 2 页
 * 被 pdf.js 渲染为纯白、无任何警告——而它源文件的 JPEG 有 105KB，两个第三方解码器
 * 给出相反结果，本机无法裁决；**与 web 端行为对齐**才是对的：web 上传流程用的也是
 * 同一个 pdf.js）。
 *
 * 而真正的解码失败（JBIG2 缺 wasm 那类）pdf.js 会**明确警告**（`Warning: Unable to
 * decode image ...`）——捕获它才准确：实测 F调小号1/2 就是这样被抓到并修好的。
 */
const pdfWarnings = [];
const origConsoleWarn = console.warn;
const origConsoleLog = console.log;
console.warn = (...a) => {
  pdfWarnings.push(a.map(String).join(" "));
  origConsoleWarn(...a);
};
console.log = (...a) => {
  const s = a.map(String).join(" ");
  if (s.startsWith("Warning:")) pdfWarnings.push(s);
  origConsoleLog(...a);
};

/**
 * pdf.js 在 Node 里**必须**有 CanvasFactory：渲染某些图像（实测总谱第 2 页）时它要用
 * 临时画布做解码/缩放，缺了不报错、只画空白 —— 与 wasm 那条是同一族的静默陷阱。
 */
class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

function loadEnvLocal() {
  if (!existsSync(".env.local")) throw new Error("找不到 .env.local（请在仓库根目录运行）");
  const out = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnvLocal();
const url = useProd ? env.NEXT_PUBLIC_PROD_SUPABASE_URL : env.NEXT_PUBLIC_DEV_SUPABASE_URL;
const key = useProd
  ? env.NEXT_PUBLIC_PROD_SUPABASE_SERVICE_ROLE_KEY
  : env.NEXT_PUBLIC_DEV_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key)
  throw new Error(`.env.local 缺少 ${useProd ? "PROD" : "DEV"} 的 URL 或 SERVICE_ROLE_KEY`);
const supabase = createClient(url, key);

/** 该前缀下是否已有页图（幂等锚点的一半；另一半是主循环里的 `page_count` 判断） */
async function hasPreviews(storagePath) {
  const prefix = `${storagePath.replace(/\.pdf$/, "")}/`;
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1 });
  // ⚠️ 不接 error 会把「查不了」当成「没有」⇒ 白烧一轮全量重渲染（#379 对抗指出）
  if (error) throw new Error(`list 页图失败：${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** 渲染整份 PDF 的每一页并上传，返回页数（任何一页失败都抛出，不写 page_count） */
async function renderAndUpload(row) {
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(row.storage_path);
  if (error) throw new Error(`下载 PDF 失败：${error.message}`);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const task = pdfjs.getDocument({
    data: bytes,
    useSystemFonts: false,
    // `--verbose` 打开 pdf.js 的详细日志（诊断「某一页解不出来」时用）
    verbosity: args.includes("--verbose") ? 5 : 1,
    // ⚠️ wasm **必须开且指对目录**：JBIG2/JPX 扫描件靠它解码。缺了 pdf.js 不报错，
    // 只会「整页空白」——实测踩过（F调小号1/2 的页图一度是远小于正常值的白图）
    useWasm: true,
    wasmUrl: `${PDFJS_DIR}/wasm/`,
    standardFontDataUrl: `${PDFJS_DIR}/standard_fonts/`,
    iccUrl: `${PDFJS_DIR}/iccs/`,
    CanvasFactory: NodeCanvasFactory,
    // Node 里没有真实 OffscreenCanvas：强制走 CanvasFactory 路径（实测某些页在
    // offscreen 路径下会解出白位图且不报错）
    isOffscreenCanvasSupported: false,
  });
  let doc;
  try {
    // ⚠️ `await task.promise` 必须在 try **里面**：坏 PDF/加密/截断时它会抛，抛在外面
    // 就永远走不到 destroy（同款教训见 pdf-render.ts 的注释：实测坏 PDF 时 destroy 未执行）
    doc = await task.promise;
  } catch (err) {
    await task.destroy().catch(() => {});
    throw err;
  }
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const unscaled = page.getViewport({ scale: 1 });
      const longest = Math.max(unscaled.width, unscaled.height);
      const fit = longest > 0 ? TARGET_LONGEST_SIDE / longest : MAX_SCALE;
      const scale = Math.min(MAX_SCALE, fit);
      const viewport = page.getViewport({ scale });

      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      // 透明像素编码成 JPEG 会合成到黑底，先铺白（与 web 端同款）
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const warnBefore = pdfWarnings.length;
      await page.render({ canvasContext: ctx, viewport }).promise;
      // 看门狗：只认硬信号（见 WATCHDOG_PATTERNS）—— 宁可不写 page_count，
      // 也不能把白页图当成功（那会让阅读器进图片模式显示白屏且永不回退）
      const fatal = pdfWarnings
        .slice(warnBefore)
        .filter((w) => WATCHDOG_PATTERNS.some((p) => w.includes(p)));
      if (fatal.length > 0) {
        throw new Error(`第 ${n} 页解码失败：${fatal.join("；").slice(0, 300)}`);
      }
      page.cleanup();

      const jpeg = canvas.toBuffer("image/jpeg", JPEG_QUALITY);
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(pagePath(row.storage_path, n), jpeg, {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (upErr) throw new Error(`第 ${n} 页上传失败：${upErr.message}`);
      process.stdout.write(`\r    p${n}/${doc.numPages}   `);
    }
    return doc.numPages;
  } finally {
    await task.destroy().catch(() => {});
  }
}

const { data: rows, error } = await supabase
  .from("sheet_music_files")
  .select("id, storage_path, file_name, page_count")
  .order("created_at");
if (error) throw new Error(error.message);

const targets = rows.filter((r) => !only || r.id.startsWith(only) || r.storage_path.includes(only));
console.log(
  `库：${new URL(url).host}　待检查 ${targets.length} 份${only ? `（过滤：${only}）` : ""}`,
);

let done = 0;
let skipped = 0;
let failed = 0;
for (const row of targets) {
  const label = `${row.file_name ?? "?"}（${row.storage_path}）`;
  try {
    // ⚠️ 幂等锚点是「**已完成**」而不是「有页图」：半套状态（页图传了一部分、
    // page_count 没写 —— 看门狗拦下 / update 抖动 / Ctrl-C 都会造出它）若按「有页图」
    // 跳过，就永远拿不到 page_count ⇒ 阅读器永远走 pdf.js 慢路径，而汇总行只显示
    // 「跳过」，第二次运行里失败彻底不可见（#379 对抗实测的阻塞项）
    const alreadyDone = row.page_count != null && (await hasPreviews(row.storage_path));
    if (!force && alreadyDone) {
      console.log(`✓ 已完成，跳过：${label}`);
      skipped += 1;
      continue;
    }
    if (dryRun) {
      console.log(`→ 待处理：${label}`);
      continue;
    }
    console.log(`⏳ ${label}`);
    const pages = await renderAndUpload(row);
    // 0 行检测（本仓规矩）：渲染的几分钟里行可能已被删除 —— 那时 update 影响 0 行而
    // error 为 null，报「完成」会在桶里留下一组没有任何行引用的页图
    const { data: updated, error: upErr } = await supabase
      .from("sheet_music_files")
      .update({ page_count: pages })
      .eq("id", row.id)
      .select("id");
    if (upErr) throw new Error(`写 page_count 失败：${upErr.message}`);
    if (!updated || updated.length === 0) {
      throw new Error("写 page_count 影响 0 行（这一行可能已被删除）");
    }
    console.log(`\n✓ 完成：${label} —— ${pages} 页`);
    done += 1;
  } catch (e) {
    console.log(`\n✗ 失败：${label} —— ${e instanceof Error ? e.message : String(e)}`);
    failed += 1;
  }
}
console.log(
  `\n汇总：完成 ${done} / 跳过 ${skipped} / 失败 ${failed}${dryRun ? "（dry-run，未写任何数据）" : ""}`,
);
