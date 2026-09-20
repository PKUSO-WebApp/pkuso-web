"use client";

import React, { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { Node, mergeAttributes } from "@tiptap/core";
import type { NodeViewRendererProps } from "@tiptap/core";

const PLACEHOLDER_CHIP_COLORS: Record<string, string> = {
  title: "bg-blue-100 text-blue-800",
  dateStr: "bg-green-100 text-green-800",
  location: "bg-amber-100 text-amber-800",
  signature: "bg-purple-100 text-purple-800",
  targetSection: "bg-pink-100 text-pink-800",
};

const PLACEHOLDER_ICONS: Record<string, string> = {
  title: "🎵",
  dateStr: "📅",
  location: "📍",
  signature: "✍️",
  targetSection: "🎻",
};

const PlaceholderNode = Node.create({
  name: "placeholder",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      name: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span.placeholder-chip",
        getAttrs: (element: HTMLElement | string) => {
          if (typeof element === "string") return {};
          const name = element.getAttribute("data-placeholder-name");
          return name ? { name } : {};
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, string> }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "placeholder-chip",
        "data-placeholder-name": HTMLAttributes.name,
        contenteditable: "false",
      }),
      `{${HTMLAttributes.name}}`,
    ];
  },
  addNodeView() {
    return (props: NodeViewRendererProps) => {
      const { node, editor, getPos } = props;
      const name = node.attrs.name;
      const colorClass = PLACEHOLDER_CHIP_COLORS[name] || "bg-gray-100 text-gray-800";
      const icon = PLACEHOLDER_ICONS[name] || "📝";

      const dom = document.createElement("span");
      dom.className = `inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${colorClass} text-xs font-medium cursor-pointer select-none transition-colors`;
      dom.contentEditable = "false";
      dom.dataset.placeholderName = name;
      dom.innerHTML = `<span>${icon}</span><span>{${name}}</span>`;

      dom.addEventListener("click", (e) => {
        e.stopPropagation();
        const pos = getPos();
        if (pos !== undefined) {
          editor
            .chain()
            .focus()
            .deleteRange({ from: pos, to: pos + 1 })
            .run();
        }
      });

      return {
        dom,
        destroy: () => {},
      };
    };
  },
});

interface PlaceholderButtonProps {
  editor: ReturnType<typeof useEditor> | null;
  name: string;
  label: string;
  disabled?: boolean;
  onInsert: (placeholder: string) => void;
}

function PlaceholderButton({ name, label, disabled, onInsert }: PlaceholderButtonProps) {
  const colorClass = PLACEHOLDER_CHIP_COLORS[name] || "bg-gray-100 text-gray-800";
  const icon = PLACEHOLDER_ICONS[name] || "📝";

  const handleClick = () => {
    if (disabled) return;
    onInsert(`{${name}}`);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded ${colorClass} text-xs font-medium hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity`}
      title={`插入 ${label}`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

interface ToolbarProps {
  editor: ReturnType<typeof useEditor> | null;
  disabled?: boolean;
}

function Toolbar({ editor, disabled }: ToolbarProps) {
  if (!editor) return null;

  const canUndo = editor.can().undo();
  const canRedo = editor.can().redo();

  return (
    <div className="flex flex-wrap gap-2 mb-2 p-2 bg-muted/50 rounded-xl border border-border">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={disabled || !editor.can().toggleBold()}
          className={`px-2 py-1 rounded text-xs font-bold ${editor.isActive("bold") ? "bg-primary text-primary-foreground" : "text-text-muted hover:bg-muted"}`}
          title="加粗 (Ctrl+B)"
        >
          B
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={disabled || !editor.can().toggleItalic()}
          className={`px-2 py-1 rounded text-xs ${editor.isActive("italic") ? "bg-primary text-primary-foreground" : "text-text-muted hover:bg-muted"} font-italic`}
          title="斜体 (Ctrl+I)"
        >
          I
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          disabled={disabled || !editor.can().toggleUnderline()}
          className={`px-2 py-1 rounded text-xs ${editor.isActive("underline") ? "bg-primary text-primary-foreground" : "text-text-muted hover:bg-muted"} underline`}
          title="下划线 (Ctrl+U)"
        >
          U
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          disabled={disabled || !editor.can().toggleStrike()}
          className={`px-2 py-1 rounded text-xs ${editor.isActive("strike") ? "bg-primary text-primary-foreground" : "text-text-muted hover:bg-muted"} line-through`}
          title="删除线"
        >
          S
        </button>
      </div>

      <div className="w-px h-6 bg-border mx-1" />

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          disabled={disabled || !editor.can().toggleHeading({ level: 2 })}
          className={`px-2 py-1 rounded text-xs ${editor.isActive("heading", { level: 2 }) ? "bg-primary text-primary-foreground" : "text-text-muted hover:bg-muted"}`}
          title="标题 2"
        >
          H2
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          disabled={disabled || !editor.can().toggleHeading({ level: 3 })}
          className={`px-2 py-1 rounded text-xs ${editor.isActive("heading", { level: 3 }) ? "bg-primary text-primary-foreground" : "text-text-muted hover:bg-muted"}`}
          title="标题 3"
        >
          H3
        </button>
      </div>

      <div className="w-px h-6 bg-border mx-1" />

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          disabled={disabled || !editor.can().toggleBulletList()}
          className={`px-2 py-1 rounded text-xs ${editor.isActive("bulletList") ? "bg-primary text-primary-foreground" : "text-text-muted hover:bg-muted"}`}
          title="无序列表"
        >
          •●
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          disabled={disabled || !editor.can().toggleOrderedList()}
          className={`px-2 py-1 rounded text-xs ${editor.isActive("orderedList") ? "bg-primary text-primary-foreground" : "text-text-muted hover:bg-muted"}`}
          title="有序列表"
        >
          1.
        </button>
      </div>

      <div className="w-px h-6 bg-border mx-1" />

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={disabled || !canUndo}
          className="px-2 py-1 rounded text-xs text-text-muted hover:bg-muted disabled:opacity-50"
          title="撤销 (Ctrl+Z)"
        >
          ↩
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={disabled || !canRedo}
          className="px-2 py-1 rounded text-xs text-text-muted hover:bg-muted disabled:opacity-50"
          title="重做 (Ctrl+Y)"
        >
          ↪
        </button>
      </div>
    </div>
  );
}

interface PreviewProps {
  subject: string;
  html: string;
  placeholders: Record<string, string>;
}

function Preview({ subject, html, placeholders }: PreviewProps) {
  const previewSubject = React.useMemo(() => {
    let result = subject;
    Object.entries(placeholders).forEach(([key, value]) => {
      const escapedValue = value
        .replace(/&/g, "\u0026amp;")
        .replace(/</g, "\u0026lt;")
        .replace(/>/g, "\u0026gt;")
        .replace(/"/g, "\u0026quot;")
        .replace(/'/g, "\u0026#39;");
      result = result.replace(new RegExp(`\\{${key}\\}`, "g"), escapedValue);
    });
    return result;
  }, [subject, placeholders]);

  const previewHtml = React.useMemo(() => {
    let result = html;
    Object.entries(placeholders).forEach(([key, value]) => {
      const escapedValue = value
        .replace(/&/g, "\u0026amp;")
        .replace(/</g, "\u0026lt;")
        .replace(/>/g, "\u0026gt;")
        .replace(/"/g, "\u0026quot;")
        .replace(/'/g, "\u0026#39;");
      result = result.replace(new RegExp(`\\{${key}\\}`, "g"), escapedValue);
    });
    return result;
  }, [html, placeholders]);

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-white">
      <div className="px-3 py-2 bg-muted/50 border-b border-border text-xs text-text-muted">
        邮件预览（示例数据）
      </div>
      <div className="p-3 border-b border-border bg-muted/30">
        <div className="text-xs font-medium text-text-muted mb-1">邮件主题</div>
        <div className="text-sm text-text">{previewSubject || "（空）"}</div>
      </div>
      <div
        className="p-4 max-h-[400px] overflow-y-auto"
        dangerouslySetInnerHTML={{ __html: previewHtml }}
      />
    </div>
  );
}

interface EmailTemplateEditorProps {
  subject: string;
  body: string;
  onSubjectChange: (subject: string) => void;
  onBodyChange: (body: string) => void;
  placeholders?: Array<{ name: string; label: string; example: string; fullBody?: boolean }>;
  templateType?: "full" | "section";
  disabled?: boolean;
  onPlaceholderInsert?: (placeholder: string) => void;
}

export function EmailTemplateEditor({
  subject,
  body,
  onSubjectChange,
  onBodyChange,
  placeholders = [],
  templateType = "section",
  disabled = false,
}: EmailTemplateEditorProps) {
  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null);
  const prevBodyRef = useRef(body);
  const isInternalChangeRef = useRef(false);
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const [activeField, setActiveField] = useState<"subject" | "body" | null>(null);
  const [lastActiveField, setLastActiveField] = useState<"subject" | "body" | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      PlaceholderNode,
    ],
    content: body,
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[300px] p-3 bg-white",
      },
    },
    onUpdate: ({ editor }) => {
      isInternalChangeRef.current = true;
      const html = editor.getHTML();
      onBodyChange(html);
      // Reset after a tick to allow parent to update
      setTimeout(() => {
        isInternalChangeRef.current = false;
      }, 0);
    },
    onCreate: ({ editor }) => {
      editorRef.current = editor;
    },
    onBlur: () => {
      setActiveField(null);
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (editor && body !== prevBodyRef.current && !isInternalChangeRef.current) {
      prevBodyRef.current = body;
      editor.commands.setContent(body, { emitUpdate: false });
    } else if (body === prevBodyRef.current) {
      // Keep ref in sync when parent doesn't change
      prevBodyRef.current = body;
    }
  }, [body, editor]);

  const handleSubjectFocus = () => {
    setActiveField("subject");
    setLastActiveField("subject");
  };

  const handleSubjectBlur = () => {
    setActiveField(null);
  };

  const handleBodyFocus = () => {
    setActiveField("body");
    setLastActiveField("body");
  };

  const handlePlaceholderInsert = (placeholder: string) => {
    const targetField = lastActiveField ?? activeField;
    if (targetField === "subject") {
      const input = subjectInputRef.current;
      if (input) {
        const start = input.selectionStart ?? 0;
        const end = input.selectionEnd ?? 0;
        input.setRangeText(placeholder, start, end, "end");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      }
    } else if (targetField === "body" && editor) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "placeholder",
          attrs: { name: placeholder.slice(1, -1) },
        })
        .run();
    }
  };

  const previewPlaceholders = placeholders.reduce(
    (acc, p) => {
      acc[p.name] = p.example;
      return acc;
    },
    {} as Record<string, string>,
  );

  const filteredPlaceholders =
    templateType === "full" ? placeholders.filter((p) => p.name !== "targetSection") : placeholders;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-xs font-medium text-text-muted">邮件主题</label>
        <input
          ref={subjectInputRef}
          type="text"
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          onFocus={handleSubjectFocus}
          onBlur={handleSubjectBlur}
          disabled={disabled}
          placeholder="如：[排练通知] {title}"
          className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted disabled:opacity-50"
          maxLength={200}
        />
      </div>

      <label className="block text-xs font-medium text-text-muted">邮件正文</label>

      <Toolbar editor={editor} disabled={disabled} />

      <EditorContent editor={editor} onFocus={handleBodyFocus} />

      <Preview subject={subject} html={body} placeholders={previewPlaceholders} />

      <div className="flex flex-wrap gap-2 p-2 bg-muted/50 rounded-xl border border-border">
        <span className="text-xs text-text-muted self-center">插入占位符：</span>
        {filteredPlaceholders.map((ph) => (
          <PlaceholderButton
            key={ph.name}
            editor={editor}
            name={ph.name}
            label={ph.label}
            disabled={disabled || lastActiveField === null}
            onInsert={handlePlaceholderInsert}
          />
        ))}
      </div>
    </div>
  );
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  Object.entries(vars).forEach(([key, value]) => {
    const escapedValue = value
      .replace(/&/g, "\u0026amp;")
      .replace(/</g, "\u0026lt;")
      .replace(/>/g, "\u0026gt;")
      .replace(/"/g, "\u0026quot;")
      .replace(/'/g, "\u0026#39;");
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), escapedValue);
  });
  return result;
}
