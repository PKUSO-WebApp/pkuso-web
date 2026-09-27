/**
 * 库编辑的**写库序列**（判据在 `library-edit.ts`，这里只管顺序与失败处理）。
 *
 * 单独成模块而不是塞进弹窗组件里，是为了让「先备声部、再写文件行」这个顺序能被**直接测**——
 * 本仓对「异步序列里的顺序」栽过跟头（`uploadOne` 里那段「先建齐声部再插文件行」的注释
 * 记着一次）。
 *
 * ## 只有一条写库路径，失败语义也只有一条
 *
 * 主更新失败（含 0 行）→ 整次保存**失败**，弹窗留在原地给用户看那句话。用户看到的是他
 * 自己刚敲的值，可以改了再存 —— 不许把「没改成功」显示成「改好了」。
 *
 * ## ⚠️ 挪空的源声部**刻意不删**（这是一个被对抗测试推翻过一次的决定）
 *
 * 早先这里在挪动成功后会「问一次库，空了就把源声部删掉」。它被推翻了，因为那是**两次往返**：
 * `SELECT … WHERE part_id = 源 AND LIMIT 1` 与 `DELETE FROM parts WHERE id = 源` 之间
 * 有一个 RTT 的空档，而 `sheet_music_files.part_id` 的外键是 **ON DELETE CASCADE** ——
 * 另一个管理员的上传若正好在这个空档里 INSERT 完（他的 `ensurePart` 早已把源声部解析成
 * 那一行），他的文件行会被这次 DELETE 连带删掉：上传方看到「已上传」、详情页里却什么都没有，
 * 桶里留一个没人指向的孤儿对象。
 *
 * 概率低（要两个人同时动同一首曲子），但**后果不可逆**；而残留那一侧的代价是可逆的、
 * 而且看得见：详情页多出一个「0 个文件」的声部，旁边就是既有的「删除声部」按钮。
 * 两个方向代价不对称时往保守那边倒 —— 所以这里**不删**，并在界面上如实告知（见
 * `components/edit-file-modal.tsx` 里那句话）。
 *
 * 要真正收掉空声部得让它变成一次请求（带 `NOT EXISTS` 的 RPC）——那要动 schema / Edge Function，
 * 属 `pkuso-backend`，不在本次范围。
 */

import { describeInsertError } from "./row-text";
import { getOrCreatePart } from "./parts-store";
import { supabase } from "@/lib/supabase";
import type { FileEditPlan } from "./library-edit";

export type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * 把一份谱改成 `plan` 的样子；声部变了就**连同 `part_id` 一起挪过去**。
 *
 * ⚠️ **四列要么一起改、要么一列都不改**：`part_id` / `instrument` / `sub_parts` / `file_name`
 * 是同一次 UPDATE 的四个字段。分开两次写（比如先改名字、再挪声部）会在中间留一个
 * **两个声部下都不对的窗口**，而那时候另一处查询（详情页刷新、将来的小程序）看到的是
 * 「小号声部里有一份叫 F调圆号1.pdf 的谱」—— 名字与分组互相矛盾，且没人知道该信哪个。
 *
 * ⚠️ **挪动时用的是 `plan.section` 与 `currentSection` 的字符串比较**，不是 part id：
 * 用户没动声部那一格时（改的只是乐器名）不该去查一次库 —— 一次没必要的往返不但白花，
 * 还会让「同一首曲子下同 section 只有一行」这条由 `sheet_music_parts_score_section_key`
 * （`UNIQUE (sheet_music_id, section)`）保证的不变量被卷进一次多余的 23505 风险里。
 */
export async function saveFileEdit({
  scoreId,
  fileId,
  currentPartId,
  currentSection,
  plan,
}: {
  scoreId: string;
  fileId: string;
  /** 这一行**现在**挂在哪个声部（调用方从页面快照里拿） */
  currentPartId: string;
  /** 这一行**现在**的声部名 —— 与 `plan.section` 相同即表示「没挪动」 */
  currentSection: string;
  plan: FileEditPlan;
}): Promise<SaveResult> {
  const moving = plan.section !== currentSection;

  let targetPartId = currentPartId;
  if (moving) {
    const created = await getOrCreatePart(scoreId, plan.section);
    // 建不出来就**别改名**：名称改了而分组没动，会造出上面那段说的矛盾状态。
    // （`getOrCreatePart` 把 INSERT 失败咽成了 null，所以这里必须当失败，不能当成「随便找了一个」）
    if (!created) return { ok: false, error: `目标声部「${plan.section}」创建失败，请重试` };
    targetPartId = created;
  }

  const { data, error } = await supabase
    .from("sheet_music_files")
    .update({
      part_id: targetPartId,
      instrument: plan.instrument,
      sub_parts: plan.subParts,
      file_name: plan.fileName,
    })
    .eq("id", fileId)
    .select("id");

  if (error) {
    // 唯一冲突给用户看得懂的话（与上传落库**同一个函数**）；其余错误原样透出
    return { ok: false, error: describeInsertError(error, [plan]) };
  }
  // **0 行 = 没改成**。两件事都会走到这里：RLS 静默拒绝（非 admin/score_manager），
  // 以及这一行已被别人删掉。当成成功的话，用户会以为改好了，直到刷新才发现什么都没变。
  if (!data || data.length === 0) {
    return { ok: false, error: "保存失败：这一份谱可能已经不在了，请刷新后重试" };
  }

  return { ok: true };
}

/**
 * 改曲子的三个字段。
 *
 * 与 `saveFileEdit` 一样要**检测 0 行**：`sheet_music` 的 RLS 对非 admin 是静默拒绝，
 * 而「标题没变但界面弹了成功」是最难发现的那种失败（用户刷新前一直以为改好了）。
 */
export async function saveScoreEdit({
  scoreId,
  plan,
}: {
  scoreId: string;
  plan: { title: string; composer: string | null; notes: string | null };
}): Promise<SaveResult> {
  const { data, error } = await supabase
    .from("sheet_music")
    .update({ title: plan.title, composer: plan.composer, notes: plan.notes })
    .eq("id", scoreId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "保存失败：这首曲子可能已经不在了，请刷新后重试" };
  }
  return { ok: true };
}
