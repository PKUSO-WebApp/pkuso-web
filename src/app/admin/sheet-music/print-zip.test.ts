import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildPrintZip, printZipName } from "./print-zip";

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("buildPrintZip", () => {
  it("只打包 >0 份的文件，改名并处理重名；可选清单带 BOM", async () => {
    const blob = await buildPrintZip({
      entries: [
        { file_name: "a.pdf", storage_path: "s/a.pdf", copies: 2 },
        { file_name: "a.pdf", storage_path: "s/a2.pdf", copies: 1 },
        { file_name: "a.pdf", storage_path: "s/a3.pdf", copies: 1 },
        { file_name: "skip.pdf", storage_path: "s/skip.pdf", copies: 0 },
      ],
      manifest: "清单",
      load: async (path) => bytes(`content:${path}`),
    });

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file("2份_a.pdf")).toBeTruthy();
    expect(zip.file("1份_a.pdf")).toBeTruthy();
    expect(zip.file("1份_a_2.pdf")).toBeTruthy();
    expect(zip.file("0份_skip.pdf")).toBeNull();
    expect(await zip.file("2份_a.pdf")?.async("string")).toBe("content:s/a.pdf");

    const manifest = await zip.file("清单.txt")?.async("string");
    expect(manifest?.charCodeAt(0)).toBe(0xfeff);
    expect(manifest).toContain("清单");
  });

  it("不传 manifest 时不生成清单", async () => {
    const blob = await buildPrintZip({
      entries: [{ file_name: "a.pdf", storage_path: "s/a.pdf", copies: 1 }],
      load: async () => bytes("x"),
    });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file("清单.txt")).toBeNull();
  });
});

describe("printZipName", () => {
  it("用曲名做压缩包名，去掉非法字符", () => {
    expect(printZipName("红旗颂")).toBe("红旗颂_印制.zip");
    expect(printZipName("a/b:c")).toBe("a b c_印制.zip");
  });
});
