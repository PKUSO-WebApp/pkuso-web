/** 微信注册用户的合成邮箱域名：仍是合成邮箱视为「未填写邮箱」 */
const SYNTHETIC_EMAIL_SUFFIX = "@placeholder.local";

export function isSyntheticEmail(email: string | null | undefined): boolean {
  return !!email && email.endsWith(SYNTHETIC_EMAIL_SUFFIX);
}
