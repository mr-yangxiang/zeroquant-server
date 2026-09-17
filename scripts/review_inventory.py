#!/usr/bin/env python3
"""只读扫描 Git 可见文件；不运行项目代码、不读取 .env、不连接外部服务。

生成逐文件清单，不把正则命中解释成漏洞，也不把未命中解释成已经通读。
人工审查记录绑定 SHA-256；代码变化后该记录自动标为待复核。
"""
from __future__ import annotations
import argparse
import ast
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
import sys

SERVER = Path(__file__).resolve().parents[1]
DEFAULT_WEB = SERVER.parent / 'zeroquant-web'
OUT = SERVER / 'docs' / 'audit'
GENERATED = {'docs/audit/file-review-checklist.md', 'docs/audit/file-review-inventory.json',
             'docs/audit/80-point-evidence.md', 'docs/audit/80-point-evidence.json',
             'docs/audit/manual-review.json'}
CODE = {'.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.vue', '.sh'}
PATTERNS = {
    'SQL/DDL（需判断所在层）': r'\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE|DROP TABLE)\b',
    '宽类型（不等于缺陷）': r'\b(?:any|Any)\b',
    '网络调用（需核对超时/来源）': r'\b(?:fetch|urlopen|requests\.(?:get|post)|HttpTransport)\s*\(',
    '子进程/动态执行': r'\b(?:spawn|exec|eval|Popen|subprocess\.run)\s*\(',
    '异常输出（需人工核对脱敏）': r'console\.(?:error|warn)\(|(?:str\((?:err|error|exc)\)|\{(?:err|error|exc)\})',
    'HTML 注入入口（需核对转义）': r'v-html|innerHTML',
    '异常 any': r'catch\s*\([^)]*:\s*any\b',
}

def names(root: Path) -> list[str]:
    result = subprocess.run(['git', '-C', str(root), 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
                            check=True, capture_output=True)
    return sorted(set(result.stdout.decode().split('\0')) - {''})

def snapshot(roots):
    manifest = json.loads((OUT / 'manual-review.json').read_text())
    rows = []
    for repo, root in roots.items():
        for name in names(root):
            path = root / name
            key = repo + ':' + name
            entry = {'repository': repo, 'path': name, 'location': str(path) + ':1', 'signals': {}}
            if path.is_symlink():
                entry.update(level='排除：符号链接', verification='未跟随链接', remaining='需确认链接目标授权与用途', sha256=None, lines=None)
                rows.append(entry); continue
            if not path.is_file():
                entry.update(level='已删除/非普通文件', verification='仅核对路径', remaining='如为删除需审查引用', sha256=None, lines=None)
                rows.append(entry); continue
            if name in GENERATED or name.startswith('docs/audit/'):
                entry.update(level='审查工件', verification='目录登记；证据由 --check 核验', remaining='不属于被验证的业务代码', sha256=None, lines=None)
                rows.append(entry); continue
            if path.name.startswith('.env') and not path.name.endswith('.example'):
                entry.update(level='排除：敏感配置', verification='未读取内容', remaining='仅部署时通过秘密管理核验', sha256=None, lines=None)
                rows.append(entry); continue
            data = path.read_bytes()
            entry['sha256'] = sha256(data).hexdigest()
            try:
                text = data.decode('utf-8')
            except UnicodeDecodeError:
                entry.update(level='二进制元数据', verification='仅文件摘要', remaining='未验证格式/业务内容', lines=None)
                rows.append(entry); continue
            lines = text.splitlines()
            entry['lines'] = len(lines)
            syntax = ''
            if path.suffix in CODE:
                entry['signals'] = {label: [i+1 for i, line in enumerate(lines) if re.search(pattern, line)]
                                    for label, pattern in PATTERNS.items()}
                entry['signals'] = {key: value for key, value in entry['signals'].items() if value}
            if path.suffix == '.py':
                try:
                    ast.parse(text, filename=name); syntax = 'Python AST 解析通过；'
                except SyntaxError as error:
                    syntax = 'Python AST 解析失败，行 ' + str(error.lineno) + '；'
            review = manifest.get(key)
            if review and review['sha256'] == entry['sha256']:
                entry.update(level=review['level'], verification=syntax + review['verification'], remaining=review['remaining'])
            elif review:
                entry.update(level='已变更待复核', verification=syntax + '人工证据摘要不再匹配', remaining='重新审查变更，更新人工记录')
            elif path.suffix in CODE:
                entry.update(level='静态扫描，未通读', verification=syntax + '关键词扫描；未建立逐文件行为测试映射',
                             remaining='G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖')
            else:
                entry.update(level='元数据登记，未通读', verification='文件摘要及行数', remaining='G10：配置、文档或数据内容仍待逐项核验')
            rows.append(entry)
    return rows

def check(roots, current):
    errors = []
    saved = json.loads((OUT / 'file-review-inventory.json').read_text())['files']
    key = lambda r: (r['repository'], r['path'])
    if {key(r) for r in current} != {key(r) for r in saved}:
        errors.append('文件集合变化：请重新生成清单')
    for old, new in zip(sorted(saved, key=key), sorted(current, key=key)):
        if key(old) == key(new) and old != new:
            errors.append('清单快照已变化：' + ':'.join(key(new)))
    evidence = json.loads((OUT / '80-point-evidence.json').read_text())['rows']
    if [r['id'] for r in evidence] != list(range(1, 81)):
        errors.append('80 项编号不完整或重复')
    for row in evidence:
        if not row['verification'] or not row['remaining_gap']:
            errors.append('第 ' + str(row['id']) + ' 项缺验证或缺口')
        for ref in row['evidence']:
            path = roots[ref['repository']] / ref['path']
            if not path.is_file():
                errors.append('证据路径不存在：' + str(path)); continue
            data = path.read_bytes()
            lines = data.decode().splitlines()
            if sha256(data).hexdigest() != ref['sha256']:
                errors.append('证据摘要已变化：' + str(path)); continue
            if not 0 < ref['line'] <= len(lines) or ref['anchor'] not in lines[ref['line']-1]:
                errors.append('证据锚点失效：' + str(path))
    if errors:
        print('\n'.join(sorted(set(errors)))); return 1
    print(f'PASS：80 项编号/证据位置/摘要与 {len(current)} 个逐文件条目一致；不代表业务缺口已关闭。')
    return 0

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--web-root', type=Path, default=DEFAULT_WEB)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    roots = {'server': SERVER, 'web': args.web_root.resolve()}
    if not args.check:
        OUT.mkdir(parents=True, exist_ok=True)
        # 派生工件本身也应进入文件集合，首次生成与后续核验保持一致。
        for name in ('file-review-checklist.md', 'file-review-inventory.json'):
            (OUT / name).touch(exist_ok=True)
    rows = snapshot(roots)
    if args.check:
        return check(roots, rows)
    counts = Counter(row['level'] for row in rows)
    audit_date = json.loads((OUT / '80-point-evidence.json').read_text())['date']
    payload = {'date': audit_date, 'scope': 'Git tracked + untracked, excluding ignored dependencies/runtime/secrets',
               'roots': {k: str(v) for k, v in roots.items()}, 'counts': dict(counts), 'files': rows}
    (OUT / 'file-review-inventory.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    md = '''# 全项目逐文件审查清单（2026-09-15）

## 口径与边界

**所有 Git 可见文件均有条目，不等于所有文件均已通读。** 当前包括已跟踪文件和未忽略的新文件；排除 node_modules、dist、虚拟环境、.git、本地 .env、运行时数据库/状态/日志等 Git 忽略内容。用户数据与线上状态未读取。

- **通读审查**：本轮已阅读完整文件，结论限于列出的关注点；不等于数学正确性、真实并发或上线验收。
- **局部审查**：只审查列出的关键路径，其余仍待通读。
- **静态扫描，未通读**：扫描关键词并对 Python 做 AST 解析，不能算行为正确性证明。
- **元数据登记**：不把模型 JSON、历史日志或依赖锁文件的摘要当作内容审查。
- 每个条目包含路径、行数、验证结果、剩余缺口；JSON 另保存文件 SHA-256 和全部信号行号。信号只是审查线索，不是自动判定的漏洞。
- 重新扫描不会自动给文件贴上“人工通读”；人工记录绑定摘要，代码变化后自动降为“已变更待复核”。

'''
    md = md.replace('2026-09-15', audit_date)
    md += '## 覆盖统计\n\n' + '\n'.join(f'- {k}：{v} 个。' for k, v in counts.items())
    md += '\n\n来源：[人工审查记录](./manual-review.json)、[机器清单](./file-review-inventory.json)、[缺口台账](./findings.md)、[验证记录](./verification.md)。\n'
    for repo in roots:
        md += '\n## ' + repo + '\n\n| 文件 | 行数 | 审查层级 | 验证结果 | 剩余缺口 |\n| --- | --- | --- | --- | --- |\n'
        for row in rows:
            if row['repository'] != repo: continue
            signal = '；'.join(label + '：' + ','.join(map(str, points[:4])) + ('…' if len(points)>4 else '') for label, points in row['signals'].items())
            verification = row['verification'] + ('；扫描定位 ' + signal if signal else '')
            cells = [f"[{row['path']}]({row['location']})", str(row['lines'] if row['lines'] is not None else '—'), row['level'], verification, row['remaining']]
            md += '| ' + ' | '.join(s.replace('|', '\\|').replace('\n', ' ') for s in cells) + ' |\n'
    md += '\n## 更新与核验\n\n```bash\npython3 scripts/review_inventory.py\npython3 scripts/review_inventory.py --check\n```\n\n仅更新机器清单不能关闭人工审查缺口；80 项代码证据有变化时必须复核对应条目并更新摘要和行号。\n'
    (OUT / 'file-review-checklist.md').write_text(md)
    print(json.dumps({'total': len(rows), **dict(counts)}, ensure_ascii=False))
    return 0

if __name__ == '__main__':
    sys.exit(main())
