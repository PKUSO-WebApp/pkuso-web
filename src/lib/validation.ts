/**
 * 表单校验工具（纯函数，可单测）
 */

/**
 * 手机号校验：`^1\d{10}$`（11 位、以 1 开头、数字连续无横杠）。
 *
 * 注意：这是暂时的 trade-off——只覆盖中国大陆手机号的基础格式，
 * 未校验号段合法性（如 13x/15x/18x 等）、未处理 +86 前缀或空格/横杠分隔等
 * 更复杂场景。未来如业务需要更严谨的手机号判断逻辑，应在此处迭代。
 */
export function isValidPhoneNumber(phone: string): boolean {
  return /^1\d{10}$/.test(phone.trim());
}
