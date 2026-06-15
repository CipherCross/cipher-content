// Minimal, dependency-free Markdown -> HTML renderer for the article preview.
//
// The Markdown text itself is the source of truth — it's what gets copied and
// pasted into Framer's CMS rich-text field (Framer converts the same elements:
// headings, bold/italic, links, ordered/unordered lists, blockquotes, code
// blocks/inline code, images). This renderer only powers the in-app preview,
// so it favours safety and the common cases over full CommonMark coverage.
//
// Security: all text is HTML-escaped first; inline transforms only ever insert
// a fixed set of tags, and URLs are sanitised to http(s)/relative.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Only allow safe URL schemes; block javascript:, data:, etc. The input is
// already HTML-escaped (the whole document is escaped up front), so we must
// NOT escape again here — just validate the scheme.
function safeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^(https?:\/\/|\/|#|mailto:)/i.test(trimmed)) return trimmed;
  return "#";
}

// Inline spans: images, links, bold, italic, inline code. Operates on already
// escaped text; matches the longer/code tokens before the shorter ones.
function inline(text: string): string {
  let out = text;
  // inline code first so its contents aren't treated as other markup
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  // images ![alt](url)
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) =>
    `<img src="${safeUrl(url)}" alt="${alt}" loading="lazy" />`,
  );
  // links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) =>
    `<a href="${safeUrl(url)}" target="_blank" rel="noreferrer noopener">${label}</a>`,
  );
  // bold then italic (bold uses doubled markers, so run it first)
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  return out;
}

export function renderMarkdown(md: string): string {
  const lines = escapeHtml(md ?? "").split("\n");
  const html: string[] = [];
  let i = 0;
  // open list buffering
  let listType: "ul" | "ol" | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block ```
    if (/^```/.test(line.trim())) {
      flushPara();
      closeList();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      html.push(`<pre><code>${code.join("\n")}</code></pre>`);
      continue;
    }

    // blank line ends paragraphs and lists
    if (line.trim() === "") {
      flushPara();
      closeList();
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushPara();
      closeList();
      html.push("<hr />");
      i++;
      continue;
    }

    // heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // blockquote (collapse consecutive > lines)
    if (/^\s*&gt;\s?/.test(line)) {
      flushPara();
      closeList();
      const quote: string[] = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*&gt;\s?/, ""));
        i++;
      }
      html.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`);
      continue;
    }

    // unordered list item
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      flushPara();
      if (listType !== "ul") {
        closeList();
        listType = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${inline(ul[1].trim())}</li>`);
      i++;
      continue;
    }

    // ordered list item
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      flushPara();
      if (listType !== "ol") {
        closeList();
        listType = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${inline(ol[1].trim())}</li>`);
      i++;
      continue;
    }

    // otherwise: paragraph text (accumulate wrapped lines)
    closeList();
    para.push(line.trim());
    i++;
  }

  flushPara();
  closeList();
  return html.join("\n");
}
