/**
 * 把排练曲目列表压成 `rehearsals.repertoire` 的展示文本。
 *
 * 每个曲目可带一条「本次排练内容」：`肖斯塔科维奇第五交响曲` + `第一、第二乐章`
 * → `肖斯塔科维奇第五交响曲：第一、第二乐章`。有内容时用 `；` 分隔不同曲目，
 * 避免与内容里的 `、` 混淆；全都没有内容时沿用原来的 `、`，不改存量展示。
 */
export type RepertoireSummaryPiece = {
  title: string;
  content?: string | null;
};

export function formatRepertoireSummary(pieces: RepertoireSummaryPiece[]): string {
  const normalized = pieces
    .map((piece) => {
      const title = piece.title.trim();
      const content = (piece.content ?? "").trim();
      return title ? (content ? `${title}：${content}` : title) : "";
    })
    .filter(Boolean);

  if (normalized.length === 0) return "";
  const hasContent = pieces.some((piece) => (piece.content ?? "").trim());
  return normalized.join(hasContent ? "；" : "、");
}
