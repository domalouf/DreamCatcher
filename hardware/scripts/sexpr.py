"""Minimal S-expression reader/writer for KiCad files."""


class Sym(str):
    """An unquoted atom (as opposed to a quoted string)."""


def parse(text):
    pos = 0
    n = len(text)
    stack = [[]]
    while pos < n:
        c = text[pos]
        if c in " \t\r\n":
            pos += 1
        elif c == "(":
            new = []
            stack[-1].append(new)
            stack.append(new)
            pos += 1
        elif c == ")":
            stack.pop()
            pos += 1
        elif c == '"':
            end = pos + 1
            out = []
            while text[end] != '"':
                if text[end] == "\\":
                    out.append(text[end:end + 2])
                    end += 2
                else:
                    out.append(text[end])
                    end += 1
            stack[-1].append("".join(out))
            pos = end + 1
        else:
            end = pos
            while end < n and text[end] not in " \t\r\n()":
                end += 1
            stack[-1].append(Sym(text[pos:end]))
            pos = end
    return stack[0][0]


def dump(node, indent=0):
    if isinstance(node, list):
        simple = all(not isinstance(child, list) for child in node)
        if simple:
            return "(" + " ".join(dump(child) for child in node) + ")"
        pad = "\n" + "  " * (indent + 1)
        parts = []
        for i, child in enumerate(node):
            text = dump(child, indent + 1)
            parts.append(text if i == 0 or not isinstance(child, list) else pad + text)
        return "(" + " ".join(p if not p.startswith("\n") else p for p in parts).replace(" \n", "\n") + "\n" + "  " * indent + ")"
    if isinstance(node, Sym):
        return str(node)
    if isinstance(node, str):
        return '"' + node + '"'
    if isinstance(node, float):
        return f"{node:.4f}".rstrip("0").rstrip(".")
    return str(node)


def find(node, name):
    return [child for child in node if isinstance(child, list) and child and child[0] == name]


def first(node, name):
    found = find(node, name)
    return found[0] if found else None
