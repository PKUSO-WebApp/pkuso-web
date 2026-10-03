/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminPageHeaderProvider, useAdminPageHeader } from "@/context/admin-page-header-context";
import ScoreDetailPage from "./page";

/**
 * 曲谱详情页的**接线**测试：点哪一行、弹窗拿到的是哪一份谱/哪个声部、保存后列表有没有跟着变。
 *
 * 存在理由很具体：这一页此前没有任何测试，而本次加的两个编辑入口全是**接线**——
 * 判据（`../library-edit.ts`）与写库（`../library-save.ts`）都各有单测，
 * 但「铅笔点在第 2 行，弹窗里却是第 1 份谱」这种事只有把页面渲染出来才看得见。
 * 后果不是显示错，是**把一份谱挪到别的声部去**（写库那一层按传进来的 part 走）。
 *
 * ⚠️ `headerRight` 里的「编辑」按钮住在 `admin/layout.tsx` 的 AdminHeader 里，
 * 而这一页只把它塞进 Context。所以下面用 `HeaderProbe` 把它**读出来渲染**——
 * 少了这一步，「曲目信息编辑入口」在测试里根本不存在（测了个空气）。
 */

const h = vi.hoisted(() => ({
  score: {
    id: "score-1",
    title: "第五交响曲",
    composer: "肖斯塔科维奇",
    notes: null as string | null,
    created_at: null as string | null,
  },
  parts: [] as { id: string; section: string; sort_order: number | null }[],
  files: {} as Record<
    string,
    {
      id: string;
      storage_path: string;
      file_name: string;
      file_size: number | null;
      created_at: string | null;
      instrument: string | null;
      sub_parts: number[];
    }[]
  >,
  existingPartId: null as string | null,
  /** 每一次 update 的入参（表名 + 载荷）—— 接线错没错全看它 */
  updates: [] as { table: string; payload: Record<string, unknown> }[],
  deletes: [] as { table: string; value: unknown; cols?: string }[],
  /** 删除链的返回（用例内改）：默认命中 1 行；`[]` = 0 行（Issue #368） */
  deleteResult: { data: [{ id: "deleted" }], error: null } as { data: unknown; error: unknown },
  /** storage.remove 收到的路径 —— 「0 行时不许动附件」的断言看它 */
  storageRemoves: [] as string[][],
  /**
   * 已发出的**读**查询次数。用来钉住 `refetch()` 的位置：0 行时不许重取，
   * 一次新读都不该发 —— 只断言「列表长啥样」抓不到「重取被上移」（重取完照样 throw）。
   */
  reads: 0,
}));

/**
 * ⚠️ 两个 hook 的返回值必须是**稳定引用**（放进 `vi.hoisted` 只建一次）。
 *
 * 每次渲染都新建一个对象的话，页面里 `useEffect(…, [setTitle, setOnBack, setHeaderRight, router])`
 * 的依赖每轮都变 → 每轮都 `setHeaderRight` 一个新元素 → 再渲染 → **无限重渲染**，
 * 而它不报错、不超时，直接把 vitest 的 worker 跑崩（V8 fatal，实测要 90 秒才崩）。
 * 真实的 `next/navigation` 返回的是稳定对象，所以这是桩自己的坑。
 */
const nav = vi.hoisted(() => ({
  params: { id: "score-1" },
  router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useParams: () => nav.params,
  useRouter: () => nav.router,
}));

vi.mock("@/lib/supabase", () => {
  type Req = {
    table: string;
    op: "select" | "update" | "delete";
    cols?: string;
    payload?: Record<string, unknown>;
    filters: { col: string; value: unknown }[];
  };

  const resolve = (req: Req) => {
    if (req.op === "update") {
      h.updates.push({ table: req.table, payload: req.payload ?? {} });
      return { data: [{ id: "ok" }], error: null };
    }
    if (req.op === "delete") {
      // 记下 `.select(...)` 的列名 —— 没有它就拿不回被影响的行（Issue #368）
      h.deletes.push({ table: req.table, value: req.filters[0]?.value, cols: req.cols });
      // 与真实 SDK 同语义：没接 `.select(...)` 就返回 `{ data: null }`（拿不到行）
      return req.cols ? h.deleteResult : { data: null, error: null };
    }
    // 走到这里就是一次读查询（update/delete 已在上面 return）
    h.reads += 1;
    if (req.table === "sheet_music") return { data: h.score, error: null };
    if (req.table === "sheet_music_parts") {
      // 同一张表上两种读法：页面读整行（`*`），`getOrCreatePart` 只读 id
      if (req.cols === "id") {
        return { data: h.existingPartId ? { id: h.existingPartId } : null, error: null };
      }
      return { data: h.parts, error: null };
    }
    if (req.table === "sheet_music_files") {
      // 页面读整行并按 `part_id` 过滤。（早先这里还有一条「只读 id」的分支，给删空声部前的
      // `partHasFiles` 用 —— 那个函数连同自动删除一起撤掉了，分支现在没有调用方会走到。
      // 留着是因为它只是桩的一个形状分支、不影响任何断言，而删掉它得再动一次断言面。）
      const partId = req.filters.find((f) => f.col === "part_id")?.value as string;
      return { data: h.files[partId] ?? [], error: null };
    }
    throw new Error(`未预期的表：${req.table}`);
  };

  /** 可链式、也可 await 的桩（`.order().order()` 与 `await .order()` 都要能用） */
  const chain = (req: Req): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    const self = () => o;
    Object.assign(o, {
      select: (cols?: string) => {
        req.cols = cols ?? req.cols;
        return o;
      },
      eq: (col: string, value: unknown) => {
        req.filters.push({ col, value });
        return o;
      },
      order: self,
      limit: self,
      single: async () => resolve(req),
      maybeSingle: async () => resolve(req),
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve(resolve(req)).then(onFulfilled),
    });
    return o;
  };

  return {
    supabase: {
      from: (table: string) => ({
        select: (cols?: string) => chain({ table, op: "select", cols, filters: [] }),
        update: (payload: Record<string, unknown>) =>
          chain({ table, op: "update", payload, filters: [] }),
        delete: () => chain({ table, op: "delete", filters: [] }),
      }),
      storage: {
        from: () => ({
          remove: (paths: string[]) => {
            h.storageRemoves.push(paths);
            return Promise.resolve({ data: null, error: null });
          },
          download: vi.fn(),
        }),
      },
    },
  };
});

/** 把 `headerRight` 从 Context 里读出来渲染 —— 它平时由 `admin/layout.tsx` 渲染 */
function HeaderProbe() {
  const { title, headerRight } = useAdminPageHeader();
  return (
    <div>
      <span data-testid="header-title">{title}</span>
      <div data-testid="header-right">{headerRight}</div>
    </div>
  );
}

function renderPage() {
  return render(
    <AdminPageHeaderProvider routeKey="/admin/sheet-music/score-1">
      <ScoreDetailPage />
      <HeaderProbe />
    </AdminPageHeaderProvider>,
  );
}

const file = (
  id: string,
  name: string,
  instrument: string | null,
  subParts: number[],
): (typeof h.files)[string][number] => ({
  id,
  storage_path: `score-1/${id}.pdf`,
  file_name: name,
  file_size: 1024,
  created_at: "2026-09-01T00:00:00Z",
  instrument,
  sub_parts: subParts,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.score = {
    id: "score-1",
    title: "第五交响曲",
    composer: "肖斯塔科维奇",
    notes: null,
    created_at: null,
  };
  h.parts = [];
  h.files = {};
  h.existingPartId = null;
  h.updates = [];
  h.deletes = [];
  h.deleteResult = { data: [{ id: "deleted" }], error: null };
  h.storageRemoves = [];
  h.reads = 0;
});

function seedOneScore() {
  h.parts = [
    { id: "part-1", section: "圆号", sort_order: 0 },
    { id: "part-2", section: "小号", sort_order: 0 },
  ];
  h.files = {
    "part-1": [file("file-1", "F调圆号1.pdf", "F调圆号", [1])],
    "part-2": [file("file-2", "降B调小号1.pdf", "降B调小号", [1])],
  };
}

describe("曲谱详情页", () => {
  it("渲染出曲名、两个声部与它们的文件", async () => {
    seedOneScore();
    renderPage();

    await waitFor(() => expect(screen.getByTestId("header-title").textContent).toBe("第五交响曲"));
    expect(screen.getByText("圆号")).toBeTruthy();
    expect(screen.getByText("小号")).toBeTruthy();
    expect(screen.getByText("F调圆号1.pdf")).toBeTruthy();
  });

  it("铅笔点在**哪一行**，弹窗拿到就是那一份谱（接线错误会把谱挪到别的声部）", async () => {
    seedOneScore();
    renderPage();
    await waitFor(() => expect(screen.getByText("降B调小号1.pdf")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("编辑 降B调小号1.pdf"));

    await waitFor(() => expect(screen.getByText("编辑这份谱")).toBeTruthy());
    // 弹窗里那一行「当前：」必须是被点的那一份
    expect(screen.getByText(/当前：降B调小号1\.pdf/)).toBeTruthy();
    expect((screen.getByLabelText("声部") as HTMLSelectElement).value).toBe("小号");
  });

  it("保存后写库用的是**这一行所属声部**的 part_id，且列表重新拉取", async () => {
    seedOneScore();
    renderPage();
    await waitFor(() => expect(screen.getByText("F调圆号1.pdf")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("编辑 F调圆号1.pdf"));
    await waitFor(() => expect(screen.getByText("编辑这份谱")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("分声部号"), { target: { value: "1,2" } });
    // 刷新时后端会返回新名字 —— 用桩模拟「库里已经改了」
    h.files = { ...h.files, "part-1": [file("file-1", "F调圆号1,2.pdf", "F调圆号", [1, 2])] };
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(h.updates.length).toBe(1));
    expect(h.updates[0]).toEqual({
      table: "sheet_music_files",
      payload: {
        part_id: "part-1",
        instrument: "F调圆号",
        sub_parts: [1, 2],
        file_name: "F调圆号1,2.pdf",
      },
    });
    await waitFor(() => expect(screen.getByText("F调圆号1,2.pdf")).toBeTruthy());
  });

  it("挪声部：payload 落到目标声部，且**全程不删任何行**", async () => {
    h.parts = [{ id: "part-1", section: "圆号", sort_order: 0 }];
    h.files = { "part-1": [file("file-1", "F调圆号1.pdf", "F调圆号", [1])] };
    h.existingPartId = "part-9"; // 目标声部「小号」已存在

    renderPage();
    await waitFor(() => expect(screen.getByText("F调圆号1.pdf")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("编辑 F调圆号1.pdf"));
    await waitFor(() => expect(screen.getByText("编辑这份谱")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("声部"), { target: { value: "小号" } });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(h.updates.length).toBe(1));
    expect(h.updates[0].payload.part_id).toBe("part-9");
    // 源声部空着也不收（删它是两次往返，中间落进来的上传会被 CASCADE 连带删掉）
    expect(h.deletes).toEqual([]);
  });

  it("header 的「编辑」打开曲目信息弹窗，保存后标题跟着变", async () => {
    seedOneScore();
    renderPage();
    await waitFor(() => expect(screen.getByTestId("header-title").textContent).toBe("第五交响曲"));

    fireEvent.click(screen.getByText("编辑"));
    await waitFor(() => expect(screen.getByText("编辑曲目信息")).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/曲名/), { target: { value: "肖五" } });
    // 刷新时后端会返回新标题
    h.score = { ...h.score, title: "肖五" };
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(h.updates.length).toBe(1));
    expect(h.updates[0]).toEqual({
      table: "sheet_music",
      payload: { title: "肖五", composer: "肖斯塔科维奇", notes: null },
    });
    await waitFor(() => expect(screen.getByTestId("header-title").textContent).toBe("肖五"));
  });
});

/**
 * 删除的 0 行检测（Issue #368）—— 两处：删文件、删声部。
 *
 * 原实现是「**先**删 storage 附件、**再**删库行」：0 行（RLS 静默拒绝 / 并发已删）时
 * DB 那行还在，附件却已经被删掉了。契约要求副作用排在 0 行检测**之后**。
 */
describe("曲谱详情页的删除（0 行检测）", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    confirmSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it("删文件命中 0 行 → 返回失败：**不动 storage 附件**、弹「删除失败」", async () => {
    seedOneScore();
    h.deleteResult = { data: [], error: null };
    renderPage();
    await waitFor(() => expect(screen.getByText("F调圆号1.pdf")).toBeTruthy());

    const readsBefore = h.reads;
    fireEvent.click(screen.getByLabelText("删除 F调圆号1.pdf"));

    await waitFor(() => expect(h.deletes).toHaveLength(1));
    // 契约第 1 条：删除链必须能拿回被影响的行（记下 `.select("id")`）
    expect(h.deletes[0]).toEqual({ table: "sheet_music_files", value: "file-1", cols: "id" });
    // 契约第 4 条：0 行检测之前不许删附件 —— 库里那行还在，附件不能先没
    expect(h.storageRemoves).toEqual([]);
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("删除失败"));
    // 契约第 4 条（同一件事的另一半）：`refetch()` 也是副作用，同样要排在检测之后。
    // 只断言「附件没删 / 列表没变」抓不到它被上移 —— 重取完照样 throw。所以直接数读查询。
    expect(h.reads).toBe(readsBefore);
  });

  it("删文件命中 1 行 → 照常清 storage（成功路径不回归）", async () => {
    seedOneScore();
    renderPage();
    await waitFor(() => expect(screen.getByText("F调圆号1.pdf")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("删除 F调圆号1.pdf"));

    await waitFor(() => expect(h.storageRemoves).toHaveLength(1));
    expect(h.storageRemoves[0]).toEqual(["score-1/file-1.pdf"]);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("删声部命中 0 行 → 不动 storage 附件、弹「删除失败」", async () => {
    seedOneScore();
    h.deleteResult = { data: [], error: null };
    renderPage();
    await waitFor(() => expect(screen.getByText("圆号")).toBeTruthy());

    const readsBefore = h.reads;
    fireEvent.click(screen.getAllByText("删除声部")[0]);

    await waitFor(() => expect(h.deletes).toHaveLength(1));
    expect(h.deletes[0]).toEqual({ table: "sheet_music_parts", value: "part-1", cols: "id" });
    // 整组的附件都不能在「库行还在」的前提下降动
    expect(h.storageRemoves).toEqual([]);
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("删除失败"));
    // 同 deleteFile：`refetch()` 也必须排在 0 行检测之后
    expect(h.reads).toBe(readsBefore);
  });

  it("删声部命中 1 行 → 照常清 storage（成功路径不回归）", async () => {
    seedOneScore();
    renderPage();
    await waitFor(() => expect(screen.getByText("圆号")).toBeTruthy());

    fireEvent.click(screen.getAllByText("删除声部")[0]);

    await waitFor(() => expect(h.storageRemoves).toHaveLength(1));
    expect(h.storageRemoves[0]).toEqual(["score-1/file-1.pdf"]);
  });
});
