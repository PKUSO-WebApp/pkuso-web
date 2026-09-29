/**
 * 生成一个唯一 id（UUID v4 形态）。
 *
 * ⚠️ **别在这个仓库里直接写 `crypto.randomUUID()`** —— 它标了 `[SecureContext]`，
 * 只有 **https 与 localhost** 才有。在 `http://192.168.x.x:3000` 这类**局域网地址**
 * 下真机测、老的内置 WebView、或 `window.crypto` 被动过的环境里它是 `undefined`，
 * 而这些调用点全在「点确认」这条主路径上 —— 实测后果是整个上传弹窗当场炸掉
 * （`TypeError: crypto.randomUUID is not a function`），谱务分析与上传一步都走不了。
 *
 * 兜底仍用真随机数：`crypto.getRandomValues` **没有**安全上下文限制（同属 Web Crypto，
 * 被那扇门挡住的只有 `randomUUID` 与 `subtle`）。只有连它都缺的环境才退回 `Math.random`。
 *
 * 这些 id 只做「行 / 存储对象的唯一键」（`{scoreId}/{storageId}.pdf`、分段的 `groupId`），
 * **不承担任何安全语义** —— 所以上面两级兜底都够用，不必为此引入 uuid 依赖。
 */

const BYTE_TO_HEX: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0"),
);

/** 把 16 字节按 RFC 4122 摆成 v4：第 7 字节高 4 位置版本号 0100，第 9 字节高 2 位置变体 10。 */
function uuidV4FromBytes(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => BYTE_TO_HEX[b]);
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export function randomId(): string {
  // `globalThis.crypto` 在非安全上下文里**存在**，只是少了 randomUUID（和 subtle）——
  // 所以这两级判断不能合并成「有没有 crypto」。
  const c = globalThis.crypto as Crypto | undefined;
  if (typeof c?.randomUUID === "function") return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return uuidV4FromBytes(bytes);
}
