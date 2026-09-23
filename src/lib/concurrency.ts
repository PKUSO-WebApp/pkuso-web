/**
 * 有界并发池：最多同时有 `limit` 个 worker 在跑，**全部跑完才 resolve**。
 *
 * 存在的理由是**重叠网络等待**，不是让 CPU 并行：OCR 2~4s、LLM 2~5s、上传几 MB 的 PDF，
 * 这些时间里主线程基本闲着，串行跑等于把一段段等待排成队。浏览器里也没有别的并行可言 ——
 * 渲染与 JPEG 编码仍在主线程排队，并发不会让它们变快，只是不再挡着别的文件的网络往返。
 *
 * 不用「切片 + Promise.all」那种写法：切片里快的 worker 要等同片最慢的那个跑完才轮到下一片，
 * 整批速度被每片的最慢项拖住。这里是工作队列 —— 谁先空谁领下一项。
 *
 * worker 抛错**不中断其余项**（一个文件的意外失败不该让同批其余文件静默不跑），
 * 但这个池子也不兜错：全部跑完后把第一个错误抛出去。调用方的约定是**在 worker 内自己
 * try/catch**（本项目的两处调用都是如此）；只抛第一个是因为同时炸多个已属缺陷，
 * 不该被当成常态来支持。
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  // 钳到 [1, items.length]。不钳的话，`limit` 为 0 / NaN 时下面的 Array.from 会建出空数组：
  // 一个 worker 都不起，全部项**静默不跑却「跑完了」**。钳到 1 是退化成串行 —— 慢，
  // 但不会假装做过。
  //
  // ⚠️ `Infinity` **不是**「不限」（它过不了 Number.isFinite，同样退化成串行）。真要全放，
  // 直接传 `items.length`。
  //
  // 空数组不需要额外分支：`Math.min(0, …)` 恒为 0，一个 runner 都不会起。
  const size = Math.min(items.length, Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1);

  const failures: unknown[] = [];
  let next = 0;

  const run = async () => {
    for (;;) {
      // `next++` 在 await 之前同步求值，两个 runner 不会领到同一下标
      const i = next++;
      if (i >= items.length) return;
      try {
        await worker(items[i], i);
      } catch (err) {
        failures.push(err);
      }
    }
  };

  await Promise.all(Array.from({ length: size }, run));
  if (failures.length > 0) throw failures[0];
}
