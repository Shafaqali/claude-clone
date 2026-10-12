function escapeHtml(value) {
  return value.replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function renderInline(value = "") {
  return value
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

export function renderMarkdown(input = "") {
  const codeBlocks = [];
  let text = input.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const id = codeBlocks.length;
    codeBlocks.push({ lang: lang || "code", code: code.trimEnd() });
    return `@@CODE_${id}@@`;
  });

  const html = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map(line => renderInline(line)).join("<br>")}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const tag = list.type;
    html.push(`<${tag}>${list.items.map(item => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`);
    list = null;
  };

  escapeHtml(text).split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    const listItem = line.match(/^\s*(?:([-*])|(\d+)\.)\s+(.+)$/);
    const quote = trimmed.match(/^&gt;\s+(.+)$/);
    const codeToken = trimmed.match(/^@@CODE_(\d+)@@$/);

    if (!trimmed) {
      flushParagraph();
      return;
    }

    if (/^\\?-{3,}$/.test(trimmed)) {
      flushParagraph();
      flushList();
      html.push("<hr>");
      return;
    }

    if (codeToken) {
      flushParagraph();
      flushList();
      html.push(trimmed);
      return;
    }

    if (heading) {
      flushParagraph();
      flushList();
      html.push(`<h${heading[1].length}>${renderInline(heading[2])}</h${heading[1].length}>`);
      return;
    }

    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      return;
    }

    if (listItem) {
      flushParagraph();
      const type = listItem[2] ? "ol" : "ul";
      if (!list || list.type !== type) flushList();
      list ||= { type, items: [] };
      list.items.push(listItem[3]);
      return;
    }

    flushList();
    paragraph.push(line);
  });

  flushParagraph();
  flushList();
  text = html.join("");

  codeBlocks.forEach((block, i) => {
    const safe = escapeHtml(block.code);
    text = text.replace(`@@CODE_${i}@@`,
      `<div class="code-wrap"><div class="code-head"><span>${escapeHtml(block.lang)}</span><button data-copy-code="${encodeURIComponent(block.code)}">Copy</button></div><pre><code>${safe}</code></pre></div>`);
  });

  return text;
}

export function plainText(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || "";
}
