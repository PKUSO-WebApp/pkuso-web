/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FileNameLink } from "./file-name-link";

const pdf = () => new File([new Uint8Array([1])], "圆号1,2.pdf", { type: "application/pdf" });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("上传弹窗的文件名：点它在新标签页打开这一行的 PDF", () => {
  it("可点的只有文件名；打开的是它自己的 blob URL", () => {
    const create = vi.fn(() => "blob:sheet");
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const win = { opener: window };
    const open = vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);

    const file = pdf();
    render(<FileNameLink file={file} name="圆号1,2.pdf" />);
    fireEvent.click(screen.getByRole("button", { name: "圆号1,2.pdf" }));

    // 传的是**这一行**的文件对象，不是别的行 / storage 里的东西
    expect(create).toHaveBeenCalledWith(file);
    expect(open).toHaveBeenCalledWith("blob:sheet", "_blank");
    expect(win.opener).toBeNull();
    // 成功路径不立刻回收：新标签页还没加载完
    expect(revoke).not.toHaveBeenCalled();
  });

  it("弹窗被拦下时给可见反馈，并立刻回收 blob URL（失败不静默）", () => {
    const create = vi.fn(() => "blob:sheet");
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    vi.spyOn(window, "open").mockReturnValue(null);

    render(<FileNameLink file={pdf()} name="圆号1,2.pdf" />);
    fireEvent.click(screen.getByRole("button", { name: "圆号1,2.pdf" }));

    expect(screen.getByRole("alert").textContent).toBe("浏览器拦截了新标签页，请允许弹窗后重试");
    expect(revoke).toHaveBeenCalledWith("blob:sheet");
  });
});
