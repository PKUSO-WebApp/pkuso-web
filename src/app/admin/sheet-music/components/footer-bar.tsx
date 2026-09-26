import type { UploadFile } from "../upload-modal.types";

/**
 * 弹窗底部的操作行（「识别分段 / 取消 / 确认上传」那一排）。
 *
 * ⚠️ **这些值是 props、不是在这里重算的**：`uploadableCount` / `allDone` / `hasAnalyzingFiles` /
 * `refiningCount` 全都由父组件算好。本仓栽过「同一条判据有几份拷贝，只有一份有测试」的坑 ——
 * 把判据复制进这里，就等于又多一份没人盯的拷贝（按钮该灰不灰、该禁用不禁用都属于那类事故）。
 * 这里只负责**渲染**：给什么值就画什么。
 */
type FooterBarProps = {
  phase: "select" | "analyzing" | "confirm" | "uploading";
  /** 行数。按钮文案里的分母（`确认上传（N/总数）`） */
  totalCount: number;
  /** 能上传的行数：既是分子，也是「确认上传」能不能点的判据之一 */
  uploadableCount: number;
  /** 已传完的行数（`allDone` 的分子） */
  doneCount: number;
  /** 全干完了：收尾给一个正向出口，而不是继续显示禁用的「确认上传（0/N）」 */
  allDone: boolean;
  /** 还有行在分析中 —— 与「攥着下标飞行」那条纪律有关，禁用判据之一 */
  hasAnalyzingFiles: boolean;
  segBusy: boolean;
  /** 段级识别还在飞的行数。> 0 时「确认上传」必须禁用（否则按没号的快照落库） */
  refiningCount: number;
  /** 待分段的行（`{ f, i }`）。长度决定按钮在不在、写几次 OCR */
  segTargets: { f: UploadFile; i: number }[];
  segCost: number;
  onClose: () => void;
  onStartSegmentation: () => void;
  onConfirmUpload: () => void;
};

export function FooterBar({
  phase,
  totalCount,
  uploadableCount,
  doneCount,
  allDone,
  hasAnalyzingFiles,
  segBusy,
  refiningCount,
  segTargets,
  segCost,
  onClose,
  onStartSegmentation,
  onConfirmUpload,
}: FooterBarProps) {
  return (
    <div className="flex justify-end gap-3 pt-2 border-t border-border">
      {/* 分段**不自动跑**：一份 N 页的合订谱要烧 N 次 OCR，而免费档是 500 次/天/IP。
          所以这个按钮把代价写在脸上（#290 验收标准：调用次数在导入前可见）。
          ⚠️ 不打 `mr-auto`：操作行按 #182 一律靠右下角，不许左右两端分布。 */}
      {segTargets.length > 0 && !allDone && (
        <button
          onClick={onStartSegmentation}
          // ⚠️ **`hasAnalyzingFiles` 不能少**（2026-09-25）：切点判出后这个函数会
          // **自动拆行**，而拆分改变 `files` 长度 —— 逐行重试恰是「攥着下标飞行」的
          // 长任务，行集一平移，重试结果就写进别的行、被重试那行永远停在「分析中」
          // →`hasAnalyzingFiles` 恒真 →「确认上传」永久禁用。
          // 与「还原为一份」「确认这 N 段」两处是同一条纪律（不在注释里写行号 ——
          // 它们每改一次就腐烂一次，本行自己就烂过一次）。
          // 改动前这个按钮只写 `segState`、不动行集，所以漏了它也不会出事。
          disabled={phase === "analyzing" || phase === "uploading" || segBusy || hasAnalyzingFiles}
          className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted disabled:opacity-50"
          title="合订谱里可能装着好几份分谱。识别出边界后会直接拆成几份，各自识别、各自上传。"
        >
          {segTargets.some(({ f }) => f.segState === "running")
            ? "识别分段中..."
            : `识别分段（${segTargets.length} 份，约 ${segCost} 次 OCR）`}
        </button>
      )}
      <button onClick={onClose} className="px-4 py-2 text-text-muted hover:text-text">
        {phase === "analyzing" ? "取消分析" : "取消"}
      </button>
      {/* 分析期间就把「确认上传」显示出来、但禁用：让用户看得见终点在哪、
          还差几个文件，而不是对着一个转圈图标猜还要等多久。 */}
      {phase === "uploading" ? (
        <button
          disabled
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg opacity-50"
        >
          {/* ⚠️ 转圈而不是「…」（用户实测反馈）：省略号是**静止**的，看不出还在动 ——
              上传十几份谱要等一会儿，静止的三个点读起来就是「卡住了」。
              用 `admin/layout.tsx` 守护页那套纯 CSS 转圈（border + animate-spin），
              不引图标依赖。颜色取 `border-primary-foreground`，与本按钮的前景色一致。 */}
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden
              className="animate-spin rounded-full h-4 w-4 border-2 border-primary-foreground border-t-transparent shrink-0"
            />
            上传中
          </span>
        </button>
      ) : allDone ? (
        // 干完了就给一个**正向出口**：全部传完后还显示禁用的「确认上传（0/N）」
        // 会让用户以为没成功，而唯一能点的是「取消」。
        <button
          onClick={onClose}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
        >
          完成（已上传 {doneCount} 个）
        </button>
      ) : (
        <button
          onClick={onConfirmUpload}
          // ⚠️ `refiningCount` 不能漏：段级识别还在飞时上传，`uploadOne` 会按
          // 点击那一刻的行算出**没号**的 `file_name` / `sub_parts` 落库，
          // 而屏幕上那几秒后就有号了 —— 界面与库从此对不上且没人回退（见 `refiningCount`）。
          disabled={
            phase === "analyzing" ||
            uploadableCount === 0 ||
            hasAnalyzingFiles ||
            segBusy ||
            refiningCount > 0
          }
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {/* 灰着必须给理由：段级识别在飞时那几行看起来是「已识别、可直接传」的
              （它们继承了源行的乐器名），只灰不说是本文件明确反对的写法。
              同一文件里「识别分段」用的也是这个「动词中...」的写法。 */}
          {refiningCount > 0 ? "识别各段中..." : `确认上传（${uploadableCount}/${totalCount}）`}
        </button>
      )}
    </div>
  );
}
