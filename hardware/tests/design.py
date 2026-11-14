"""Loads a generated board and its schematic for the tests.

Everything here is read from the KiCad files themselves (the board, and the netlist
KiCad exports from the schematic), not from scripts/boards.py, so the tests check the
design that would actually be manufactured.
"""

import functools
import math
import os
import re
import subprocess
import sys
import tempfile

import pcbnew

HARDWARE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.join(HARDWARE, "scripts"))

from sexpr import find, first, parse  # noqa: E402

UNITS = {"p": 1e-12, "n": 1e-9, "u": 1e-6, "m": 1e-3, "k": 1e3, "M": 1e6}


def number(text):
    """'4.7k' -> 4700.0, '100nF' -> 1e-7, '220' -> 220.0"""
    match = re.fullmatch(r"([\d.]+)([pnumkM]?)F?", text)
    if not match:
        raise ValueError(f"can't read the value {text!r}")
    return float(match.group(1)) * UNITS.get(match.group(2), 1.0)


class Design:
    def __init__(self, name):
        self.name = name
        self.folder = os.path.join(HARDWARE, name)
        self.board = pcbnew.LoadBoard(os.path.join(self.folder, name + ".kicad_pcb"))

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "netlist")
            subprocess.run(["kicad-cli", "sch", "export", "netlist", "-o", path,
                            os.path.join(self.folder, name + ".kicad_sch")],
                           check=True, capture_output=True)
            with open(path) as f:
                netlist = parse(f.read())

        self.value, self.kind, self.lcsc = {}, {}, {}
        for comp in find(first(netlist, "components"), "comp"):
            ref = first(comp, "ref")[1]
            self.value[ref] = first(comp, "value")[1]
            self.kind[ref] = first(first(comp, "libsource"), "part")[1]
            fields = {f[1][1]: f[2] for f in find(first(comp, "fields") or [], "field")}
            self.lcsc[ref] = fields.get("LCSC", "")

        self.net_of = {}      # (ref, pin number) -> net name, or None if not connected
        self.pin_name = {}    # (ref, pin number) -> the pin's name in its symbol
        self.pin_type = {}
        self.nets = {}        # net name -> {(ref, pin number)}
        for net in find(first(netlist, "nets"), "net"):
            net_name = first(net, "name")[1].lstrip("/")
            connected = not net_name.startswith("unconnected-")
            for node in find(net, "node"):
                key = (first(node, "ref")[1], first(node, "pin")[1])
                if key[0].startswith("#"):
                    continue
                function = first(node, "pinfunction")
                self.pin_name[key] = function[1] if function else ""
                self.pin_type[key] = first(node, "pintype")[1]
                self.net_of[key] = net_name if connected else None
                if connected:
                    self.nets.setdefault(net_name, set()).add(key)

        box = self.board.GetBoardEdgesBoundingBox()
        line = pcbnew.FromMM(0.05)    # the outline is drawn with a 0.1 mm line
        self.left, self.top = box.GetLeft() + line, box.GetTop() + line
        self.width = pcbnew.ToMM(box.GetWidth()) - 0.1
        self.height = pcbnew.ToMM(box.GetHeight()) - 0.1
        self.footprints = {fp.GetReference(): fp for fp in self.board.GetFootprints()}

    # ---- Circuit ----

    def refs(self, prefix):
        return sorted(r for r in self.value if re.fullmatch(prefix + r"\d+", r))

    def pin(self, ref, name):
        """Net of the pin with this name (or part of a name, e.g. 'IO4')."""
        nets = {self.net_of[key] for key, pin_name in self.pin_name.items()
                if key[0] == ref and (pin_name == name or name in re.split(r"[/_]", pin_name)
                                      or pin_name.startswith(name + "/"))}
        if len(nets) != 1:
            raise AssertionError(f"{ref} has {len(nets)} different nets on pins named {name}: {nets}")
        return nets.pop()

    def between(self, prefix, net_a, net_b):
        """Two-pin parts (R, C, D...) wired between two nets."""
        found = []
        for ref in self.refs(prefix):
            ends = {self.net_of.get((ref, "1")), self.net_of.get((ref, "2"))}
            if ends == {net_a, net_b}:
                found.append(ref)
        return found

    def on_net(self, prefix, net):
        return sorted({ref for ref, _ in self.nets.get(net, ()) if re.fullmatch(prefix + r"\d+", ref)})

    def ohms(self, ref):
        return number(self.value[ref])

    def farads(self, ref):
        return number(self.value[ref])

    def gpio(self, net):
        """Which ESP32 GPIO a net is on."""
        pins = [name for key, name in self.pin_name.items() if key[0] == "U1" and self.net_of[key] == net]
        numbers = {int(m.group(1)) for name in pins for m in [re.match(r"IO(\d+)", name)] if m}
        if len(numbers) != 1:
            raise AssertionError(f"net {net} is on ESP32 pins {pins}")
        return numbers.pop()

    def gpio_function(self, net):
        return next(name for key, name in self.pin_name.items()
                    if key[0] == "U1" and self.net_of[key] == net)

    # ---- Layout (millimetres from the board's top-left corner) ----

    def xy(self, position):
        return pcbnew.ToMM(position.x - self.left), pcbnew.ToMM(position.y - self.top)

    def pads(self, ref, pin=None):
        return [pad for pad in self.footprints[ref].Pads() if pin is None or pad.GetNumber() == pin]

    def pad_xy(self, ref, pin):
        return self.xy(self.pads(ref, pin)[0].GetPosition())

    def distance(self, ref_a, pin_a, ref_b, pin_b):
        return min(math.dist(self.xy(a.GetPosition()), self.xy(b.GetPosition()))
                   for a in self.pads(ref_a, pin_a) for b in self.pads(ref_b, pin_b))

    def tracks(self, net=None):
        return [t for t in self.board.GetTracks()
                if t.GetClass() == "PCB_TRACK" and (net is None or t.GetNetname() == net)]

    def vias(self):
        return [t for t in self.board.GetTracks() if t.GetClass() == "PCB_VIA"]

    def routed_length(self, net):
        return sum(pcbnew.ToMM(t.GetLength()) for t in self.tracks(net))

    def body(self, ref):
        """(left, top, right, bottom) of a part's courtyard."""
        footprint = self.footprints[ref]
        footprint.BuildCourtyardCaches()
        box = footprint.GetCourtyard(pcbnew.F_CrtYd).BBox()
        left, top = self.xy(pcbnew.VECTOR2I(box.GetLeft(), box.GetTop()))
        right, bottom = self.xy(pcbnew.VECTOR2I(box.GetRight(), box.GetBottom()))
        return left, top, right, bottom


@functools.lru_cache(maxsize=None)
def load(name):
    return Design(name)


def main_board():
    return load("dreamcatcher-main")


def eye_board():
    return load("dreamcatcher-eye-sensor")
