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
  deletes: [] as { table: string; value: unknown }[],
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
      h.deletes.push({ table: req.table, value: req.filters[0]?.value });
      return { data: null, error: null };
    }
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
      storage: { from: () => ({ remove: vi.fn(), download: vi.fn() }) },
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
    <AdminPageHeaderProvider>
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
