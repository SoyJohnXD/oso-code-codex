import path from 'node:path';
import type { BoundaryAction } from './types.ts';

export function shellActions(source: string, depth = 0): Set<BoundaryAction> {
  const actions = new Set<BoundaryAction>();
  if (depth > 16) return actions;
  const addScript = (script: string) => { for (const action of shellActions(script, depth + 1)) actions.add(action); };
  let cursor = 0;
  let words: string[] = [];
  let redirect: string | undefined;
  const documents: { delimiter: string; literal: boolean; tabs: boolean }[] = [];
  const flush = () => { inspectCommand(words, actions, addScript); words = []; };
  const expansion = (): boolean => {
    if (source.startsWith('$(', cursor)) {
      const start = cursor + 2;
      cursor = closingParenthesis(source, start);
      addScript(source.slice(start, cursor));
      cursor = Math.min(cursor + 1, source.length);
      return true;
    }
    if (source[cursor] === '`') {
      let script = '';
      cursor++;
      while (cursor < source.length && source[cursor] !== '`') {
        if (source[cursor] === '\\' && /[$`\\]/.test(source[cursor + 1] ?? '')) cursor++;
        script += source[cursor++];
      }
      cursor = Math.min(cursor + 1, source.length);
      addScript(script);
      return true;
    }
    return false;
  };
  while (cursor < source.length) {
    if (source[cursor] === '#' && !redirect) {
      while (cursor < source.length && source[cursor] !== '\n') cursor++;
      continue;
    }
    const character = source[cursor]!;
    if (/[ \t\r]/.test(character)) { cursor++; continue; }
    if (/[;\n&|()]/.test(character)) {
      flush();
      cursor++;
      if (character === '\n') {
        for (const document of documents.splice(0)) {
          let body = '';
          while (cursor < source.length) {
            const end = source.indexOf('\n', cursor);
            const line = source.slice(cursor, end === -1 ? source.length : end);
            cursor = end === -1 ? source.length : end + 1;
            if ((document.tabs ? line.replace(/^\t+/, '') : line) === document.delimiter) break;
            body += `${line}\n`;
          }
          if (!document.literal) addScript(heredocExpansions(body));
        }
      }
      continue;
    }
    if (character === '<' || character === '>') {
      const operator = source.slice(cursor).match(/^(?:<<<|<<-|<<|>>|<>|<&|>&|>|<)/)![0];
      redirect = operator;
      cursor += operator.length;
      continue;
    }
    let word = '';
    let quoted = false;
    let quote = '';
    while (cursor < source.length) {
      const current = source[cursor]!;
      if (!quote && /[\s;&|()<>]/.test(current)) break;
      if (current === quote) { quote = ''; quoted = true; cursor++; continue; }
      if (!quote && (current === "'" || current === '"')) { quote = current; quoted = true; cursor++; continue; }
      if (quote !== "'" && current === '\\') {
        quoted = true;
        const next = source[cursor + 1];
        if (quote === '"' && next && !/[$`"\\\n]/.test(next)) { word += current; cursor++; continue; }
        cursor += Math.min(2, source.length - cursor);
        if (next && next !== '\n') word += next;
        continue;
      }
      if (quote !== "'" && expansion()) { word += '\0'; continue; }
      word += current;
      cursor++;
    }
    if (redirect) {
      if (redirect === '<<' || redirect === '<<-') documents.push({ delimiter: word, literal: quoted, tabs: redirect === '<<-' });
      redirect = undefined;
    } else if (!( /^\d+$/.test(word) && /[<>]/.test(source[cursor] ?? ''))) words.push(word);
  }
  flush();
  return actions;
}

function closingParenthesis(source: string, start: number): number {
  let level = 1;
  let quote = '';
  for (let cursor = start; cursor < source.length; cursor++) {
    const current = source[cursor]!;
    if (current === '\\' && quote !== "'") { cursor++; continue; }
    if (current === quote) { quote = ''; continue; }
    if (!quote && (current === "'" || current === '"' || current === '`')) { quote = current; continue; }
    if (quote) continue;
    if (current === '(') level++;
    if (current === ')' && --level === 0) return cursor;
  }
  return source.length;
}

function heredocExpansions(body: string): string {
  const scripts: string[] = [];
  for (let cursor = 0; cursor < body.length; cursor++) {
    if (body[cursor] === '\\' && /[$`\\\n]/.test(body[cursor + 1] ?? '')) { cursor++; continue; }
    if (body.startsWith('$(', cursor)) {
      const end = closingParenthesis(body, cursor + 2);
      scripts.push(body.slice(cursor + 2, end));
      cursor = end;
    } else if (body[cursor] === '`') {
      const start = ++cursor;
      while (cursor < body.length && body[cursor] !== '`') {
        if (body[cursor] === '\\') cursor++;
        cursor++;
      }
      scripts.push(body.slice(start, cursor));
    }
  }
  return scripts.join('\n');
}

function inspectCommand(input: string[], actions: Set<BoundaryAction>, addScript: (script: string) => void): void {
  const words = [...input];
  while (words.length && (/^[A-Za-z_][A-Za-z_0-9]*=/.test(words[0]!) || ['!', '{', 'if', 'then', 'elif', 'else', 'do', 'while', 'until'].includes(words[0]!))) words.shift();
  let executable = path.basename(words.shift() ?? '');
  while (['env', 'command', 'exec', 'sudo', 'nohup', 'time', 'nice'].includes(executable)) {
    while (words.length && (words[0]!.startsWith('-') || /^[A-Za-z_][A-Za-z_0-9]*=/.test(words[0]!))) {
      const option = words.shift()!;
      if (['-u', '--unset', '-C', '--chdir', '-a', '-g', '--group', '--user', '-f', '--format', '-o', '--output', '-n', '--adjustment'].includes(option)) words.shift();
    }
    executable = path.basename(words.shift() ?? '');
  }
  if (['sh', 'bash', 'dash', 'zsh', 'ksh'].includes(executable)) {
    const option = words.findIndex(word => /^-[^-]*c/.test(word));
    if (option !== -1 && words[option + 1]) addScript(words[option + 1]!);
  } else if (executable === 'eval') addScript(words.join(' '));
  else if (executable === 'git') {
    while (words[0]?.startsWith('-')) {
      const option = words.shift()!;
      if (['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env'].includes(option)) words.shift();
    }
    if (['commit', 'commit-tree', 'update-ref', 'fast-import', 'filter-branch'].includes(words[0] ?? '') || gitReplaceMutation(words)) actions.add('commit');
    if (words[0] === 'push') actions.add('publication');
  } else if (['npm', 'pnpm'].includes(executable) && words[0] === 'publish' || ['vercel', 'netlify', 'firebase', 'wrangler'].includes(executable) && ['deploy', 'publish'].includes(words[0] ?? '')) actions.add('publication');
}

function gitReplaceMutation(words: string[]): boolean {
  if (words[0] !== 'replace') return false;
  const options = words.slice(1);
  return !options.includes('--list') && !options.includes('-l') && !options.includes('--help') && !options.includes('-h');
}
