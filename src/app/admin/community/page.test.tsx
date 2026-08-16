/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import AdminCommunityPage from "./page";
import { usePosts } from "@/hooks/usePosts";
import { supabase } from "@/lib/supabase";

vi.mock("@/hooks/usePosts", () => ({
  usePosts: vi.fn(),
}));

vi.mock("@/components/ui/Toggle", () => ({
  Toggle: vi.fn(() => <div data-testid="toggle" />),
}));

vi.mock("@/context/user-context", () => ({
  useUser: () => ({ user: { id: "admin-id", role: "admin" }, logout: vi.fn() }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: {
      from: vi.fn().mockReturnValue({
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  },
}));

const mockUsePosts = vi.mocked(usePosts);
const storageFromMock = vi.mocked(supabase.storage.from);

// jsdom 未实现 blob URL API，手动补齐（closeEdit/换图回收 blob URL 时调用）
URL.revokeObjectURL = vi.fn();

const UPLOAD_URL = "https://mock.supabase.co/storage/v1/object/public/community-images/new.png";
const OLD_IMAGE_URL =
  "https://mock.supabase.co/storage/v1/object/public/community-images/old-qr.png";

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    title: "测试公告",
    type: "ensemble",
    content: "测试内容",
    image_url: null,
    author_id: "user-1",
    created_at: "2026-01-01T00:00:00+08:00",
    contact_info: "wx-id",
    current_sections: null,
    missing_sections: null,
    is_locked: false,
    profiles: { full_name: "张三", instrument: "小提琴" },
    ...overrides,
  };
}

function renderPage(data: unknown[] = []) {
  mockUsePosts.mockReturnValue({
    data,
    loading: false,
    error: null,
    saving: false,
    fetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue(true),
    remove: vi.fn(),
    uploadImage: vi.fn().mockResolvedValue({ url: UPLOAD_URL }),
  });
  return render(<AdminCommunityPage />);
}

describe("AdminCommunityPage 社区管理", () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("页面根容器为 flex 列布局且占满视口高度（Issue #146）", () => {
    const { container } = renderPage();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("flex-col");
    expect(root.className).toContain("h-full");
  });

  it("帖子列表 section 可独立滚动（flex-1 + overflow-y-auto）", () => {
    const { container } = renderPage();
    const section = container.querySelector("section") as HTMLElement | null;
    expect(section).toBeTruthy();
    expect(section!.className).toContain("flex-1");
    expect(section!.className).toContain("overflow-y-auto");
  });

  it("编辑弹窗显示当前图片（Issue #157）", () => {
    const imageUrl =
      "https://mock.supabase.co/storage/v1/object/public/community-images/old-qr.png";
    renderPage([makePost({ image_url: imageUrl })]);
    fireEvent.click(screen.getByText("编辑"));
    const img = screen.getByAltText("图片预览") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(imageUrl);
  });

  it("更换图片：选新文件后保存，先上传再以新 URL 提交（Issue #157）", async () => {
    // jsdom 未实现 createObjectURL，手动补齐
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    const mockUpdate = vi.fn().mockResolvedValue(true);
    const mockUploadImage = vi.fn().mockResolvedValue({ url: UPLOAD_URL });
    mockUsePosts.mockReturnValue({
      data: [makePost()],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      create: vi.fn(),
      update: mockUpdate,
      remove: vi.fn(),
      uploadImage: mockUploadImage,
    });
    const { container } = render(<AdminCommunityPage />);
    fireEvent.click(screen.getByText("编辑"));

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "qr.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", { value: [file] });
    fireEvent.change(fileInput);

    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => {
      expect(mockUploadImage).toHaveBeenCalledWith(file, "admin-id");
      expect(mockUpdate).toHaveBeenCalledWith(
        "post-1",
        expect.objectContaining({ image_url: UPLOAD_URL }),
      );
    });
  });

  it("更换图片：保存成功后以旧路径清理 storage 附件（换图删旧，同 Issue #149 语义）", async () => {
    // jsdom 未实现 createObjectURL，手动补齐
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    const encodedName = encodeURIComponent("旧图.png");
    const oldImageUrl = `https://mock.supabase.co/storage/v1/object/public/community-images/${encodedName}`;
    const mockUpdate = vi.fn().mockResolvedValue(true);
    const mockUploadImage = vi.fn().mockResolvedValue({ url: UPLOAD_URL });
    mockUsePosts.mockReturnValue({
      data: [makePost({ image_url: oldImageUrl })],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      create: vi.fn(),
      update: mockUpdate,
      remove: vi.fn(),
      uploadImage: mockUploadImage,
    });
    const { container } = render(<AdminCommunityPage />);
    fireEvent.click(screen.getByText("编辑"));

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "qr.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", { value: [file] });
    fireEvent.change(fileInput);

    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        "post-1",
        expect.objectContaining({ image_url: UPLOAD_URL }),
      );
    });
    // storage 附件清理：旧路径被删除（decodeURIComponent 解出原始文件名）
    await waitFor(() => {
      expect(storageFromMock).toHaveBeenCalledWith("community-images");
      const removeMock = storageFromMock.mock.results[0].value.remove as ReturnType<typeof vi.fn>;
      expect(removeMock).toHaveBeenCalledWith(["旧图.png"]);
    });
  });

  it("上传期间取消/保存按钮禁用，遮罩与关闭请求被拦截（上传阶段纳入提交锁定）", async () => {
    // jsdom 未实现 createObjectURL，手动补齐
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    // 上传挂起（pending），模拟上传中阶段
    let resolveUpload: ((v: { url: string }) => void) | undefined;
    const mockUploadImage = vi.fn(
      () =>
        new Promise<{ url: string }>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const mockUpdate = vi.fn().mockResolvedValue(true);
    mockUsePosts.mockReturnValue({
      // 帖子带原图：编辑弹窗需渲染「删除图片」按钮，才能断言其上传期间禁用
      data: [makePost({ image_url: OLD_IMAGE_URL })],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      create: vi.fn(),
      update: mockUpdate,
      remove: vi.fn(),
      uploadImage: mockUploadImage,
    });
    const { container } = render(<AdminCommunityPage />);
    fireEvent.click(screen.getByText("编辑"));

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "qr.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", { value: [file] });
    fireEvent.change(fileInput);

    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => {
      expect(mockUploadImage).toHaveBeenCalled();
    });

    // 上传挂起期间：取消/保存按钮均禁用（双重 guard 防止中途退出误清表单）
    expect((screen.getByText("取消") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("保存中…") as HTMLButtonElement).disabled).toBe(true);
    // 上传挂起期间：file input 与「删除图片」按钮同样禁用，杜绝上传中换图/删图
    expect((container.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByText("删除图片") as HTMLButtonElement).disabled).toBe(true);
    // 遮罩关闭被禁用：关闭按钮（aria-label="关闭弹窗"）不再渲染
    expect(screen.queryByLabelText("关闭弹窗")).toBeNull();
    // 标题栏「关闭」按钮点击被 closeEdit 拦截，弹窗保持打开
    fireEvent.click(screen.getByText("关闭"));
    expect(screen.getByText("编辑公告")).toBeTruthy();

    // 上传完成后正常收尾：update 提交成功并关闭弹窗
    resolveUpload!({ url: UPLOAD_URL });
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        "post-1",
        expect.objectContaining({ image_url: UPLOAD_URL }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("编辑公告")).toBeNull();
    });
  });

  it("删除图片：保存后 image_url 置 null 且清理 storage 附件（Issue #157）", async () => {
    const encodedName = encodeURIComponent("杨图.png");
    const oldImageUrl = `https://mock.supabase.co/storage/v1/object/public/community-images/${encodedName}`;
    const mockUpdate = vi.fn().mockResolvedValue(true);
    mockUsePosts.mockReturnValue({
      data: [makePost({ image_url: oldImageUrl })],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      create: vi.fn(),
      update: mockUpdate,
      remove: vi.fn(),
      uploadImage: vi.fn(),
    });
    render(<AdminCommunityPage />);
    fireEvent.click(screen.getByText("编辑"));
    fireEvent.click(screen.getByText("删除图片"));
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        "post-1",
        expect.objectContaining({ image_url: null }),
      );
    });
    // storage 附件清理：路径提取方式同 usePosts.remove（decodeURIComponent）
    await waitFor(() => {
      expect(storageFromMock).toHaveBeenCalledWith("community-images");
      const removeMock = storageFromMock.mock.results[0].value.remove as ReturnType<typeof vi.fn>;
      expect(removeMock).toHaveBeenCalledWith(["杨图.png"]);
    });
  });
});
