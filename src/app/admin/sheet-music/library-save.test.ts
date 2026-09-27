import { afterEach, describe, expect, it, vi } from "vitest";
import { saveFileEdit, saveScoreEdit } from "./library-save";

/**
 * 库编辑的**写库序列**。这些用例钉的是顺序与失败语义 —— 判据本身在 `library-edit.test.ts`。
 *
 * 三条关键不变量（每条都有对应用例）：
 *
 * 1. **四列一起改**：`part_id` / `instrument` / `sub_parts` / `file_name` 是同一次 UPDATE 的字段。
 *    分成两次写在中间留一个「名字是新的、分组是旧的」的窗口，那时看库的人无法判断该信哪个。
 * 2. **主更新没成就别动别的**：目标声部建不出来时**不许**改名字 —— 那会造出上面那个矛盾状态。
 * 3. **主更新的 0 行是失败**：RLS 静默拒绝与「行已被删」都长这样，当成成功的话
 *    用户会以为改好了，直到刷新才发现什么都没变。
 */

const h = vi.hoisted(() => ({
  /** `.select().eq().eq().maybeSingle()` 查到的那一行（目标声部） */
  existingPart: null as { id: string } | null,
  /** `.insert().select().single()` 的结果 */
  insertPartResult: { data: { id: "part-new" }, error: null } as {
    data: { id: string } | null;
    error: { message: string } | null;
  },
  /** 主更新（`sheet_music_files`）的结果 */
  fileUpdateResult: { data: [{ id: "file-1" }], error: null } as {
    data: { id: string }[] | null;
    error: { code?: string; message: string } | null;
  },
  /** 曲子信息更新的结果 */
  scoreUpdateResult: { data: [{ id: "score-1" }], error: null } as {
    data: { id: string }[] | null;
    error: { message: string } | null;
  },
  /** 记录。`partDeletes` / `fileQueries` 是**不变量**：本次改动的写库面里一个 DELETE 都不该有 */
  fileUpdates: [] as { id: string; payload: Record<string, unknown> }[],
  scoreUpdates: [] as { id: string; payload: Record<string, unknown> }[],
  partSelects: 0,
  partInserts: [] as Record<string, unknown>[],
  partDeletes: [] as string[],
  fileQueries: [] as string[],
}));

vi.mock("@/lib/supabase", () => {
  const partsTable = () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => {
            h.partSelects += 1;
            return { data: h.existingPart, error: null };
          },
        }),
      }),
    }),
    insert: (row: Record<string, unknown>) => {
      h.partInserts.push(row);
      return { select: () => ({ single: async () => h.insertPartResult }) };
    },
    // 仍然**保留**可用的 delete 桩（并记录）：万一哪天代码又开始删声部，
    // 断言里那条 `partDeletes` 会红，而不是让桩先崩掉、把红变成另一种红。
    delete: () => ({
      eq: async (_col: string, id: string) => {
        h.partDeletes.push(id);
        return { error: null };
      },
    }),
  });

  const filesTable = () => ({
    select: () => ({
      eq: (_col: string, partId: string) => ({
        limit: async () => {
          h.fileQueries.push(partId);
          return { data: [], error: null };
        },
      }),
    }),
    update: (payload: Record<string, unknown>) => ({
      eq: (_col: string, id: string) => ({
        select: async () => {
          h.fileUpdates.push({ id, payload });
          return h.fileUpdateResult;
        },
      }),
    }),
  });

  const scoresTable = () => ({
    update: (payload: Record<string, unknown>) => ({
      eq: (_col: string, id: string) => ({
        select: async () => {
          h.scoreUpdates.push({ id, payload });
          return h.scoreUpdateResult;
        },
      }),
    }),
  });

  return {
    supabase: {
      from: (table: string) => {
        if (table === "sheet_music_parts") return partsTable();
        if (table === "sheet_music_files") return filesTable();
        if (table === "sheet_music") return scoresTable();
        throw new Error(`未预期的表：${table}`);
      },
    },
  };
});

afterEach(() => {
  vi.clearAllMocks();
  h.existingPart = null;
  h.insertPartResult = { data: { id: "part-new" }, error: null };
  h.fileUpdateResult = { data: [{ id: "file-1" }], error: null };
  h.scoreUpdateResult = { data: [{ id: "score-1" }], error: null };
  h.fileUpdates = [];
  h.scoreUpdates = [];
  h.partSelects = 0;
  h.partInserts = [];
  h.partDeletes = [];
  h.fileQueries = [];
});

const plan = {
  section: "小号",
  instrument: "降B调小号",
  subParts: [1],
  fileName: "降B调小号1.pdf",
};

describe("saveFileEdit · 没挪声部", () => {
  it("只发一次 UPDATE，四列齐全，且**不查库**（改个乐器名不需要知道声部表长什么样）", async () => {
    const r = await saveFileEdit({
      scoreId: "score-1",
      fileId: "file-1",
      currentPartId: "part-1",
      currentSection: "小号",
      plan,
    });

    expect(r).toEqual({ ok: true });
    expect(h.fileUpdates).toEqual([
      {
        id: "file-1",
        payload: {
          part_id: "part-1",
          instrument: "降B调小号",
          sub_parts: [1],
          file_name: "降B调小号1.pdf",
        },
      },
    ]);
    expect(h.partSelects).toBe(0);
    expect(h.partInserts).toEqual([]);
    expect(h.partDeletes).toEqual([]);
  });
});

describe("saveFileEdit · 挪声部", () => {
  const moveTo = (section: string) => ({
    ...plan,
    section,
    fileName: `${section}1.pdf`,
  });

  it("目标声部已存在 → 并入它（**不许**新建第二个同名声部）", async () => {
    h.existingPart = { id: "part-2" };

    const r = await saveFileEdit({
      scoreId: "score-1",
      fileId: "file-1",
      currentPartId: "part-1",
      currentSection: "圆号",
      plan: moveTo("小号"),
    });

    expect(r).toEqual({ ok: true });
    expect(h.partSelects, "应当先查一次目标声部").toBe(1);
    expect(
      h.partInserts,
      "已存在就不该新建 —— 库里 `UNIQUE (sheet_music_id, section)` 会判 23505",
    ).toEqual([]);
    expect(h.fileUpdates[0].payload.part_id).toBe("part-2");
    // ⚠️ **任何情况下都不许删声部**（这条钉的是一个被推翻过的实现）：早先这里会「问一次库，
    // 源声部空了就删掉它」，而那是两次往返 —— 中间落进来的上传文件会被外键 CASCADE 连带删掉。
    // 现在挪空的源声部**保留**，由用户在详情页用既有的「删除声部」手工收。
    expect(h.partDeletes, "本次改动的写库面里不该出现 DELETE").toEqual([]);
  });

  it("目标声部不存在 → 新建一个再挪（建出来的 id 必须进 payload）", async () => {
    h.existingPart = null;
    h.insertPartResult = { data: { id: "part-new" }, error: null };

    await saveFileEdit({
      scoreId: "score-1",
      fileId: "file-1",
      currentPartId: "part-1",
      currentSection: "圆号",
      plan: moveTo("大号"),
    });

    expect(h.partInserts).toEqual([{ sheet_music_id: "score-1", section: "大号" }]);
    expect(h.fileUpdates[0].payload.part_id).toBe("part-new");
  });

  it("目标声部**建不出来** → 整次保存失败，且一行都没改（不许只改名字不改分组）", async () => {
    h.existingPart = null;
    h.insertPartResult = { data: null, error: { message: "boom" } };

    const r = await saveFileEdit({
      scoreId: "score-1",
      fileId: "file-1",
      currentPartId: "part-1",
      currentSection: "圆号",
      plan: moveTo("大号"),
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("大号");
    expect(h.fileUpdates, "这一条是本次改动最容易漏的：名字改了、分组没改").toEqual([]);
  });

  it("挪完之后**不碰**源声部：全程没有 DELETE、也没有拿源声部去查文件", async () => {
    h.existingPart = { id: "part-2" };

    await saveFileEdit({
      scoreId: "score-1",
      fileId: "file-1",
      currentPartId: "part-1",
      currentSection: "圆号",
      plan: moveTo("小号"),
    });

    expect(h.fileQueries, "那个「问一次库再删」的检查整体撤掉了").toEqual([]);
    expect(h.partDeletes).toEqual([]);
  });
});

describe("saveFileEdit · 落库失败", () => {
  it("唯一冲突 → 给用户看得懂的话（不是 PG 原文），且带上那个撞了的文件名", async () => {
    h.fileUpdateResult = {
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "sheet_music_files_part_id_file_name_key"',
      },
    };

    const r = await saveFileEdit({
      scoreId: "score-1",
      fileId: "file-1",
      currentPartId: "part-1",
      currentSection: "小号",
      plan,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("已经有同名文件");
    expect(r.error).toContain("降B调小号1.pdf");
    expect(r.error).not.toContain("duplicate key");
  });

  it("0 行 = 失败（RLS 静默拒绝 / 行已被别人删掉），文案要说得出「可能已经不在了」", async () => {
    h.fileUpdateResult = { data: [], error: null };

    const r = await saveFileEdit({
      scoreId: "score-1",
      fileId: "file-1",
      currentPartId: "part-1",
      currentSection: "小号",
      plan,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("可能已经不在了");
    expect(h.partDeletes, "主更新没成，就不该再动声部").toEqual([]);
  });
});

describe("saveScoreEdit", () => {
  it("三列一起写", async () => {
    const r = await saveScoreEdit({
      scoreId: "score-1",
      plan: { title: "第五交响曲", composer: null, notes: "新年音乐会" },
    });

    expect(r).toEqual({ ok: true });
    expect(h.scoreUpdates).toEqual([
      { id: "score-1", payload: { title: "第五交响曲", composer: null, notes: "新年音乐会" } },
    ]);
  });

  it("0 行 = 失败", async () => {
    h.scoreUpdateResult = { data: [], error: null };
    const r = await saveScoreEdit({
      scoreId: "score-1",
      plan: { title: "第五交响曲", composer: null, notes: null },
    });
    expect(r.ok).toBe(false);
  });
});
