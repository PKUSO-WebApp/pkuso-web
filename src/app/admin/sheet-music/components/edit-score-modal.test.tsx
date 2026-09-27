/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditScoreModal } from "./edit-score-modal";

/**
 * 「编辑曲目信息」弹窗的接线测试（与 `./edit-file-modal.test.tsx` 同一层，理由见那边）。
 *
 * 这里多钉一条 `null` 的往返：库里两个可空列读出来是 `null`，受控 `input` 拿到 `null`
 * 会把它显示成字符串 `"null"`（用户一打开弹窗就看到「作曲家：null」），而原样存回去
 * 又会把 `null` 变成 `""`。这一条只有渲染出来才看得见。
 */

const h = vi.hoisted(() => ({
  updateResult: { data: [{ id: "score-1" }], error: null } as {
    data: { id: string }[] | null;
    error: { message: string } | null;
  },
  updates: [] as { id: string; payload: Record<string, unknown> }[],
  /** 非 null 时写库挂在这里，直到测试放行 —— 「保存中」那个窗口只有挂住它才到得了 */
  updateGate: null as Promise<void> | null,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      update: (payload: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => ({
          select: async () => {
            if (h.updateGate) await h.updateGate;
            h.updates.push({ id, payload });
            return h.updateResult;
          },
        }),
      }),
    }),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.updateResult = { data: [{ id: "score-1" }], error: null };
  h.updates = [];
  // 必须复位：挂着不放行的话，下一条用例的写库会永远 pending
  h.updateGate = null;
});

function renderModal(initial?: {
  title?: string;
  composer?: string | null;
  notes?: string | null;
}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <EditScoreModal
      onClose={onClose}
      scoreId="score-1"
      initial={{
        title: initial?.title ?? "第五交响曲",
        composer: initial?.composer === undefined ? "肖斯塔科维奇" : initial.composer,
        notes: initial?.notes === undefined ? null : initial.notes,
      }}
      onSaved={onSaved}
    />,
  );
  return { onSaved, onClose };
}

describe("编辑曲目信息", () => {
  it("库里的 null 显示成空框，不是字符串 null", () => {
    renderModal({ composer: null, notes: null });
    expect((screen.getByLabelText("作曲家") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("备注") as HTMLTextAreaElement).value).toBe("");
  });

  it("清空曲名时拦下，且一次库都没写", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/曲名/), { target: { value: "   " } });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(screen.getByText("曲名不能为空")).toBeTruthy());
    expect(h.updates).toEqual([]);
  });

  it("保存成功：三列一起写，并通知父组件刷新", async () => {
    const { onSaved, onClose } = renderModal();
    fireEvent.change(screen.getByLabelText(/曲名/), { target: { value: " 艾格蒙特序曲 " } });
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: " 2024新年音乐会 " } });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(h.updates.length).toBe(1));
    expect(h.updates[0]).toEqual({
      id: "score-1",
      payload: { title: "艾格蒙特序曲", composer: "肖斯塔科维奇", notes: "2024新年音乐会" },
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("保存中点标题栏「关闭」关不掉 —— 关掉会让失败**一个字都看不到**、成功变成「明明取消了却变了」", async () => {
    let release: () => void = () => {};
    h.updateGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { onSaved, onClose } = renderModal();

    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("保存中…")).toBeTruthy());

    fireEvent.click(screen.getByText("关闭"));
    expect(
      screen.getByText("编辑曲目信息"),
      "关掉了的话，在飞请求的报错就落在已卸载的组件上",
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalled();
  });

  it("0 行更新（RLS 静默拒绝 / 曲目已被删）= 失败，不许显示成改好了", async () => {
    h.updateResult = { data: [], error: null };
    const { onSaved, onClose } = renderModal();
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(screen.getByText(/可能已经不在了/)).toBeTruthy());
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
