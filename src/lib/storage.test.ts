import { describe, it, expect } from "vitest";
import { STORAGE_BUCKETS, storagePathFromUrl, sheetMusicPath } from "./storage";

/**
 * 这个模块的两件事都**只会静默出错**：bucket 名写错、路径抠错时，
 * 上传照常成功而删除悄悄失败（界面上「删了，存储里还在」）。
 * 所以用例的重点是「认不出来时**返回 null**」，而不是「尽量抠出一个路径」。
 */
describe("storagePathFromUrl", () => {
  const PUBLIC_PREFIX = "https://x.supabase.co/storage/v1/object/public";

  it("从公开 URL 里抠出对象路径", () => {
    expect(
      storagePathFromUrl(
        `${PUBLIC_PREFIX}/community-images/u1/1730000000-a.png`,
        STORAGE_BUCKETS.communityImages,
      ),
    ).toBe("u1/1730000000-a.png");
  });

  it("中文对象名要解码（编码后的键直接拿去删会删不掉，且没有报错）", () => {
    const url = `${PUBLIC_PREFIX}/community-images/u1/%E5%B1%8F%E5%B9%95%E6%88%AA%E5%9B%BE.png`;
    expect(storagePathFromUrl(url, STORAGE_BUCKETS.communityImages)).toBe("u1/屏幕截图.png");
  });

  it("路径里再出现 bucket 名时，取第一处（与旧实现 indexOf 语义一致）", () => {
    const url = `${PUBLIC_PREFIX}/sheet-music/s1/sheet-music/2.pdf`;
    expect(storagePathFromUrl(url, STORAGE_BUCKETS.sheetMusic)).toBe("s1/sheet-music/2.pdf");
  });

  it("bucket 对不上就返回 null（不猜）", () => {
    const url = `${PUBLIC_PREFIX}/community-images/u1/a.png`;
    expect(storagePathFromUrl(url, STORAGE_BUCKETS.sheetMusic)).toBeNull();
  });

  it("空值 / 不是 URL 的串都返回 null", () => {
    expect(storagePathFromUrl(null, STORAGE_BUCKETS.communityImages)).toBeNull();
    expect(storagePathFromUrl(undefined, STORAGE_BUCKETS.communityImages)).toBeNull();
    expect(storagePathFromUrl("", STORAGE_BUCKETS.communityImages)).toBeNull();
    expect(storagePathFromUrl("not-a-url", STORAGE_BUCKETS.communityImages)).toBeNull();
  });

  it("bucket 后面什么都没有 → null（否则会拿空串去删，等于删不到）", () => {
    expect(
      storagePathFromUrl(`${PUBLIC_PREFIX}/community-images/`, STORAGE_BUCKETS.communityImages),
    ).toBeNull();
  });

  it("非法百分号编码退回原串（历史脏数据仍要能删）", () => {
    const url = `${PUBLIC_PREFIX}/community-images/u1/%zz.png`;
    expect(storagePathFromUrl(url, STORAGE_BUCKETS.communityImages)).toBe("u1/%zz.png");
  });
});

describe("sheetMusicPath", () => {
  it("是 {scoreId}/{storageId}.pdf", () => {
    expect(sheetMusicPath("score-1", "row-9")).toBe("score-1/row-9.pdf");
  });

  it("不含调用方给的名字 —— 键里只允许 id（中文名会被 storage 拒掉）", () => {
    const p = sheetMusicPath("s", "r");
    expect(p).toMatch(/^[^/]+\/[^/]+\.pdf$/);
  });
});

describe("STORAGE_BUCKETS", () => {
  it("值就是线上真实的 bucket 名（改这里等于改存储路径，别顺手改）", () => {
    expect(STORAGE_BUCKETS).toEqual({
      sheetMusic: "sheet-music",
      communityImages: "community-images",
    });
  });
});
