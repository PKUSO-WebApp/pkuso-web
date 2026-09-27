/**
 * 「按 section 找 / 建声部」的**唯一一份**实现。
 *
 * 两条路都要它，所以抽出来：
 *
 * - **上传**（`upload-modal.tsx` 的 `ensurePart`）：落库前把这一行要落的声部备好
 * - **库编辑**（`components/edit-file-modal.tsx`）：把一份谱从「圆号」挪到「小号」时，
 *   目标声部不存在就得先建出来
 *
 * 抽出来之前它是 `upload-modal.tsx` 里的一个闭包。**行为逐字未改**（仍是「先 SELECT 再
 * INSERT」），改的只是它现在住在哪、以及多了一个调用方 —— 但正因为多了一个调用方，
 * 「两份拷贝慢慢漂开」这条老路就被堵上了（本仓栽过「同一条判据有几份拷贝、只有一份有测试」的跟头）。
 *
 * ## 声部是**闭集**
 *
 * 分组靠 `section` 而不是乐器名 —— 木琴与马林巴都归打击乐、低音大管归大管。
 * 乐器名只进文件名与展示。闭集本身不在这里校验：调用方（上传侧的下拉、库编辑的弹窗）
 * 已经把它约束在 `INSTRUMENT_ORDER` + 「其他」+「总谱」上，而**消费侧**（详情页分组、
 * `sortPartsForDisplay`）对闭集外的值有兜底（排在最后 + `isKnownSection` 告警）。
 *
 * ## 同一首曲子下同 section **只可能有一行**
 *
 * 由 `sheet_music_parts_score_section_key`（`UNIQUE (sheet_music_id, section)`，
 * 迁移 `20260926120000`）保证 —— 所以：
 *
 * - `maybeSingle()` **不会**遇到「两行以上」（那种状态建不出来），不必为它写兜底；
 * - 「两份谱各自建一次声部」在**并发**下会撞**唯一冲突**：一个成功、另一个拿到 23505，
 *   而这里把它咽成 `null` → 调用方按失败报（文案是「…创建失败，请重试」，可重试且自愈：
 *   重试时那次 SELECT 就能查到对手刚建出来的那一行）。上传侧的同批并发另有
 *   `ensurePart` 的票据 Map 收口（见 `upload-modal.tsx`），跨批次才可能撞上。
 *
 * ⚠️ 早先这里的注释说「表上还没有唯一约束、重复会增殖」——**那是过期的**（约束在
 * `20260926120000` 就加上了）。`upload-modal.tsx` 里同一句话也一起订正过：按一个建不出来的
 * 前提去推理，会让下一个改动去修一个不存在的问题。
 */

import { supabase } from "@/lib/supabase";

/**
 * 这一首曲子里 `section` 那个声部的 id；没有就建一个。
 *
 * 建失败（网络/RLS）返回 `null`，**不抛**：两条调用方都在批量流程里，抛出会把
 * 「这一个声部没备好」升级成「整批失败」，而逐行语义正是上传侧刻意保留的
 * （见 `confirmUpload` 里 `ensurePart` 的说明）。
 *
 * ⚠️ 返回 `null` 时**调用方必须当失败处理**，不能当成「随便找了一个声部」——
 * 那会让文件落进别的声部，而界面上看不出。
 */
export async function getOrCreatePart(scoreId: string, section: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from("sheet_music_parts")
    .select("id")
    .eq("sheet_music_id", scoreId)
    .eq("section", section)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: newPart, error } = await supabase
    .from("sheet_music_parts")
    .insert({ sheet_music_id: scoreId, section })
    .select("id")
    .single();

  if (error) {
    console.error("Create part failed:", error);
    return null;
  }
  return newPart.id;
}
