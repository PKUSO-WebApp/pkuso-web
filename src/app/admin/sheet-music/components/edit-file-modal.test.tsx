/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditFileModal } from "./edit-file-modal";

/**
 * 「编辑这份谱」弹窗的**接线**测试。
 *
 * 存在理由：判据在 `../library-edit.ts`（有单测）、写库序列在 `../library-save.ts`（有单测），
 * 而**两者接没接上**只有把组件渲染出来才看得见 —— 本仓在 `upload-modal.test.tsx` 的
 * docblock 里记着两次同类漏网（判据都对，界面上却指着一个不存在的按钮 / 整块不渲染）。
 *
 * 这一层刻意**不重测**判据的每一条分支（那是纯函数的活），只钉三件事：
 * 校验真的挡在写库前面、控件语义与上传侧一致、保存成功后的回调真的发了。
 */

const h = vi.hoisted(() => ({
  existingPart: { id: "part-2" } as { id: string } | null,
  updateResult: { data: [{ id: "file-1" }], error: null } as {
    data: { id: string }[] | null;
    error: { code?: string; message: string } | null;
  },
  fileUpdates: [] as { id: string; payload: Record<string, unknown> }[],
  partDeletes: [] as string[],
  insertPartResult: { data: { id: "part-new" }, error: null } as {
    data: { id: string } | null;
    error: { message: string } | null;
  },
  /** 非 null 时写库挂在这里，直到测试放行 —— 「保存中」那个窗口只有挂住它才到得了 */
  updateGate: null as Promise<void> | null,
}));

vi.mock("@/lib/supabase", () => {
  const partsTable = () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: h.existingPart, error: null }) }),
      }),
    }),
    insert: () => ({ select: () => ({ single: async () => h.insertPartResult }) }),
    delete: () => ({
      eq: async (_col: string, id: string) => {
        h.partDeletes.push(id);
        return { error: null };
      },
    }),
  });

  return {
    supabase: {
      from: (table: string) => {
        if (table === "sheet_music_parts") return partsTable();
        if (table === "sheet_music_files") {
          return {
            select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }),
            update: (payload: Record<string, unknown>) => ({
              eq: (_col: string, id: string) => ({
                select: async () => {
                  if (h.updateGate) await h.updateGate;
                  h.fileUpdates.push({ id, payload });
                  return h.updateResult;
                },
              }),
            }),
          };
        }
        throw new Error(`未预期的表：${table}`);
      },
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.existingPart = { id: "part-2" };
  h.updateResult = { data: [{ id: "file-1" }], error: null };
  h.fileUpdates = [];
  h.partDeletes = [];
  h.insertPartResult = { data: { id: "part-new" }, error: null };
  // 必须复位：挂着不放行的话，下一条用例的写库会永远 pending
  h.updateGate = null;
});

const file = {
  id: "file-1",
  file_name: "F调圆号_1.pdf",
  instrument: "F调圆号",
  sub_parts: [1],
};

function renderModal(overrides?: { partSection?: string; fileCount?: number }) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <EditFileModal
      onClose={onClose}
      scoreId="score-1"
      file={file}
      part={{ id: "part-1", section: overrides?.partSection ?? "圆号" }}
      sourceFileCount={overrides?.fileCount ?? 4}
      onSaved={onSaved}
    />,
  );
  return { onSaved, onClose };
}

describe("编辑这份谱 · 校验挡在写库前面", () => {
  it("乐器名被清空时点保存：给出与上传侧同一句话，且**一次库都没写**", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("乐器名"), { target: { value: "" } });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(screen.getByText("未识别的乐器名，请先填写再上传")).toBeTruthy());
    expect(h.fileUpdates, "判据没接上的话，这里会多出一次写库").toEqual([]);
  });

  it("号写成区间时同样拦下（文案来自 `parseSubPartsInput`，不是这里另编的）", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("分声部号"), { target: { value: "1-4" } });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() =>
      expect(screen.getByText("不接受区间「1-4」，请逐个写出（如 1,2,3,4）")).toBeTruthy(),
    );
    expect(h.fileUpdates).toEqual([]);
  });
});

describe("编辑这份谱 · 保存路径", () => {
  it("改号后保存：四列一起写，文件名跟着重算，并通知父组件刷新", async () => {
    const { onSaved, onClose } = renderModal();
    fireEvent.change(screen.getByLabelText("分声部号"), { target: { value: "1,2" } });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(h.fileUpdates.length).toBe(1));
    expect(h.fileUpdates[0]).toEqual({
      id: "file-1",
      payload: {
        part_id: "part-1",
        instrument: "F调圆号",
        sub_parts: [1, 2],
        file_name: "F调圆号1,2.pdf",
      },
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("挪声部：落到**目标声部**的 id 上（写着小号却留在圆号，就是「名字与分组互相矛盾」）", async () => {
    renderModal({ partSection: "圆号", fileCount: 1 });
    fireEvent.change(screen.getByLabelText("声部"), { target: { value: "小号" } });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(h.fileUpdates.length).toBe(1));
    expect(h.fileUpdates[0].payload.part_id).toBe("part-2");
    // 源声部**保留**（它已经空了也不删）—— 理由见 `../library-save.ts` 顶部那段
    expect(h.partDeletes).toEqual([]);
  });

  it("保存中点标题栏「关闭」关不掉 —— 关掉会让失败**一个字都看不到**、成功变成「明明取消了却变了」", async () => {
    let release: () => void = () => {};
    h.updateGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { onSaved, onClose } = renderModal();

    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("保存中…")).toBeTruthy());

    // 标题栏那颗「关闭」调的是同一个 onClose，且它是键盘唯一够得着的关闭入口
    fireEvent.click(screen.getByText("关闭"));
    expect(
      screen.getByText("编辑这份谱"),
      "关掉了的话，在飞请求的报错就落在已卸载的组件上",
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalled();
  });

  it("落库失败时**不**关弹窗、不通知刷新（用户得看见那句话才有得改）", async () => {
    h.updateResult = { data: null, error: { code: "23505", message: "duplicate key" } };
    const { onSaved, onClose } = renderModal();
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(screen.getByText(/已经有同名文件/)).toBeTruthy());
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("编辑这份谱 · 控件语义与上传侧一致", () => {
  it("选「总谱」：乐器名预填成总谱、分声部框禁用并显示总谱（总谱没有「第几号」）", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("声部"), { target: { value: "总谱" } });

    const instrument = screen.getByLabelText("乐器名") as HTMLInputElement;
    const subParts = screen.getByLabelText("分声部号") as HTMLInputElement;
    expect(instrument.value).toBe("总谱");
    expect(subParts.value).toBe("总谱");
    expect(subParts.disabled).toBe(true);
  });

  it("库里既有的非标准声部值仍然显示得出来（否则一打开弹窗就被悄悄改成列表第一项）", () => {
    renderModal({ partSection: "低音大管" });
    const section = screen.getByLabelText("声部") as HTMLSelectElement;
    expect(section.value).toBe("低音大管");
  });

  it("只改乐器名时不去碰声部表（没挪动就不该查/建声部）", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("乐器名"), { target: { value: "圆号" } });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(h.fileUpdates.length).toBe(1));
    expect(h.partDeletes).toEqual([]);
    expect(h.fileUpdates[0].payload.part_id).toBe("part-1");
  });
});
