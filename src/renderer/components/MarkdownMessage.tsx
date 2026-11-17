import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { safeExternalHttpUrl } from '@shared/externalUrl';
import { IconButton } from '@/components/IconButton';

export function MarkdownMessage({ text }: { text: string }): React.JSX.Element {
  const blocks: Array<{ kind: 'text'; value: string } | { kind: 'code'; language: string; value: string }> = [];
  const lines = text.split('\n');
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length) blocks.push({ kind: 'text', value: paragraph.join('\n') });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.startsWith('```')) {
      flush();
      const language = line.slice(3).trim();
      const code: string[] = [];
      while (++index < lines.length && !lines[index]?.startsWith('```')) code.push(lines[index] ?? '');
      blocks.push({ kind: 'code', language, value: code.join('\n') });
    } else if (line.trim() === '') {
      flush();
    } else paragraph.push(line);
  }
  flush();

  return <div className="markdown-message space-y-3">{blocks.map((block, index) => block.kind === 'code'
    ? <CodeBlock key={index} code={block.value} language={block.language} />
    : <TextBlock key={index} text={block.value} />)}</div>;
}

function TextBlock({ text }: { text: string }): React.JSX.Element {
  const lines = text.split('\n');
  const first = lines[0] ?? '';
  const heading = /^(#{1,4})\s+(.+)$/.exec(first);
  if (heading) {
    const level = heading[1]?.length ?? 2;
    const Tag = (`h${level}`) as 'h1' | 'h2' | 'h3' | 'h4';
    return <Tag className="font-semibold leading-tight text-[var(--color-ink)]">{inline(heading[2] ?? '')}</Tag>;
  }
  if (lines.every((line) => /^\s*[-*+]\s+/.test(line))) {
    return <ul className="list-disc space-y-1 pl-5">{lines.map((line, index) => <li key={index}>{inline(line.replace(/^\s*[-*+]\s+/, ''))}</li>)}</ul>;
  }
  if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
    return <ol className="list-decimal space-y-1 pl-5">{lines.map((line, index) => <li key={index}>{inline(line.replace(/^\s*\d+\.\s+/, ''))}</li>)}</ol>;
  }
  return <p className="whitespace-pre-wrap break-words leading-relaxed">{inline(text)}</p>;
}

function CodeBlock({ code, language }: { code: string; language: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  };
  return (
    <section className="overflow-hidden rounded-xl border border-white/10 bg-[#080c13]/90">
      <header className="flex items-center gap-2 border-b border-white/8 px-3 py-1.5 text-[11px] text-[var(--color-ink-dim)]">
        <span className="flex-1">{language || 'Code'}</span>
        <IconButton label={copied ? 'Copied code' : 'Copy code'} onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}</IconButton>
      </header>
      <pre className="selectable overflow-x-auto p-3 text-[12px] leading-relaxed"><code>{code}</code></pre>
    </section>
  );
}

function inline(value: string): React.ReactNode[] {
  const tokens = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  const result: React.ReactNode[] = [];
  let last = 0;
  for (const match of value.matchAll(tokens)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) result.push(value.slice(last, start));
    if (token.startsWith('**')) result.push(<strong key={start} className="font-semibold text-[var(--color-ink)]">{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) result.push(<code key={start} className="rounded bg-white/8 px-1 py-0.5 font-mono text-[0.92em] text-cyan-100">{token.slice(1, -1)}</code>);
    else if (token.startsWith('*')) result.push(<em key={start}>{token.slice(1, -1)}</em>);
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = safeExternalHttpUrl(link?.[2]);
      result.push(href ? <a key={start} href={href} target="_blank" rel="noreferrer" className="text-cyan-200 underline decoration-cyan-300/40 underline-offset-2 hover:text-cyan-100">{link?.[1]}</a> : token);
    }
    last = start + token.length;
  }
  if (last < value.length) result.push(value.slice(last));
  return result;
}
