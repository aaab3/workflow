/**
 * Simple Markdown renderer - converts markdown to styled HTML.
 * No external dependencies, handles the subset we use in the guide.
 */

interface MarkdownViewProps {
  content: string;
}

export function MarkdownView({ content }: MarkdownViewProps) {
  const html = markdownToHtml(content);

  return (
    <div
      dangerouslySetInnerHTML={{ __html: html }}
      style={{ fontSize: 13, lineHeight: 1.9, color: "var(--color-text)" }}
      className="markdown-body"
    />
  );
}

function markdownToHtml(md: string): string {
  let html = md;

  // Escape HTML entities first (but preserve our own tags)
  html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Code blocks (```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre style="background:#f8fafc;padding:12px 16px;border-radius:6px;font-size:11px;overflow-x:auto;border:1px solid #e2e8f0;margin:8px 0;line-height:1.6"><code>${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:1px 5px;border-radius:3px;font-size:11px;color:#e11d48">$1</code>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:14px;font-weight:700;margin:20px 0 8px;color:var(--color-text);border-bottom:1px solid #f1f5f9;padding-bottom:4px">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="font-size:16px;font-weight:700;margin:28px 0 12px;color:var(--color-text);border-bottom:2px solid var(--color-primary);padding-bottom:6px;display:inline-block">$1</h2><div></div>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="font-size:20px;font-weight:800;margin:0 0 8px">$1</h1>');

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote style="margin:12px 0;padding:10px 16px;border-left:4px solid var(--color-primary);background:#f0f9ff;border-radius:0 6px 6px 0;font-size:12px;color:#0369a1">$1</blockquote>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">');

  // Tables
  html = html.replace(/^\|(.+)\|$/gm, (match) => {
    const cells = match.split("|").filter(c => c.trim());
    const isHeader = cells.every(c => /^[\s-:]+$/.test(c));
    if (isHeader) return "<!-- table separator -->";
    const tag = "td";
    const cellsHtml = cells.map(c => `<${tag} style="padding:6px 10px;border:1px solid #e2e8f0;font-size:12px">${c.trim()}</${tag}>`).join("");
    return `<tr>${cellsHtml}</tr>`;
  });

  // Wrap consecutive table rows
  html = html.replace(/((?:<tr>.*<\/tr>\n?)+)/g, (match) => {
    const rows = match.trim().split("\n").filter(r => r.startsWith("<tr>"));
    if (rows.length === 0) return match;
    // First row as header
    const headerRow = rows[0]!.replace(/td/g, "th").replace(/style="[^"]*"/g, 'style="padding:6px 10px;border:1px solid #e2e8f0;font-size:11px;font-weight:600;background:#f8fafc;text-align:left"');
    const bodyRows = rows.slice(1).join("\n");
    return `<table style="width:100%;border-collapse:collapse;margin:8px 0"><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table>`;
  });

  // Remove table separator comments
  html = html.replace(/<!-- table separator -->\n?/g, "");

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li style="margin:2px 0;padding-left:4px">$1</li>');
  html = html.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul style="padding-left:20px;margin:6px 0">$1</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin:2px 0;padding-left:4px">$1</li>');

  // Paragraphs (lines that aren't already wrapped in tags)
  html = html.replace(/^(?!<[a-z]|$)(.+)$/gm, '<p style="margin:6px 0">$1</p>');

  // Clean up empty paragraphs
  html = html.replace(/<p style="margin:6px 0"><\/p>/g, "");

  return html;
}
