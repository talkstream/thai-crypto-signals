#!/usr/bin/env node
// Export the CONSOLE-VISIBLE portion of a Claude Code session transcript to Markdown.
//
// Included : user messages, assistant text, tool calls (compact), tool results.
// Excluded : thinking, system reminders/hooks, metadata records, subagent transcripts.
//
// No hardcoded paths. The transcript is resolved at runtime in this order:
//   1) argv[2]  (explicit path; an optional Stop-hook can pass it as an argument)
//   2) newest *.jsonl under ~/.claude/projects/<cwd-with-slashes-as-dashes>
// Note: stdin is deliberately NOT read — readFileSync(0) blocks on an open pipe (e.g. a
// detached background shell), which would hang the script forever.
// Output: <dir of transcript>/session-raw-console.md  (next to the log history).

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const MAX_BLOCK_CHARS = 8000;

// Claude Code keeps transcripts under ~/.claude/projects/<slug>, where <slug> is the
// project's absolute path with path separators replaced by '-'. Derived, never hardcoded.
function projectsDirForCwd() {
  const slug = process.cwd().replace(/[/\\]/g, '-');
  return join(homedir(), '.claude', 'projects', slug);
}

function resolveTranscriptPath() {
  if (process.argv[2]) return process.argv[2];

  const dir = projectsDirForCwd();
  const candidates = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => join(dir, f))
    .map((p) => ({ p, t: statSync(p).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (candidates.length === 0) throw new Error(`no .jsonl transcript under ${dir}`);
  return candidates[0].p;
}

function clip(text) {
  const s = String(text);
  return s.length > MAX_BLOCK_CHARS
    ? `${s.slice(0, MAX_BLOCK_CHARS)}\n…[truncated ${s.length - MAX_BLOCK_CHARS} chars]`
    : s;
}

function compactJson(value) {
  try {
    const s = JSON.stringify(value);
    return s.length > 600 ? `${s.slice(0, 600)}…` : s;
  } catch {
    return String(value);
  }
}

// Flatten a message `content` (string | block[]) into printable {kind,text} parts.
function renderContent(content) {
  if (typeof content === 'string') return content.trim() ? [{ kind: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    switch (block.type) {
      case 'text':
        if (block.text?.trim()) parts.push({ kind: 'text', text: block.text });
        break;
      case 'tool_use':
        parts.push({ kind: 'tool_use', text: `→ ${block.name}(${compactJson(block.input)})` });
        break;
      case 'tool_result': {
        const c = block.content;
        let text = '';
        if (typeof c === 'string') text = c;
        else if (Array.isArray(c))
          text = c.map((b) => (typeof b === 'string' ? b : (b?.text ?? ''))).join('\n');
        if (text.trim()) parts.push({ kind: 'tool_result', text });
        break;
      }
      case 'image':
        parts.push({ kind: 'text', text: '[image]' });
        break;
      // thinking / redacted_thinking and anything else: skipped (not console-visible)
      default:
        break;
    }
  }
  return parts;
}

function main() {
  const transcriptPath = resolveTranscriptPath();
  const lines = readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);

  const out = [
    '# Session — raw console log (Thai Crypto Signals)',
    '',
    `> Source: \`${transcriptPath}\``,
    '> Console-visible only (user + assistant text + tool calls + tool results).',
    `> Records: ${lines.length}. Regenerate any time with \`node scripts/export-session-raw.mjs\`.`,
    '',
  ];

  for (const line of lines) {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.type !== 'user' && rec.type !== 'assistant') continue;
    const parts = renderContent(rec.message?.content);
    if (parts.length === 0) continue;

    const ts = rec.timestamp ? ` · ${rec.timestamp}` : '';
    out.push(`## ${rec.type.toUpperCase()}${ts}`, '');
    for (const part of parts) {
      if (part.kind === 'text') out.push(part.text.trim(), '');
      else if (part.kind === 'tool_use') out.push('```', clip(part.text), '```', '');
      else if (part.kind === 'tool_result')
        out.push(
          '<details><summary>tool result</summary>',
          '',
          '```',
          clip(part.text),
          '```',
          '',
          '</details>',
          '',
        );
    }
  }

  const outputPath = join(dirname(transcriptPath), 'session-raw-console.md');
  writeFileSync(outputPath, out.join('\n'), 'utf8');
  process.stderr.write(`[export-session-raw] wrote ${outputPath} (${lines.length} records)\n`);
}

main();
