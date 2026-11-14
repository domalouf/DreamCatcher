"""Builds a board's .kicad_sch from boards.py.

The schematic is drawn label-style: every part stands on its own inside its
functional block, and each pin carries a label with the name of its net. Two pins are
connected when their labels match.

Run with:  python3 gen_sch.py main|sensor
"""

import copy
import math
import os
import sys
import uuid

from boards import BOARDS
from gen_pcb import NAMESPACE, symbol_uuid
from libs import LIB
from sexpr import Sym, find, first, parse

HERE = os.path.dirname(os.path.abspath(__file__))
KICAD_SYMBOLS = os.environ.get("KICAD_SYMBOLS", "/usr/share/kicad/symbols")
GRID = 1.27
STUB = 2.54
FONT = "(effects (font (size 1.27 1.27))"

# Nets fed through a connector or a diode, which the electrical rules check can't
# tell are power sources
POWER_FLAGS = ("GND", "VBUS", "VSYS", "VBAT")

NOTES = {
    "dreamcatcher-main": [
        "Charge current = 1000 V / R3 = 100 mA. Use a cell of 100 mAh or more with its own protection circuit.",
        "Q1 and D1 share the load: on USB power the system runs from VBUS and the battery only charges.",
        "Q2 switches power to both eye sensors. SENS_EN_N low = sensors on.",
        "Strapping pins: GPIO2 (status LED, pulled up), GPIO8 (SDA, pulled up), GPIO9 (BOOT pad, low at reset = USB download).",
        "Accelerometer I2C address 0x19 (SA0 high).",
        "Eye connector pins: 1 cue LED anode, 2 GND, 3 phototransistor output, 4 IR LED anode.",
    ],
    "dreamcatcher-eye-sensor": [
        "The IR LED resistor (220R), phototransistor pull-up (47k) and cue LED resistor (100R) are on the main board.",
        "Wire pads: 1 cue LED anode, 2 GND, 3 phototransistor output, 4 IR LED anode.",
    ],
}

_libraries = {}


def new_id(*parts):
    return str(uuid.uuid5(NAMESPACE, "/".join(str(p) for p in parts)))


def atom(value):
    if isinstance(value, Sym):
        return str(value)
    if isinstance(value, str):
        return '"' + value + '"'
    return str(value)


def dump(node, depth=0):
    if all(not isinstance(child, list) for child in node):
        return "(" + " ".join(atom(child) for child in node) + ")"
    pad = "\n" + "  " * (depth + 1)
    out = "("
    for i, child in enumerate(node):
        if isinstance(child, list):
            out += pad + dump(child, depth + 1)
        else:
            out += ("" if i == 0 else " ") + atom(child)
    return out + "\n" + "  " * depth + ")"


def library_symbol(lib_id):
    """The library's definition of a symbol, with any parent symbol merged in and
    renamed the way a schematic stores it ("Lib:Name")."""
    lib, name = lib_id.split(":")
    if lib not in _libraries:
        folder = LIB if lib == "DreamCatcher" else KICAD_SYMBOLS
        _libraries[lib] = parse(open(os.path.join(folder, lib + ".kicad_sym")).read())
    symbols = {s[1]: s for s in find(_libraries[lib], "symbol")}
    symbol = copy.deepcopy(symbols[name])
    parent = first(symbol, "extends")
    if parent:
        base = copy.deepcopy(symbols[parent[1]])
        own_properties = {p[1]: p for p in find(symbol, "property")}
        merged = [Sym("symbol"), name]
        for child in base[2:]:
            if isinstance(child, list) and child[0] == "property" and child[1] in own_properties:
                merged.append(own_properties[child[1]])
            elif isinstance(child, list) and child[0] == "symbol":
                child[1] = name + child[1][len(parent[1]):]
                merged.append(child)
            else:
                merged.append(child)
        symbol = merged
    symbol[1] = lib_id
    return symbol


def symbol_pins(symbol):
    """[(number, x, y, angle, type, hidden)] in the symbol's own coordinates (y up)."""
    pins = []
    for unit in find(symbol, "symbol"):
        for pin in find(unit, "pin"):
            at = first(pin, "at")
            pins.append((first(pin, "number")[1], float(at[1]), float(at[2]), float(at[3]),
                         str(pin[1]), any(child == "hide" for child in pin)))
    return pins


def place(pin_x, pin_y, pin_angle, x, y, rotation):
    """Where a pin's end lands on the sheet, and which way a wire leaves it
    (dx, dy on the sheet, where y points down)."""
    a = math.radians(rotation)
    sheet_x = x + pin_x * math.cos(a) - pin_y * math.sin(a)
    sheet_y = y - (pin_x * math.sin(a) + pin_y * math.cos(a))
    away = math.radians(pin_angle + 180 + rotation)
    return round(sheet_x, 2), round(sheet_y, 2), round(math.cos(away)), -round(math.sin(away))


def label(net, x, y, dx, dy, key):
    angle = {(1, 0): 0, (-1, 0): 180, (0, -1): 90, (0, 1): 270}[(dx, dy)]
    justify = "left" if angle in (0, 90) else "right"
    return (f'  (global_label "{net}" (shape passive) (at {x} {y} {angle}) (fields_autoplaced)\n'
            f'    {FONT} (justify {justify}))\n    (uuid {new_id(key, "label")})\n'
            f'    (property "Intersheetrefs" "${{INTERSHEET_REFS}}" (at 0 0 0)\n'
            f'      {FONT} hide))\n  )\n')


def wire(x1, y1, x2, y2, key):
    return (f'  (wire (pts (xy {x1} {y1}) (xy {x2} {y2})) (stroke (width 0) (type default))'
            f' (uuid {new_id(key, "wire")}))\n')


def snap(value):
    return round(round(value / GRID) * GRID, 2)


class Sheet:
    def __init__(self, spec):
        self.spec = spec
        self.body = ""
        self.lib_symbols = {}
        self.flag_count = 0

    def add_symbol(self, part, x, y):
        """Draws one part with its pin labels at (x, y), the top-left of its cell.
        Returns the size of the cell it took up."""
        lib = self.lib_symbols.setdefault(part.symbol, library_symbol(part.symbol))
        pins = symbol_pins(lib)
        unknown = set(part.pins) - {p[0] for p in pins}
        if unknown:
            raise SystemExit(f"{part.ref}: symbol {part.symbol} has no pin {sorted(unknown)}")

        # Two-pin parts drawn upright in the library are laid on their side
        ends = {(p[1], p[2]) for p in pins}
        rotation = 90 if len(pins) == 2 and all(px == 0 for px, _ in ends) else 0
        placed = [(p, place(p[1], p[2], p[3], 0, 0, rotation)) for p in pins]
        longest = max([len(n) for n in part.pins.values()] + [4]) * 1.3 + 5
        left = min(px - (STUB + longest if dx < 0 else 0) for _, (px, py, dx, dy) in placed)
        right = max(px + (STUB + longest if dx > 0 else 0) for _, (px, py, dx, dy) in placed)
        top = min(py - (STUB + longest if dy < 0 else 0) for _, (px, py, dx, dy) in placed)
        bottom = max(py + (STUB + longest if dy > 0 else 0) for _, (px, py, dx, dy) in placed)
        top, bottom = min(top, -3.81), max(bottom, 3.81)
        sx, sy = snap(x - left), snap(y - top + 5.08)

        by_position = {}
        for pin, (px, py, dx, dy) in placed:
            by_position.setdefault((px, py, dx, dy), []).append(pin)
        for (px, py, dx, dy), group in by_position.items():
            nets = {part.pins[p[0]] for p in group if p[0] in part.pins}
            if len(nets) > 1:
                raise SystemExit(f"{part.ref}: stacked pins {[p[0] for p in group]} are on different nets")
            ax, ay = round(sx + px, 2), round(sy + py, 2)
            key = (part.ref, group[0][0])
            if nets:
                bx, by = round(ax + dx * STUB, 2), round(ay + dy * STUB, 2)
                self.body += wire(ax, ay, bx, by, key) + label(nets.pop(), bx, by, dx, dy, key)
            elif not all(p[4] == "no_connect" for p in group):
                self.body += f'  (no_connect (at {ax} {ay}) (uuid {new_id(*key, "nc")}))\n'

        # Reference above and value below the body; beside it if pins leave the top or bottom
        pin_ys = [py for _, (px, py, dx, dy) in placed]
        ref_y, value_y = round(sy + min(pin_ys) - 3.8, 2), round(sy + max(pin_ys) + 3.8, 2)
        field_x, justify = sx, ""
        if rotation:
            ref_y, value_y = round(sy - 3.0, 2), round(sy + 3.3, 2)
        elif any(dy for _, (px, py, dx, dy) in placed):
            field_x, justify = round(sx + 5.08, 2), " (justify left)"
            ref_y, value_y = round(sy + min(pin_ys) + 1.0, 2), round(sy + max(pin_ys) - 1.0, 2)
        fields = [("Reference", part.ref, field_x, ref_y, justify), ("Value", part.value, field_x, value_y, justify),
                  ("Footprint", part.footprint, sx, sy, " hide"), ("Datasheet", "~", sx, sy, " hide")]
        if part.mpn:
            fields.append(("MPN", part.mpn, sx, sy, " hide"))
        if part.lcsc:
            fields.append(("LCSC", part.lcsc, sx, sy, " hide"))
        in_bom = "yes" if part.assemble else "no"
        out = (f'  (symbol (lib_id "{part.symbol}") (at {sx} {sy} {rotation}) (unit 1)\n'
               f'    (in_bom {in_bom}) (on_board yes) (dnp no)\n'
               f'    (uuid {symbol_uuid(self.spec.name, part.ref)})\n')
        for name, value, fx, fy, hide in fields:
            out += f'    (property "{name}" "{value}" (at {fx} {fy} 0)\n      {FONT}{hide}))\n'
        for number in sorted({p[0] for p in pins}):
            out += f'    (pin "{number}" (uuid {new_id(part.ref, number, "pin")}))\n'
        out += (f'    (instances (project "{self.spec.name}" (path "/{new_id(self.spec.name, "root")}"'
                f' (reference "{part.ref}") (unit 1))))\n  )\n')
        self.body += out
        return snap(right - left + 7.62), snap(bottom - top + 12.7)

    def add_power_flag(self, net, x, y):
        self.flag_count += 1
        lib_id = "power:PWR_FLAG"
        self.lib_symbols.setdefault(lib_id, library_symbol(lib_id))
        ref = f"#FLG0{self.flag_count}"
        x, y = snap(x), snap(y)
        self.body += wire(x, y, x, round(y + STUB, 2), ("flag", net))
        self.body += label(net, x, round(y + STUB, 2), 0, 1, ("flag", net))
        self.body += (f'  (symbol (lib_id "{lib_id}") (at {x} {y} 0) (unit 1)\n'
                      f'    (in_bom yes) (on_board yes) (dnp no)\n    (uuid {new_id("flag", net)})\n'
                      f'    (property "Reference" "{ref}" (at {x} {y} 0)\n      {FONT} hide))\n'
                      f'    (property "Value" "PWR_FLAG" (at {x} {round(y - 3.5, 2)} 0)\n      {FONT}))\n'
                      f'    (property "Footprint" "" (at {x} {y} 0)\n      {FONT} hide))\n'
                      f'    (property "Datasheet" "~" (at {x} {y} 0)\n      {FONT} hide))\n'
                      f'    (pin "1" (uuid {new_id("flag", net, "pin")}))\n'
                      f'    (instances (project "{self.spec.name}" (path "/{new_id(self.spec.name, "root")}"'
                      f' (reference "{ref}") (unit 1))))\n  )\n')

    def text(self, string, x, y, size=1.5):
        self.body += (f'  (text "{string}" (at {snap(x)} {snap(y)} 0)\n'
                      f'    (effects (font (size {size} {size})) (justify left bottom))\n'
                      f'    (uuid {new_id("text", string)})\n  )\n')

    def box(self, x1, y1, x2, y2, key):
        self.body += (f'  (rectangle (start {snap(x1)} {snap(y1)}) (end {snap(x2)} {snap(y2)})\n'
                      f'    (stroke (width 0.2) (type dash)) (fill (type none))\n'
                      f'    (uuid {new_id("box", key)})\n  )\n')


def build(spec):
    out_dir = os.path.normpath(os.path.join(HERE, "..", spec.name))
    os.makedirs(out_dir, exist_ok=True)
    sheet = Sheet(spec)
    page_w, page_h = (594, 420) if len(spec.parts) > 20 else (297, 210)
    paper = "A2" if page_w == 594 else "A4"

    # Blocks run left to right, wrapping when the page is full. Inside a block the
    # parts with many pins form the first column and the rest fill columns beside it.
    block_x, block_y, row_height = 15.0, 20.0, 0.0
    for group, title in spec.groups:
        parts = [p for p in spec.parts if p.group == group]
        big = [p for p in parts if len(p.pins) > 3 or p.ref[0] in "UJ"]
        small = [p for p in parts if p not in big]
        column_limit = 150.0
        probe = Sheet(spec)
        sizes = {p.ref: probe.add_symbol(p, 0, 0) for p in parts}

        def columns(group_parts):
            cols, current, height = [], [], 0.0
            for p in group_parts:
                if current and height + sizes[p.ref][1] > column_limit:
                    cols.append(current)
                    current, height = [], 0.0
                current.append(p)
                height += sizes[p.ref][1]
            return cols + ([current] if current else [])

        layout = columns(big) + columns(small)
        widths = [max(sizes[p.ref][0] for p in col) for col in layout]
        heights = [sum(sizes[p.ref][1] for p in col) for col in layout]
        block_w, block_h = sum(widths) + 10, max(heights) + 14
        if block_x + block_w > page_w - 10:
            block_x, block_y, row_height = 15.0, block_y + row_height + 8, 0.0
        sheet.text(title, block_x + 2, block_y + 6, 2.5)
        sheet.box(block_x, block_y, block_x + block_w, block_y + block_h, group)
        x = block_x + 5
        for col, width in zip(layout, widths):
            y = block_y + 10
            for p in col:
                sheet.add_symbol(p, x, y)
                y += sizes[p.ref][1]
            x += width
        block_x += block_w + 8
        row_height = max(row_height, block_h)

    notes_y = block_y + row_height + 14
    used = {net for p in spec.parts for net in p.pins.values()}
    flag_x = 20.0
    for net in POWER_FLAGS:
        if net in used:
            sheet.add_power_flag(net, flag_x, notes_y + 4)
            flag_x += 20
    for i, note in enumerate(NOTES.get(spec.name, [])):
        sheet.text(note, flag_x + 15, notes_y + 4 + i * 4)

    path = os.path.join(out_dir, spec.name + ".kicad_sch")
    with open(path, "w") as f:
        f.write(f'(kicad_sch (version 20230121) (generator dreamcatcher)\n'
                f'  (uuid {new_id(spec.name, "root")})\n  (paper "{paper}")\n'
                f'  (title_block (title "{spec.title}") (rev "1")\n'
                f'    (comment 1 "Generated by hardware/scripts - edit boards.py, not this file"))\n'
                f'  (lib_symbols\n')
        for symbol in sheet.lib_symbols.values():
            f.write("    " + dump(symbol, 2) + "\n")
        f.write("  )\n" + sheet.body)
        f.write('  (sheet_instances (path "/" (page "1")))\n)\n')

    for table, kind, target in (("sym-lib-table", "sym_lib_table", "DreamCatcher.kicad_sym"),
                                ("fp-lib-table", "fp_lib_table", "DreamCatcher.pretty")):
        with open(os.path.join(out_dir, table), "w") as f:
            f.write(f'({kind}\n  (lib (name "DreamCatcher")(type "KiCad")'
                    f'(uri "${{KIPRJMOD}}/../lib/{target}")(options "")(descr "DreamCatcher project parts"))\n)\n')
    print("wrote", path)


if __name__ == "__main__":
    for name in sys.argv[1:] or list(BOARDS):
        build(BOARDS[name])
