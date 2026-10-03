/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminPageHeaderProvider, useAdminPageHeader } from "@/context/admin-page-header-context";
import SheetMusicPage from "./page";

/**
 * 谱务**列表页**的顶栏接线测试（页面本体此前没有任何测试）。
 *
 * 守的是这一件事：`score_manager` 在本页左上看到的是「退出登录」而不是「返回」。
 *
 * 为什么值得一个测试文件：本页的「返回」走 `admin/layout.tsx` 里 `handleBack` 的默认分支
 * （`router.push("/admin")`），而 `/admin` 对 `score_manager` 越界（`lib/access.ts`）
 * ⇒ 那是个按了原地打转的死按钮。而这类账号**没有别的出口**：`/admin/profile`
 * 对他同样越界，顶栏右侧又被本页的 `headerRight`（「新增」）占着，设置齿轮
 * 根本不会渲染。所以左槽一旦接错，症状是**账号彻底登不出去**。
 *
 * ⚠️ `headerLeft` / `headerRight` 住在 `admin/layout.tsx` 的 AdminHeader 里，本页只把
 * 它们塞进 Context。所以下面用 `HeaderProbe` 把它们**读出来渲染** —— 少了这一步，
 * 测的是空气（`[id]/page.test.tsx` 踩过同一个坑，注释在那边）。
 */

const h = vi.hoisted(() => ({
  user: null as { id: string; role: string } | null,
  /** ⚠️ 必须是 `signOut` 而不是 `logout` —— 后者只清内存态，不结束会话（见下面用例） */
  signOut: vi.fn(),
  scores: [] as unknown[],
  /** 删除曲目时先查的声部 / 文件（0 行检测用例要能给出「有附件」的形状） */
  parts: [] as { id: string }[],
  files: [] as { storage_path: string }[],
  /** `.single()` / `.maybeSingle()` 的返回（本页不用，留着避免桩被别的调用打穿） */
  singleRow: { data: null, error: null } as { data: unknown; error: unknown },
  /** `sheet_music.delete()` 的返回（用例内改）：默认命中 1 行；`[]` = 0 行 */
  deleteResult: { data: [{ id: "s1" }], error: null } as { data: unknown; error: unknown },
  deletes: [] as { table: string; cols: string; selected: boolean }[],
  /** storage.remove 收到的路径 —— 「0 行时不许动附件」的断言看它 */
  storageRemoves: [] as string[][],
}));

/**
 * ⚠️ 必须返回**稳定引用**：每次渲染新建对象的话，页面那个
 * `useEffect(…, [role, handleLogout, …])` 的依赖每轮都变 → 每轮都 `setHeaderRight`
 * 一个新元素 → 无限重渲染。它不报错、不超时，直接把 vitest worker 跑崩（V8 fatal）。
 * 真实的 `user-context.tsx` 用 `useMemo` 返回稳定对象，所以这是桩自己的坑。
 */
vi.mock("@/context/user-context", () => {
  const stable = { user: null as unknown, login: vi.fn(), logout: vi.fn(), signOut: h.signOut };
  return {
    useUser: () => {
      stable.user = h.user; // 同步成当前用例的值，但**对象引用不变**
      return stable;
    },
  };
});

const nav = vi.hoisted(() => ({
  router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => nav.router }));

// 本页只在弹窗打开时用它，而它拖着一堆渲染/OCR 依赖进 jsdom 没有意义
vi.mock("./upload-modal", () => ({ UploadModal: () => null }));

/**
 * supabase 桩。按表 + 操作分别给结果（Issue #368 的删除用例要控制
 * `sheet_music.delete()` 命中几行），并把每次写操作与 storage 删除记下来供断言。
 */
vi.mock("@/lib/supabase", () => {
  const builder = (table: string) => {
    let op: "select" | "delete" | "insert" | "update" = "select";
    /** 这次 select 要过哪些列 —— `sheet_music_parts` 那条只取 id/storage_path */
    let cols = "*";
    let selected = false;
    const o: Record<string, unknown> = {};
    const passthrough = () => o;
    Object.assign(o, {
      eq: passthrough,
      in: passthrough,
      order: passthrough,
      gte: passthrough,
      lte: passthrough,
      neq: passthrough,
      is: passthrough,
      select: (c?: string) => {
        if (op !== "select") selected = true; // 写链上的 .select(...)
        cols = c ?? cols;
        return o;
      },
      single: () => Promise.resolve(h.singleRow),
      maybeSingle: () => Promise.resolve(h.singleRow),
      delete: () => {
        op = "delete";
        return o;
      },
      insert: () => {
        op = "insert";
        return o;
      },
      update: () => {
        op = "update";
        return o;
      },
      then: (resolve: (v: unknown) => void) => {
        if (op === "delete") {
          h.deletes.push({ table, cols, selected });
          // 与真实 SDK 同语义：没接 `.select(...)` 就返回 `{ data: null }`（拿不到行）
          return resolve(selected ? h.deleteResult : { data: null, error: null });
        }
        if (op !== "select") return resolve({ data: null, error: null });
        if (table === "sheet_music_parts") return resolve({ data: h.parts, error: null });
        if (table === "sheet_music_files") return resolve({ data: h.files, error: null });
        return resolve({ data: h.scores, error: null });
      },
    });
    return o;
  };
  return {
    supabase: {
      from: (table: string) => builder(table),
      storage: {
        from: () => ({
          remove: (paths: string[]) => {
            h.storageRemoves.push(paths);
            return Promise.resolve({ data: null, error: null });
          },
        }),
      },
    },
  };
});

/**
 * 把 Context 里的槽读出来渲染。
 *
 * ⚠️ **它绕过了 `AdminHeader` 的两个三元**——所以这里断言的是那两处的**输入**
 * （`headerLeft` 是不是空、`hideBackButton` 是真是假），不是顶栏最终渲染出的像素。
 *
 * 「输入 → 输出」那一段由 `admin/layout.test.tsx` 里新增的一组渲染测试覆盖。
 * 那组是**补出来的**，因为此前那里没有任何测试渲染过「带标题」的 header：
 * 每次 children 都是裸字符串或裸 div，`title` 恒为空 ⇒ `hasTitle` 恒为 false，
 * 新增的 `headerLeft` 分支从来没被渲染过。实测：把 `AdminHeader` 改成让「返回」
 * 压过左槽（左槽不再抢占），全量测试**照样全绿**。
 */
function HeaderProbe() {
  const { title, headerLeft, headerRight, hideBackButton } = useAdminPageHeader();
  return (
    <div>
      <span data-testid="header-title">{title}</span>
      <div data-testid="header-left">{headerLeft}</div>
      <div data-testid="header-right">{headerRight}</div>
      <span data-testid="hide-back">{String(hideBackButton)}</span>
    </div>
  );
}

const renderPage = () =>
  render(
    <AdminPageHeaderProvider routeKey="/admin/sheet-music">
      <SheetMusicPage />
      <HeaderProbe />
    </AdminPageHeaderProvider>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.user = null;
  h.scores = [];
  h.parts = [];
  h.files = [];
  h.deleteResult = { data: [{ id: "s1" }], error: null };
  h.deletes = [];
  h.storageRemoves = [];
});

describe("谱务列表页的顶栏", () => {
  it("score_manager：左侧是「退出登录」，且 hideBackButton 保持 false（右侧不被换挡）", async () => {
    h.user = { id: "u1", role: "score_manager" };
    renderPage();

    await waitFor(() => expect(screen.getByTestId("header-title")).toHaveTextContent("谱务管理"));

    // ⚠️ **这条是本次最要紧的断言，而且它守的是「不要做什么」。**
    //
    // `hideBackButton` 名字像「隐藏返回键」，但 `admin/layout.tsx` 的**右侧槽**判据
    // 也是它（`hasTitle && !hideBackButton ? headerRight : <设置齿轮>`）。置 true 会把
    // 「新增」换成设置齿轮，而齿轮指向 `/admin/profile`，对 score_manager 越界
    // ⇒ 拿一个死按钮换掉本页唯一的建谱入口。
    //
    // 左侧并不需要它：`layout.tsx` 那里是 `headerLeft ? headerLeft : …`，左槽已抢占。
    //
    // 修这一版之前，页面里确实写了 `setHideBackButton(true)`，而这条用例当时断言的
    // 是 `"true"` —— **把回归当成了期望值**。合规审查抓出来的。
    expect(screen.getByTestId("hide-back")).toHaveTextContent("false");

    const left = screen.getByTestId("header-left");
    expect(left).toHaveTextContent("退出登录");
    expect(screen.getByRole("button", { name: /退出登录/ })).toBeInTheDocument();
  });

  it("admin：看不到「退出」，返回键保留（不回归）", async () => {
    h.user = { id: "u2", role: "admin" };
    renderPage();

    await waitFor(() => expect(screen.getByTestId("header-title")).toHaveTextContent("谱务管理"));

    expect(screen.getByTestId("hide-back")).toHaveTextContent("false");
    expect(screen.getByTestId("header-left")).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: /退出登录/ })).not.toBeInTheDocument();
    // 「新增」对两个角色都还在
    expect(screen.getByRole("button", { name: "新增" })).toBeInTheDocument();
  });

  it("点「退出登录」→ 调 signOut()（**真的结束会话**）并跳 /login", async () => {
    h.user = { id: "u3", role: "score_manager" };
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /退出登录/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /退出登录/ }));

    // ⚠️ 必须是 `signOut`（内部 `supabase.auth.signOut()`），不是 `logout`。
    // 用 `logout` 的话界面照样跳 `/login`、**看着像退了**，但会话还在浏览器里，
    // 按后退或直接再进 `/admin/**` 就免密回去了 —— 守卫只看 `sessionUserId`。
    expect(h.signOut).toHaveBeenCalledTimes(1);
    // `replace` 而不是 `push`：不退的话本页会留在历史里，退出后按后退又回到这儿
    expect(nav.router.replace).toHaveBeenCalledWith("/login");
  });
});

/**
 * 删曲目的 0 行检测（Issue #368）。
 *
 * 原实现是「**先**删 storage 附件、**再**删库行」：命中 0 行时（RLS 静默拒绝 /
 * 已被并发删除）DB 那行还在，附件却已经被删掉了。契约要求副作用排在检测之后。
 */
describe("谱务列表页删曲目（0 行检测）", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    h.user = { id: "u1", role: "admin" };
    h.scores = [{ id: "s1", title: "第五交响曲", composer: null, notes: null, created_at: null }];
    h.parts = [{ id: "p1" }];
    h.files = [{ storage_path: "s1/p1.pdf" }];
  });

  afterEach(() => {
    confirmSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it("命中 0 行 → 报「删除失败」，**一个附件都不删**、列表里那行留着", async () => {
    h.deleteResult = { data: [], error: null };
    renderPage();
    await waitFor(() => expect(screen.getByText("第五交响曲")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("删除 第五交响曲"));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("删除失败"));
    // 契约第 1 条：删除链必须能拿回被影响的行
    expect(h.deletes).toEqual([{ table: "sheet_music", cols: "id", selected: true }]);
    // 契约第 4 条：0 行检测之前不许删附件（否则库里还在、附件先没）
    expect(h.storageRemoves).toEqual([]);
    // 本地列表也不许移除：库里那行还在
    expect(screen.getByText("第五交响曲")).toBeInTheDocument();
  });

  it("命中 1 行 → 照常删附件并从列表移除（成功路径不回归）", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("第五交响曲")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("删除 第五交响曲"));

    await waitFor(() => expect(h.storageRemoves).toEqual([["s1/p1.pdf"]]));
    await waitFor(() => expect(screen.queryByText("第五交响曲")).not.toBeInTheDocument());
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
