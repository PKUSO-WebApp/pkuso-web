export const EMAIL_TEMPLATE_FULL_SUBJECT_KEY = "email_template_full_subject";
export const EMAIL_TEMPLATE_FULL_BODY_KEY = "email_template_full_body";
export const EMAIL_TEMPLATE_SECTION_SUBJECT_KEY = "email_template_section_subject";
export const EMAIL_TEMPLATE_SECTION_BODY_KEY = "email_template_section_body";

export const EMAIL_TEMPLATE_MAX_LENGTH = 5000;

export const DEFAULT_FULL_SUBJECT = "[排练通知] {title}";
export const DEFAULT_FULL_BODY = `<h2>排练通知</h2>
<p><strong>曲目：</strong>{title}</p>
<p><strong>时间：</strong>{dateStr}</p>
<p><strong>地点：</strong>{location}</p>
<p>请各位团员准时出席！</p>
<p style="margin-top:24px;color:#666;">——<br/>{signature}</p>`;

export const DEFAULT_SECTION_SUBJECT = "[排练通知] {title}（{targetSection}）";
export const DEFAULT_SECTION_BODY = `<h2>排练通知</h2>
<p><strong>声部：</strong>{targetSection}</p>
<p><strong>曲目：</strong>{title}</p>
<p><strong>时间：</strong>{dateStr}</p>
<p><strong>地点：</strong>{location}</p>
<p>请各位团员准时出席！</p>
<p style="margin-top:24px;color:#666;">——<br/>{signature}</p>`;

export interface PlaceholderDef {
  name: string;
  label: string;
  example: string;
  availableInSubject: boolean;
  availableInBody: boolean;
  fullBody?: boolean;
}

export const PLACEHOLDERS: PlaceholderDef[] = [
  {
    name: "title",
    label: "曲目",
    example: "柴四第四乐章",
    availableInSubject: true,
    availableInBody: true,
    fullBody: true,
  },
  {
    name: "dateStr",
    label: "时间",
    example: "2026-09-20 19:00",
    availableInSubject: true,
    availableInBody: true,
    fullBody: true,
  },
  {
    name: "location",
    label: "地点",
    example: "新太阳B108",
    availableInSubject: true,
    availableInBody: true,
    fullBody: true,
  },
  {
    name: "signature",
    label: "签名",
    example: "北京大学交响乐团管理团队",
    availableInSubject: true,
    availableInBody: true,
    fullBody: true,
  },
  {
    name: "targetSection",
    label: "声部",
    example: "第一小提琴",
    availableInSubject: true,
    availableInBody: true,
    fullBody: false,
  },
];

export function getPlaceholderByName(name: string): PlaceholderDef | undefined {
  return PLACEHOLDERS.find((p) => p.name === name);
}

export function getPlaceholdersForSubject(): PlaceholderDef[] {
  return PLACEHOLDERS.filter((p) => p.availableInSubject);
}

export function getPlaceholdersForBody(): PlaceholderDef[] {
  return PLACEHOLDERS.filter((p) => p.availableInBody);
}

export type TemplateType = "full" | "section";

export function getTemplateKeys(type: TemplateType): { subjectKey: string; bodyKey: string } {
  if (type === "full") {
    return { subjectKey: EMAIL_TEMPLATE_FULL_SUBJECT_KEY, bodyKey: EMAIL_TEMPLATE_FULL_BODY_KEY };
  }
  return {
    subjectKey: EMAIL_TEMPLATE_SECTION_SUBJECT_KEY,
    bodyKey: EMAIL_TEMPLATE_SECTION_BODY_KEY,
  };
}

export function getDefaultTemplate(type: TemplateType): { subject: string; body: string } {
  if (type === "full") {
    return { subject: DEFAULT_FULL_SUBJECT, body: DEFAULT_FULL_BODY };
  }
  return { subject: DEFAULT_SECTION_SUBJECT, body: DEFAULT_SECTION_BODY };
}
