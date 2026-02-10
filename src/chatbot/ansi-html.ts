/**
 * Utilities for capturing console output and converting ANSI colors to HTML.
 * Used to render CLI-style reports in the browser chatbot.
 */

/** Capture all console.log output from a synchronous function. */
export function captureConsole(fn: () => void): string {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.log = origLog;
  }
  return logs.join("\n");
}

/** Map ANSI SGR color codes to dark-theme hex colors. */
function ansiColorToHex(code: number): string | null {
  const map: Record<number, string> = {
    30: "#6e7681", 31: "#f85149", 32: "#7ee787", 33: "#e3b341",
    34: "#58a6ff", 35: "#bc8cff", 36: "#76e3ea", 37: "#e1e4e8",
    90: "#8b949e", 91: "#ff7b72", 92: "#7ee787", 93: "#e3b341",
    94: "#79c0ff", 95: "#d2a8ff", 96: "#76e3ea", 97: "#f0f6fc",
  };
  return map[code] ?? null;
}

/** Convert ANSI escape sequences to HTML spans with inline styles. */
export function ansiToHtml(ansi: string): string {
  let html = "";
  let currentColor: string | null = null;
  let isBold = false;
  let isDim = false;
  let spanOpen = false;

  function applyStyle() {
    if (spanOpen) { html += "</span>"; spanOpen = false; }
    const styles: string[] = [];
    if (currentColor) styles.push(`color:${currentColor}`);
    if (isBold) styles.push("font-weight:bold");
    if (isDim) styles.push("opacity:0.6");
    if (styles.length > 0) {
      html += `<span style="${styles.join(";")}">`; spanOpen = true;
    }
  }

  let i = 0;
  while (i < ansi.length) {
    if (ansi[i] === "\x1b" && ansi[i + 1] === "[") {
      const endIdx = ansi.indexOf("m", i + 2);
      if (endIdx === -1) { i++; continue; }
      const codes = ansi.slice(i + 2, endIdx).split(";").filter(Boolean).map(Number);
      i = endIdx + 1;

      for (const code of codes) {
        if (code === 0) { currentColor = null; isBold = false; isDim = false; }
        else if (code === 1) isBold = true;
        else if (code === 2) isDim = true;
        else if (code === 22) { isBold = false; isDim = false; }
        else if (code === 39 || code === 49) currentColor = null;
        else {
          const color = ansiColorToHex(code);
          if (color) currentColor = color;
        }
      }
      applyStyle();
    } else {
      const c = ansi[i];
      html += c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c;
      i++;
    }
  }

  if (spanOpen) html += "</span>";
  return html;
}
