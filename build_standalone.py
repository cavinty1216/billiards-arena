#!/usr/bin/env python3
"""Build a single-file standalone HTML (all CSS/JS inlined) for testing."""
import re, pathlib

root = pathlib.Path(__file__).parent
html = (root / 'index.html').read_text(encoding='utf-8')

css = (root / 'css' / 'style.css').read_text(encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="css/style.css">',
                    '<style>\n' + css + '\n</style>')

scripts = re.findall(r'<script src="([^"]+)"></script>', html)
for src in scripts:
    js = (root / src).read_text(encoding='utf-8')
    tag = '<script src="{0}"></script>'.format(src)
    assert '</script>' not in js, src
    html = html.replace(tag, '<script>\n' + js + '\n</script>')

(root / 'billiards-arena-standalone.html').write_text(html, encoding='utf-8')
print('standalone bytes:', len(html.encode('utf-8')))
