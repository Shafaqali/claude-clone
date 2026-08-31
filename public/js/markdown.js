function escapeHtml(value) {
  return value.replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

export function renderMarkdown(input = "") {
  const codeBlocks = [];
  let text = input.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const id = codeBlocks.length;
    codeBlocks.push({ lang: lang || "code", code: code.trimEnd() });
    return `@@CODE_${id}@@`;
  });

  text = escapeHtml(text)
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^\s*[-*] (.*)$/gm, "<li>$1</li>")
    .replace(/^\s*\d+\.\s+(.*)$/gm, "<li>$1</li>")
    .replace(/^> (.*)$/gm, "<blockquote>$1</blockquote>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  text = text.split(/\n{2,}/).map(block => {
    if (block.startsWith("<h") || block.startsWith("<blockquote>") || block.startsWith("<li>")) return block;
    return block.replace(/\n/g, "<br>");
  }).join("<p></p>");

  text = text.replace(/(<li>.*?<\/li>)(?:<p><\/p>(?=<li>)|(?=<li>))/gs, "$1");
  text = text.replace(/(?:<li>.*?<\/li>)+/gs, m => `<ul>${m}</ul>`);

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