// scripts/lib/hcl-parser.mjs
// 职责：解析 HCL 骨架文本 → 结构化对象
// 输入：HCL 字符串
// 输出：{ cluster, nodes[] }
// 仅处理架构文档定义的子集语法

import { readFileSync } from 'fs';

export function parse(src) {
  const p = new Parser(src);
  const result = { cluster: null, nodes: [] };

  while (p.more()) {
    p.skipWS();
    if (!p.more() || p.peek('#')) { p.skipLine(); continue; }
    if (p.peek('cluster')) result.cluster = p.block('cluster');
    else if (p.peek('node')) result.nodes.push(p.block('node'));
    else throw p.err('expected cluster or node');
  }
  return result;
}

export function parseFile(path) {
  return parse(readFileSync(path, 'utf-8'));
}

class Parser {
  constructor(src) { this.src = src; this.i = 0; }

  more() { return this.i < this.src.length; }
  err(msg) { return new Error(`pos ${this.i}: ${msg} — …${this.src.slice(Math.max(0,this.i-10), this.i+20)}…`); }

  skipWS()  { while (this.more() && /\s/.test(this.src[this.i])) this.i++; }
  skipLine(){ while (this.more() && this.src[this.i] !== '\n') this.i++; if (this.more()) this.i++; }

  peek(s) {
    const start = this.i;
    this.skipWS();
    for (let j = 0; j < s.length; j++)
      if (this.src[this.i + j] !== s[j]) { this.i = start; return false; }
    const next = this.src[this.i + s.length];
    const ok = !next || /[\s"{\[]/.test(next);
    this.i = start;
    return ok;
  }

  eat(s) {
    this.skipWS();
    for (let j = 0; j < s.length; j++) {
      if (this.src[this.i] !== s[j]) throw this.err(`expected '${s}'`);
      this.i++;
    }
  }

  block(kw) {
    this.eat(kw);
    const name = this.str();
    this.eat('{');
    const attrs = {};
    while (this.more() && this.src[this.i] !== '}') {
      this.skipWS();
      if (this.src[this.i] === '}' || this.src[this.i] === '#') {
        if (this.src[this.i] === '#') this.skipLine();
        continue;
      }
      const key = this.ident();
      this.eat('=');
      attrs[key] = this.val();
    }
    this.eat('}');
    return { name, kind: kw, ...attrs };
  }

  str() {
    this.skipWS();
    if (this.src[this.i] === '"') {
      this.i++;
      let s = '';
      while (this.more() && this.src[this.i] !== '"') {
        if (this.src[this.i] === '\\') this.i++;
        s += this.src[this.i++];
      }
      this.i++;
      return s;
    }
    return this.ident();
  }

  ident() {
    let s = '';
    while (this.more() && /[a-zA-Z0-9_-]/.test(this.src[this.i])) s += this.src[this.i++];
    if (!s) throw this.err('expected identifier');
    return s;
  }

  val() {
    this.skipWS();
    const c = this.src[this.i];
    if (c === '"') return this.str();
    if (c === '[') {
      this.i++;
      const a = [];
      while (this.more() && this.src[this.i] !== ']') {
        this.skipWS();
        if (this.src[this.i] === ']') break;
        a.push(this.val());
      }
      this.i++;
      return a;
    }
    if (/\d/.test(c)) { let s=''; while(this.more()&&/\d/.test(this.src[this.i]))s+=this.src[this.i++]; return parseInt(s,10); }
    if (/[a-zA-Z]/.test(c)) return this.ident();
    throw this.err('expected value');
  }
}
