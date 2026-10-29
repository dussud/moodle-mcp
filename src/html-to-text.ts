// Minimal HTML → Markdown-ish text conversion for Moodle page/book content.
// Not a full HTML parser: it handles the markup Moodle's editors (Atto/TinyMCE)
// actually produce — headings, paragraphs, lists, links, images, tables, pre.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  times: "×",
  divide: "÷",
  euro: "€",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  if (!m) return undefined;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

export function htmlToText(html: string): string {
  let s = html;

  // Only the body matters; Moodle's served index.html wraps content in a full document.
  const body = s.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (body) s = body[1];

  s = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, "");

  // Preserve <pre> blocks verbatim; everything else has insignificant whitespace.
  const pres: string[] = [];
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner: string) => {
    // Some editors put each code line in its own <div>/<p> inside the <pre>.
    const code = decodeEntities(stripTags(inner.replace(/<br\s*\/?>|<\/(div|p)>/gi, "\n")));
    if (!code.trim()) return "";
    pres.push(code);
    return `\u0000PRE${pres.length - 1}\u0000`;
  });
  s = s.replace(/\s+/g, " ");

  // Tables become Markdown tables, innermost first. Cells are converted on their
  // own and flattened to one line, since rubric cells often hold several paragraphs.
  const tables: string[] = [];
  const innermostTable = /<table\b[^>]*>((?:(?!<table\b)[\s\S])*?)<\/table>/gi;
  while (innermostTable.test(s)) {
    s = s.replace(innermostTable, (_, inner: string) => {
      const table = tableToMarkdown(inner);
      if (!table) return "";
      tables.push(table);
      return `\n\n\u0000TBL${tables.length - 1}\u0000\n\n`;
    });
  }

  s = s
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const alt = (attr(tag, "alt") ?? attr(tag, "title") ?? "").trim();
      return alt ? `[image: ${alt}]` : "[image]";
    })
    .replace(/<(iframe|video|audio|object|embed)\b([^>]*)>(?:[\s\S]*?<\/\1>)?/gi, (_, kind: string, attrs: string) => {
      const title = attr(` ${attrs}`, "title")?.trim();
      const label = kind.toLowerCase() === "iframe" ? "embedded content" : `embedded ${kind.toLowerCase()}`;
      return ` [${label}${title ? `: ${title}` : ""}] `;
    })
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs: string, inner: string) => {
      const text = stripTags(inner).trim();
      const href = attr(` ${attrs}`, "href");
      // Moodle-hosted file links carry no value to the client (and we don't
      // hand out raw pluginfile URLs); attachments are listed with fileIds instead.
      if (!href || href.startsWith("#") || /^javascript:/i.test(href) || href.includes("pluginfile.php")) {
        return text;
      }
      return text && text !== href ? `[${text}](${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) => {
      // Editors often leave empty headings behind; don't emit bare "###".
      const text = stripTags(inner).trim();
      return text ? `\n\n${"#".repeat(Number(level))} ${text}\n\n` : "\n\n";
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, inner: string) =>
      inner.trim() ? `**${inner.trim()}**` : inner,
    )
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, inner: string) =>
      inner.trim() ? `_${inner.trim()}_` : inner,
    )
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(ul|ol)>/gi, "\n\n")
    .replace(/<(td|th)\b[^>]*>/gi, " | ")
    .replace(/<\/tr>/gi, " |\n")
    .replace(/<hr\b[^>]*>/gi, "\n\n---\n\n")
    .replace(/<\/?(p|div|section|article|blockquote|table|thead|tbody|figure|figcaption|ul|ol)\b[^>]*>/gi, "\n\n");

  s = decodeEntities(stripTags(s));

  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return s
    .replace(/\n*\u0000TBL(\d+)\u0000\n*/g, (_, i: string) => `\n\n${tables[Number(i)]}\n\n`)
    .replace(/\n*\u0000PRE(\d+)\u0000\n*/g, (_, i: string) => `\n\n\`\`\`\n${pres[Number(i)].replace(/^\n+|\s+$/g, "")}\n\`\`\`\n\n`)
    .trim();
}

function tableToMarkdown(inner: string): string {
  const rows: string[][] = [];
  for (const [, row] of inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, cell]) =>
      htmlToText(cell).replace(/\s*\n+\s*/g, " / ").replace(/\|/g, "\\|"),
    );
    if (cells.some((c) => c)) rows.push(cells);
  }
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  const [head, ...body] = rows;
  return [line(head), `|${" --- |".repeat(width)}`, ...body.map(line)].join("\n");
}
