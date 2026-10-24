type RoleBadgeProps = {
  role: "section_leader" | "principal";
  size?: "sm" | "md";
};

const LABEL: Record<RoleBadgeProps["role"], string> = {
  section_leader: "🏅 声部长",
  principal: "🎻 首席",
};

const TONE: Record<RoleBadgeProps["role"], string> = {
  section_leader: "bg-warning-bg text-warning",
  principal: "bg-primary/10 text-primary",
};

const SIZE: Record<NonNullable<RoleBadgeProps["size"]>, string> = {
  sm: "px-1.5 text-caption",
  md: "px-2 text-xs",
};

/** 花名册/成员详情共用的角色徽章；角色 flag 只读，由角色表触发器维护。 */
export function RoleBadge({ role, size = "sm" }: RoleBadgeProps) {
  return <span className={`rounded-full py-0.5 ${SIZE[size]} ${TONE[role]}`}>{LABEL[role]}</span>;
}
